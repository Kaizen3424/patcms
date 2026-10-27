/**
 * INV-P06 — tuple equality (L1): `{sha, mode, type}` ALL matter. Mode-only
 * foreign drift restores OUR mode with a commit-body note; type drift blocks.
 * Neither is ever silently applied. (ADR-0004 appendix matrix rows #2/#3.)
 */

import { describe, expect, it } from "vitest"
import { encodeUtf8 } from "../../safety/encoding"
import type { OurWrite } from "../invariant-engine"
import { resolveConflictPaths } from "../invariant-engine"
import { baseRawBytesFrom, conflictInputs, pushForeignCommit } from "./conflict-fixtures"
import { buildSpec, createHarness } from "./fake-github-fetch"

const SITE = "src/content/site.json"
const DOC = '{\n  "title": "site",\n  "price": 100\n}\n'
const DOC_OURS = '{\n  "title": "site-edit",\n  "price": 100\n}\n'

function ourWrite(bytes: string): OurWrite {
  return { bytes: encodeUtf8(bytes), mode: "100644" }
}

describe("INV-P06 — mode-only foreign drift", () => {
  it("mode-restore + commit-body note, predicate satisfied", async () => {
    const spec = await buildSpec([[SITE, DOC]])
    const harness = createHarness(spec)
    const baseBlobSha = spec.files.get(SITE)?.sha ?? ""
    const foreign = await pushForeignCommit(harness, [
      { path: SITE, sha: baseBlobSha, mode: "100755" },
    ])
    const input = await conflictInputs(harness, {
      baseSha: spec.headSha,
      headSha: foreign.commitSha,
      ourWrites: new Map([[SITE, ourWrite(DOC_OURS)]]),
      baseRaw: baseRawBytesFrom([[SITE, DOC]]),
    })

    const result = await resolveConflictPaths(input)
    expect(result.verdicts.get(SITE)).toEqual({ kind: "mode-restore" })
    expect(result.sameFilePredicateSatisfied).toBe(true)
    expect(result.notes.join("\n")).toContain("restored")
  })

  it("a byte-identical write still notes the restore — the sha shortcut cannot eat the note", async () => {
    const spec = await buildSpec([[SITE, DOC]])
    const harness = createHarness(spec)
    const baseBlobSha = spec.files.get(SITE)?.sha ?? ""
    const foreign = await pushForeignCommit(harness, [
      { path: SITE, sha: baseBlobSha, mode: "100755" },
    ])
    const input = await conflictInputs(harness, {
      baseSha: spec.headSha,
      headSha: foreign.commitSha,
      ourWrites: new Map([[SITE, ourWrite(DOC)]]), // content-identical to base
      baseRaw: baseRawBytesFrom([[SITE, DOC]]),
    })

    const result = await resolveConflictPaths(input)
    expect(result.verdicts.get(SITE)).toEqual({ kind: "mode-restore" })
    expect(result.sameFilePredicateSatisfied).toBe(true)
    expect(result.notes.join("\n")).toContain("restored")
  })
})

describe("INV-P06 — type-only foreign drift", () => {
  it("blob→commit swap blocks; never silently applied, predicate unsatisfied", async () => {
    const spec = await buildSpec([[SITE, DOC]])
    const harness = createHarness(spec)
    const foreign = await pushForeignCommit(harness, [
      { path: SITE, sha: spec.headSha, mode: "160000", type: "commit" }, // real gitlink
    ])
    const input = await conflictInputs(harness, {
      baseSha: spec.headSha,
      headSha: foreign.commitSha,
      ourWrites: new Map([[SITE, ourWrite(DOC_OURS)]]),
      baseRaw: baseRawBytesFrom([[SITE, DOC]]),
    })

    const result = await resolveConflictPaths(input)
    expect(result.verdicts.get(SITE)).toEqual({ kind: "blocked", reason: "type-change" })
    expect(result.sameFilePredicateSatisfied).toBe(false)
  })
})
