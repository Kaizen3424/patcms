/**
 * INV-P08 — fresh binding (L1): challenge reads NEVER consult a cache. The
 * engine consults the injected `readFreshBlob` seam on every decision (proven
 * by call counts and a poison-vs-truth discrimination), and a full conflict
 * epoch (runSave → CAS 422 → engine) carries ZERO conditional reads.
 */

import { describe, expect, it } from "vitest"
import { encodeUtf8 } from "../../safety/encoding"
import { resolveConflictPaths } from "../invariant-engine"
import { runSave } from "../save-driver"
import {
  BRANCH,
  baseRawBytesFrom,
  conflictInputs,
  createForeignBlob,
  createForeignCommit,
  makeReadFreshBlob,
  pushForeignCommit,
} from "./conflict-fixtures"
import { buildSpec, createHarness } from "./fake-github-fetch"

const SITE = "src/content/site.json"
const DOC = '{\n  "title": "site",\n  "price": 100\n}\n'
const DOC_OURS = '{\n  "title": "site-edit",\n  "price": 100\n}\n'
const DOC_FOREIGN = '{\n  "title": "site",\n  "price": 250\n}\n'

describe("INV-P08 — the engine reads FRESH bytes, never a cache", () => {
  it("poisoned stale bytes would adopt-remote; the fresh seam field-merges — truth wins", async () => {
    const spec = await buildSpec([[SITE, DOC]])
    const harness = createHarness(spec)
    const foreignBlob = await createForeignBlob(harness, DOC_FOREIGN)
    const foreign = await pushForeignCommit(harness, [{ path: SITE, sha: foreignBlob }])
    const base = await conflictInputs(harness, {
      baseSha: spec.headSha,
      headSha: foreign.commitSha,
      ourWrites: new Map([[SITE, { bytes: encodeUtf8(DOC_OURS), mode: "100644" }]]),
      baseRaw: baseRawBytesFrom([[SITE, DOC]]),
    })

    let consults = 0
    const freshSeam = makeReadFreshBlob(harness)
    const countedSeam: typeof base.readFreshBlob = async (path, tuple) => {
      consults += 1
      return freshSeam(path, tuple)
    }

    const truth = await resolveConflictPaths({ ...base, readFreshBlob: countedSeam })
    expect(truth.verdicts.get(SITE)).toEqual({ kind: "field-merge" })
    expect(consults).toBe(1) // the seam was actually consulted

    // What a poisoned cache would produce: the STALE base bytes pass canon —
    // this is the false-pass the law exists to prevent.
    const poisoned = await resolveConflictPaths({
      ...base,
      readFreshBlob: async () => encodeUtf8(DOC),
    })
    expect(poisoned.verdicts.get(SITE)).toEqual({ kind: "adopt-remote" })

    // And the engine memoizes nothing: a second run consults the seam again.
    const again = await resolveConflictPaths({ ...base, readFreshBlob: countedSeam })
    expect(again.verdicts.get(SITE)).toEqual({ kind: "field-merge" })
    expect(consults).toBe(2)
  })
})

describe("INV-P08 — conflict epoch carries zero conditional reads", () => {
  it("runSave CAS 422 → engine field-merge with no If-None-Match anywhere in the log", async () => {
    const spec = await buildSpec([[SITE, DOC]])
    // Foreign commit EXISTS (deterministic framing — INV-P03) while the ref
    // still names our base: the epoch then moves the ref mid-save.
    const prep = createHarness(spec)
    const foreignBlob = await createForeignBlob(prep, DOC_FOREIGN)
    const foreign = await createForeignCommit(prep, [{ path: SITE, sha: foreignBlob }], {
      updateRef: false,
    })

    const harness = createHarness(spec, {
      chaos: {
        moveRefBefore: [
          { method: "PATCH", pathPattern: /\/git\/refs\/heads\//, sha: foreign.commitSha },
        ],
      },
    })
    // Replay the identical foreign push through THIS harness —
    // content-addressing converges to the same shas (INV-P03).
    const replayBlob = await createForeignBlob(harness, DOC_FOREIGN)
    await createForeignCommit(harness, [{ path: SITE, sha: replayBlob }], { updateRef: false })
    expect(harness.server.ref(BRANCH)).toBe(spec.headSha) // ref untouched pre-save

    const verdict = await runSave({
      backend: harness.backend,
      branch: BRANCH,
      changes: { updates: [{ path: SITE, bytes: encodeUtf8(DOC_OURS) }] },
    })
    expect(verdict.kind).toBe("conflict")
    if (verdict.kind !== "conflict") return
    expect(verdict.details.currentHeadSha).toBe(foreign.commitSha)
    expect(verdict.details.baseHeadSha).toBe(spec.headSha)

    const input = await conflictInputs(harness, {
      baseSha: verdict.details.baseHeadSha,
      headSha: verdict.details.currentHeadSha,
      ourWrites: new Map([[SITE, { bytes: encodeUtf8(DOC_OURS), mode: "100644" }]]),
      baseRaw: baseRawBytesFrom([[SITE, DOC]]),
    })
    const engineResult = await resolveConflictPaths(input)
    expect(engineResult.verdicts.get(SITE)).toEqual({ kind: "field-merge" })

    // THE law: no request in the whole epoch carried a conditional header.
    for (const event of harness.server.log) {
      expect(Object.hasOwn(event.headers ?? {}, "if-none-match")).toBe(false)
    }

    // Positive control: conditional reads DO reach the log when a caller opts
    // in — the sweep above is not vacuously green.
    await harness.backend.readFile(BRANCH, SITE, foreignBlob, { etag: `"blob-${foreignBlob}"` })
    expect(
      harness.server.log.some((event) => Object.hasOwn(event.headers ?? {}, "if-none-match")),
    ).toBe(true)
  })
})
