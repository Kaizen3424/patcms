/// <reference types="node" />
import { describe, expect, it } from "vitest"
import {
  BASE_CONTENT,
  buildSpec,
  createHarness,
  successfulRefUpdates,
} from "../../__tests__/support/fake-github-fetch"
import { encodeUtf8 } from "../../safety/encoding"
import { runSave } from "../save-driver"

/**
 * INV-P09/P10 (C.1 scope) — unknown-outcome recovery: the driver re-GETs the
 * ref BEFORE any replay (done / rebuild / conflict), keeps HEAD unchanged
 * while unresolved, and gives up as a typed FAILED after the rebuild budget.
 */

const UPDATE_EDITS = {
  updates: [
    {
      path: "src/content/site.json",
      bytes: encodeUtf8('{\n  "title": "site — edited"\n}\n'),
    },
  ],
} as const

describe("INV-P09 — verify-then-rebuild: re-GET first, never a blind replay", () => {
  it("orders the recovery ref read between the failed attempt and the retry", async () => {
    const spec = await buildSpec(BASE_CONTENT)
    const harness = createHarness(spec, {
      chaos: {
        faults: [{ method: "POST", pathPattern: /^\/git\/blobs$/, times: 1, status: 500 }],
      },
    })

    const verdict = await runSave({
      backend: harness.backend,
      branch: "fixture-branch",
      changes: UPDATE_EDITS,
    })
    expect(verdict.kind).toBe("published")

    // Adapter-level faults never reach the server log; the fingerprint of the
    // failed attempt is structural: the SECOND ref GET (the recovery read)
    // must sit before the retry's first logged blob create.
    const log = harness.server.log
    const refGetIndexes = log.flatMap((event, index) =>
      event.method === "GET" && event.path.startsWith("/git/ref/heads/") ? [index] : [],
    )
    expect(refGetIndexes.length).toBeGreaterThanOrEqual(2)
    const recoveryRefIndex = refGetIndexes[1] as number
    const retryBlobIndex = log.findIndex((event, index) => {
      if (index <= recoveryRefIndex) return false
      return event.method === "POST" && event.path === "/git/blobs" && event.status === 201
    })
    expect(retryBlobIndex).toBeGreaterThan(recoveryRefIndex)
  })

  it("exhausted rebuild budget surfaces a typed FAILED; HEAD stays unchanged", async () => {
    const spec = await buildSpec(BASE_CONTENT)
    const harness = createHarness(spec, {
      chaos: {
        faults: [{ method: "POST", pathPattern: /^\/git\/blobs$/, times: 9, status: 500 }],
      },
    })

    const verdict = await runSave({
      backend: harness.backend,
      branch: "fixture-branch",
      changes: UPDATE_EDITS,
    })
    expect(verdict.kind).toBe("failed")
    if (verdict.kind !== "failed") return
    expect(verdict.error.code).toBe("UNKNOWN")
    expect(verdict.error.status).toBe(500)
    expect(harness.server.ref("fixture-branch")).toBe(spec.headSha)
    expect(successfulRefUpdates(harness.server)).toBe(0)
  })
})

describe("INV-P09/P10 — conflict detection on moved heads (L1)", () => {
  it("moved head with DIFFERENT content ⇒ typed conflict carrying the fresh head", async () => {
    const spec = await buildSpec(BASE_CONTENT)
    const FOREIGN_HEAD = "ab".repeat(20)
    const harness = createHarness(spec, {
      chaos: {
        faults: [{ method: "POST", pathPattern: /^\/git\/blobs$/, times: 1, status: 500 }],
        moveRefBefore: [{ method: "POST", pathPattern: /^\/git\/blobs$/, sha: FOREIGN_HEAD }],
      },
    })

    // First blob POST 500s; the foreign push lands in its place; the retry's
    // PATCH then refuses (non-FF vs foreign parent) and re-verifies fresh.
    const verdict = await runSave({
      backend: harness.backend,
      branch: "fixture-branch",
      changes: UPDATE_EDITS,
    })
    expect(verdict.kind).toBe("conflict")
    if (verdict.kind !== "conflict") return
    expect(verdict.details.currentHeadSha).toBe(FOREIGN_HEAD)
    expect(verdict.details.baseHeadSha).toBe(spec.headSha)
    expect(harness.server.ref("fixture-branch")).toBe(FOREIGN_HEAD)
    expect(successfulRefUpdates(harness.server)).toBe(0)
  })
})
