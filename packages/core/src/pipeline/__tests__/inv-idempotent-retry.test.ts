/// <reference types="node" />
import { describe, expect, it } from "vitest"
import type { DropAckSpec } from "../../__tests__/support/fake-github-fetch"
import {
  BASE_CONTENT,
  blobCreateShas,
  buildSpec,
  createHarness,
  successfulRefUpdates,
} from "../../__tests__/support/fake-github-fetch"
import { encodeUtf8 } from "../../safety/encoding"
import { runSave } from "../save-driver"

/**
 * INV-P03 (C.1 scope) — idempotent retry: repeated blob/tree/commit calls for
 * IDENTICAL content converge to equal SHAs, and the ref is updated exactly
 * once. Response-loss chaos on every write stage re-verifies instead of
 * blind-replaying.
 */

const UPDATE_EDITS = {
  updates: [
    {
      path: "src/content/site.json",
      bytes: encodeUtf8('{\n  "title": "site — edited"\n}\n'),
    },
  ],
} as const

describe("INV-P03 — idempotent retry convergence (L1)", () => {
  for (const stage of ["blob", "tree", "commit"] as const) {
    it(`response lost at ${stage} stage: retry converges to equal SHAs, one ref update`, async () => {
      const spec = await buildSpec(BASE_CONTENT)
      const harness = createHarness(spec, { chaos: { dropAcks: [stageDrop(stage)] } })
      const seedCommitCount = harness.server.commitCount()

      const verdict = await runSave({
        backend: harness.backend,
        branch: "fixture-branch",
        changes: UPDATE_EDITS,
      })
      expect(verdict.kind).toBe("published")
      if (verdict.kind !== "published") return

      // The mutation from the lost attempt and the retry created equal SHAs.
      const blobShas = blobCreateShas(harness.server)
      expect(blobShas.length).toBeGreaterThanOrEqual(2)
      expect(new Set(blobShas).size).toBe(1)

      expect(harness.server.ref("fixture-branch")).toBe(verdict.commitSha)
      expect(successfulRefUpdates(harness.server)).toBe(1)
      expect(harness.server.commitCount()).toBe(seedCommitCount + 1)
    })

    it(`response lost at ref stage: publish confirmed by content, never blind-replayed`, async () => {
      const spec = await buildSpec(BASE_CONTENT)
      const harness = createHarness(spec, { chaos: { dropAcks: [stageDrop("ref")] } })
      const seedCommitCount = harness.server.commitCount()

      const verdict = await runSave({
        backend: harness.backend,
        branch: "fixture-branch",
        changes: UPDATE_EDITS,
      })
      expect(verdict.kind).toBe("published")
      if (verdict.kind !== "published") return

      // The ref move landed on the remote; re-GET confirms it — the driver
      // must NOT retry (zero duplicate commits, exactly one ref update).
      expect(blobCreateShas(harness.server).length).toBe(1)
      expect(harness.server.ref("fixture-branch")).toBe(verdict.commitSha)
      expect(successfulRefUpdates(harness.server)).toBe(1)
      expect(harness.server.commitCount()).toBe(seedCommitCount + 1)
    })
  }
})

function stageDrop(stage: "blob" | "tree" | "commit" | "ref"): DropAckSpec {
  const pattern: Record<string, { method: string; path: RegExp }> = {
    blob: { method: "POST", path: /^\/git\/blobs$/ },
    tree: { method: "POST", path: /^\/git\/trees$/ },
    commit: { method: "POST", path: /^\/git\/commits$/ },
    ref: { method: "PATCH", path: /^\/git\/refs\/heads\// },
  }
  const fault = pattern[stage] as { method: string; path: RegExp }
  return { method: fault.method, pathPattern: fault.path }
}
