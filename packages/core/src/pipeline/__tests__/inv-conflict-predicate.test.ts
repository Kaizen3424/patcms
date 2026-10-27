/**
 * INV-P05 — same-file predicate (L1): the save applies iff EVERY changed
 * remoteTuple(baseBlob) equals the base tuple OR is canon-equal to it; a
 * semantically drifted same-file blocks with FIELD-granularity freeze while
 * drifted other-files auto-reapply as part of the new base. (ADR-0004
 * appendix matrix rows #1/#5 + the field-level `rebase()` outcome.)
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
import { BASE_CONTENT, buildSpec, createHarness } from "./fake-github-fetch"

const SITE = "src/content/site.json"
const IRIS = "src/content/products/iris.json"
const DOC_BASE = '{\n  "title": "site",\n  "price": 100\n}\n'
const DOC_TITLE_EDIT = '{\n  "title": "site-edit",\n  "price": 100\n}\n'
const DOC_PRICE_EDIT = '{\n  "title": "site",\n  "price": 250\n}\n'

function ourWrite(bytes: string): OurWrite {
  return { bytes: encodeUtf8(bytes), mode: "100644" }
}

describe("INV-P05 — drifted other-files auto-reapply", () => {
  it("foreign drift confined to OTHER files: our file clean-reapplies, predicate satisfied", async () => {
    const spec = await buildSpec(BASE_CONTENT)
    const harness = createHarness(spec)
    const foreignBlob = await createForeignBlob(harness, '{\n  "title": "iris-edit"\n}\n')
    const foreign = await pushForeignCommit(harness, [{ path: IRIS, sha: foreignBlob }])
    const input = await conflictInputs(harness, {
      baseSha: spec.headSha,
      headSha: foreign.commitSha,
      ourWrites: new Map([[SITE, ourWrite('{\n  "title": "site-edit"\n}\n')]]),
      baseRaw: baseRawBytesFrom(BASE_CONTENT),
    })

    const result = await resolveConflictPaths(input)
    expect(result.verdicts.get(SITE)).toEqual({ kind: "clean-reapply" })
    expect(result.verdicts.get(IRIS)).toEqual({ kind: "other-file" })
    expect(result.sameFilePredicateSatisfied).toBe(true)
    expect(result.notes).toEqual([])
  })
})

describe("INV-P05 — drifted same-file blocks with field-granularity freeze", () => {
  it("semantic foreign drift on OUR file: field-merge, predicate unsatisfied", async () => {
    const spec = await buildSpec([[SITE, DOC_BASE]])
    const harness = createHarness(spec)
    const foreignBlob = await createForeignBlob(harness, DOC_PRICE_EDIT)
    const foreign = await pushForeignCommit(harness, [{ path: SITE, sha: foreignBlob }])
    const input = await conflictInputs(harness, {
      baseSha: spec.headSha,
      headSha: foreign.commitSha,
      ourWrites: new Map([[SITE, ourWrite(DOC_TITLE_EDIT)]]),
      baseRaw: baseRawBytesFrom([[SITE, DOC_BASE]]),
    })

    const result = await resolveConflictPaths(input)
    expect(result.verdicts.get(SITE)).toEqual({ kind: "field-merge" })
    expect(result.sameFilePredicateSatisfied).toBe(false)
  })

  it("rebase(): disjoint fields merge silently; same-field edits conflict and freeze the remote value", () => {
    const oldBase = { title: "site", price: 100 }
    const disjoint = rebase({
      formValue: { title: "site-edit", price: 100 },
      dirtyPaths: new Set<FieldPath>([["title"]]),
      oldBase,
      oldRaw: DOC_BASE,
      newBaseRaw: DOC_PRICE_EDIT,
    })
    expect(disjoint.ok).toBe(true)
    if (!disjoint.ok) return
    expect(disjoint.conflicts).toEqual([])
    expect(disjoint.warnings).toEqual([["price"]]) // adopted foreign change announced
    expect(JSON.parse(disjoint.mergedRaw)).toEqual({ title: "site-edit", price: 250 })

    const same = rebase({
      formValue: { title: "site", price: 300 },
      dirtyPaths: new Set<FieldPath>([["price"]]),
      oldBase,
      oldRaw: DOC_BASE,
      newBaseRaw: DOC_PRICE_EDIT,
    })
    expect(same.ok).toBe(true)
    if (!same.ok) return
    expect(same.conflicts).toEqual([["price"]])
    expect(JSON.parse(same.mergedRaw)).toEqual({ title: "site", price: 250 }) // remote frozen
  })
})
