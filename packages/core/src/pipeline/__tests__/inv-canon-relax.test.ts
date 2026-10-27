/**
 * INV-P07 — canon relaxation is ONE-WAY (L1): a formatting-only foreign change
 * (same parse-value, different bytes) is silently adopted as the new
 * substrate with a note; ANY semantic drift keeps field-merge — never a
 * false pass. (ADR-0004 appendix matrix row #4.)
 */

import { describe, expect, it } from "vitest"
import { encodeUtf8 } from "../../safety/encoding"
import type { FieldPath } from "../field-paths"
import type { OurWrite } from "../invariant-engine"
import { resolveConflictPaths } from "../invariant-engine"
import { rebase } from "../rebase"
import {
  baseRawBytesFrom,
  conflictInputs,
  createForeignBlob,
  pushForeignCommit,
} from "./conflict-fixtures"
import { buildSpec, createHarness } from "./fake-github-fetch"

const SITE = "src/content/site.json"
const DOC_PRETTY = '{\n  "title": "site",\n  "price": 100\n}\n'
const DOC_COMPACT = '{"title":"site","price":100}'
const DOC_REORDERED = '{"price":100,"title":"site"}'
const DOC_TITLE_EDIT = '{\n  "title": "site-edit",\n  "price": 100\n}\n'
const DOC_PRICE_EDIT = '{\n  "title": "site",\n  "price": 250\n}\n'

function ourWrite(bytes: string): OurWrite {
  return { bytes: encodeUtf8(bytes), mode: "100644" }
}

describe("INV-P07 — formatting-only foreign change adopts remote silently", () => {
  it("adopt-remote + note, predicate satisfied, rebase() quiet", async () => {
    const spec = await buildSpec([[SITE, DOC_PRETTY]])
    const harness = createHarness(spec)
    const foreignBlob = await createForeignBlob(harness, DOC_COMPACT)
    const foreign = await pushForeignCommit(harness, [{ path: SITE, sha: foreignBlob }])
    const input = await conflictInputs(harness, {
      baseSha: spec.headSha,
      headSha: foreign.commitSha,
      ourWrites: new Map([[SITE, ourWrite(DOC_TITLE_EDIT)]]),
      baseRaw: baseRawBytesFrom([[SITE, DOC_PRETTY]]),
    })

    const result = await resolveConflictPaths(input)
    expect(result.verdicts.get(SITE)).toEqual({ kind: "adopt-remote" })
    expect(result.sameFilePredicateSatisfied).toBe(true)
    expect(result.notes.join("\n")).toContain("adopted")

    // Field level: the adoption is silent — zero conflicts, zero warnings.
    const merged = rebase({
      formValue: { title: "site-edit", price: 100 },
      dirtyPaths: new Set<FieldPath>([["title"]]),
      oldBase: { title: "site", price: 100 },
      oldRaw: DOC_PRETTY,
      newBaseRaw: DOC_COMPACT,
    })
    expect(merged.ok).toBe(true)
    if (!merged.ok) return
    expect(merged.conflicts).toEqual([])
    expect(merged.warnings).toEqual([])
    expect(JSON.parse(merged.mergedRaw)).toEqual({ title: "site-edit", price: 100 })
  })

  it("key-order-only foreign change is also formatting → adopt-remote", async () => {
    const spec = await buildSpec([[SITE, DOC_PRETTY]])
    const harness = createHarness(spec)
    const foreignBlob = await createForeignBlob(harness, DOC_REORDERED)
    const foreign = await pushForeignCommit(harness, [{ path: SITE, sha: foreignBlob }])
    const input = await conflictInputs(harness, {
      baseSha: spec.headSha,
      headSha: foreign.commitSha,
      ourWrites: new Map([[SITE, ourWrite(DOC_TITLE_EDIT)]]),
      baseRaw: baseRawBytesFrom([[SITE, DOC_PRETTY]]),
    })

    const result = await resolveConflictPaths(input)
    expect(result.verdicts.get(SITE)).toEqual({ kind: "adopt-remote" })
    expect(result.sameFilePredicateSatisfied).toBe(true)
  })
})

describe("INV-P07 — semantic drift is never relaxed", () => {
  it("canon-DIFFERENT foreign bytes keep field-merge, predicate unsatisfied", async () => {
    const spec = await buildSpec([[SITE, DOC_PRETTY]])
    const harness = createHarness(spec)
    const foreignBlob = await createForeignBlob(harness, DOC_PRICE_EDIT)
    const foreign = await pushForeignCommit(harness, [{ path: SITE, sha: foreignBlob }])
    const input = await conflictInputs(harness, {
      baseSha: spec.headSha,
      headSha: foreign.commitSha,
      ourWrites: new Map([[SITE, ourWrite(DOC_TITLE_EDIT)]]),
      baseRaw: baseRawBytesFrom([[SITE, DOC_PRETTY]]),
    })

    const result = await resolveConflictPaths(input)
    expect(result.verdicts.get(SITE)).toEqual({ kind: "field-merge" })
    expect(result.sameFilePredicateSatisfied).toBe(false)
  })
})
