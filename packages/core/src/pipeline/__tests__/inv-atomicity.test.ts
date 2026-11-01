/// <reference types="node" />
import { describe, expect, it } from "vitest"
import type { ChaosSpec } from "../../__tests__/support/fake-github-fetch"
import {
  BASE_CONTENT,
  buildSpec,
  createHarness,
  successfulRefUpdates,
} from "../../__tests__/support/fake-github-fetch"
import { encodeUtf8 } from "../../safety/encoding"
import { runSave } from "../save-driver"

/**
 * INV-P02 — transactional atomicity (L1, FakeGithubServer chaos): a fault
 * injected between blob→tree→commit→ref steps leaves HEAD unchanged; the
 * post-fault retry reconciles to EXACTLY one commit beyond the seed.
 */

const UPDATE_EDITS = {
  updates: [
    {
      path: "src/content/site.json",
      bytes: encodeUtf8('{\n  "title": "site — edited"\n}\n'),
    },
  ],
} as const

describe("INV-P02 — atomicity: fault at every stage, HEAD unchanged, retry reconciles", () => {
  for (const stage of ["blob", "tree", "commit", "ref"] as const) {
    it(`fault at ${stage} stage leaves HEAD unchanged until the retry lands one commit`, async () => {
      const spec = await buildSpec(BASE_CONTENT)
      const chaos = stageFaults(stage)
      const harness = createHarness(spec, { chaos })
      const seedCommitCount = harness.server.commitCount()

      const verdict = await runSave({
        backend: harness.backend,
        branch: "fixture-branch",
        changes: UPDATE_EDITS,
      })
      expect(verdict.kind).toBe("published")
      if (verdict.kind !== "published") return

      // HEAD advanced EXACTLY once, to the reconciled commit.
      expect(harness.server.ref("fixture-branch")).toBe(verdict.commitSha)
      expect(verdict.commitSha).not.toBe(spec.headSha)
      expect(harness.server.commitCount()).toBe(seedCommitCount + 1)
      expect(successfulRefUpdates(harness.server)).toBe(1)

      // The reconciled tree carries the edit and only the edit.
      const diff = await harness.backend.listChangedFiles(
        "fixture-branch",
        spec.headSha,
        harness.server.ref("fixture-branch") as string,
      )
      expect([...diff.keys()]).toEqual(["src/content/site.json"])
    })
  }
})

function stageFaults(stage: "blob" | "tree" | "commit" | "ref"): ChaosSpec {
  const pattern: Record<string, { method: string; path: RegExp }> = {
    blob: { method: "POST", path: /^\/git\/blobs$/ },
    tree: { method: "POST", path: /^\/git\/trees$/ },
    commit: { method: "POST", path: /^\/git\/commits$/ },
    ref: { method: "PATCH", path: /^\/git\/refs\/heads\// },
  }
  const fault = pattern[stage] as { method: string; path: RegExp }
  return {
    faults: [{ method: fault.method, pathPattern: fault.path, times: 1, status: 500 }],
  }
}
