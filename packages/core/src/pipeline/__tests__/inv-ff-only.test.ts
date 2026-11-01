/// <reference types="node" />
import { describe, expect, it } from "vitest"
import {
  BASE_CONTENT,
  buildSpec,
  createHarness,
  hasForceTrue,
} from "../../__tests__/support/fake-github-fetch"
import { encodeUtf8 } from "../../safety/encoding"
import { runSave, type SaveVerdict } from "../save-driver"

describe("INV-P01 — FF-only: 422 handled, HEAD unchanged, no force:true (L1)", () => {
  it("a concurrent push is met with the typed CAS_CONFLICT and zero force flags", async () => {
    const spec = await buildSpec(BASE_CONTENT)
    const FOREIGN_HEAD = "9e".repeat(20)
    const harness = createHarness(spec, {
      chaos: {
        moveRefBefore: [
          { method: "PATCH", pathPattern: /\/git\/refs\/heads\//, sha: FOREIGN_HEAD },
        ],
      },
    })
    const verdict = await runSaveUpdate(harness)
    expect(verdict.kind).toBe("conflict")
    if (verdict.kind !== "conflict") return
    // Fresh challenge read reports the foreign head …
    expect(verdict.details.currentHeadSha).toBe(FOREIGN_HEAD)
    // … and the base→foreign diff (honest even when empty for synthetic heads).
    expect(verdict.details.changed).toBeInstanceOf(Map)
    // HEAD moved only by the foreign push, not by our failed attempt.
    expect(harness.server.ref("fixture-branch")).toBe(FOREIGN_HEAD)
    // No request ever carried force:true — the ref body is {sha, force:false}.
    expect(hasForceTrue(harness.server)).toBe(false)
    expect(harness.server.log.some((event) => event.method === "PATCH")).toBe(true)
  })

  it("the happy path also stays FF-only (request log never claims force)", async () => {
    const spec = await buildSpec(BASE_CONTENT)
    const harness = createHarness(spec)
    const verdict = await runSaveUpdate(harness)
    expect(verdict.kind).toBe("published")
    expect(hasForceTrue(harness.server)).toBe(false)
  })
})

async function runSaveUpdate(harness: ReturnType<typeof createHarness>): Promise<SaveVerdict> {
  return runSave({
    backend: harness.backend,
    branch: "fixture-branch",
    changes: {
      updates: [
        {
          path: "src/content/site.json",
          bytes: encodeUtf8('{\n  "title": "site — edited"\n}\n'),
        },
      ],
    },
  })
}
