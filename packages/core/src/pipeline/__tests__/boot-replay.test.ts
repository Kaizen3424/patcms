/// <reference types="node" />
import { describe, expect, it } from "vitest"
import type { GitBackend, TreeEntryTuple } from "../../backend/types"
import type { DraftRecord, SaveDraftPayload } from "../../drafts"
import { encodeUtf8 } from "../../safety/encoding"
import { adjudicateDraft } from "../boot-replay"
import { createForeignBlob, createForeignCommit } from "./conflict-fixtures"
import { BASE_CONTENT, buildSpec, createHarness, successfulRefUpdates } from "./fake-github-fetch"

/**
 * INV-P12 — boot replay classes (ADR-0004 C.3 pins). Boot NEVER auto-writes
 * to the remote: each surviving draft is adjudicated against a FRESH head.
 *  - discard  — head already carries our content (or the draft is a no-op);
 *  - offer    — a clean apply exists ("resume your unsaved changes");
 *  - conflict — real field overlap or a blocked class (freeze UI).
 * Uncertainty is conservative: unreadable/unshaped → offer (never discard).
 */

const SITE_PATH = "src/content/site.json"
const BASE_RAW = '{\n  "title": "site"\n}\n'

function payloadOf(partial: Partial<SaveDraftPayload> & { formValue: unknown }): SaveDraftPayload {
  return {
    filePath: SITE_PATH,
    baseSha: "",
    baseRaw: BASE_RAW,
    ...partial,
  } as SaveDraftPayload
}

function draftOf(value: SaveDraftPayload): DraftRecord<SaveDraftPayload> {
  return {
    key: "draft:site",
    value,
    savedAt: "2026-10-27T00:00:00.000Z",
  } as DraftRecord<SaveDraftPayload>
}

describe("INV-P12 — class: offer (clean resume)", () => {
  it("base head unchanged + real edits → offer, nothing auto-writes", async () => {
    const spec = await buildSpec(BASE_CONTENT)
    const harness = createHarness(spec)
    const adjudication = await adjudicateDraft({
      backend: harness.backend,
      branch: spec.defaultBranch,
      record: draftOf(payloadOf({ baseSha: spec.headSha, formValue: { title: "resumed" } })),
    })

    expect(adjudication).toMatchObject({ kind: "offer", headSha: spec.headSha })
    // BOOT NEVER WRITES: zero mutations of any kind.
    expect(harness.server.log.some((event) => event.method !== "GET")).toBe(false)
  })

  it("foreign DISJOINT edit → offer carrying the merged bytes + announcements", async () => {
    const spec = await buildSpec(BASE_CONTENT)
    const harness = createHarness(spec)
    // Foreign commit edits a field we did NOT touch (description added).
    const foreignRaw = '{\n  "title": "site",\n  "description": "kept"\n}\n'
    const foreign = await harness.backend.commitChanges(
      { updates: [{ path: SITE_PATH, bytes: encodeUtf8(foreignRaw) }] },
      spec.headSha,
      spec.defaultBranch,
    )

    // Our draft edits ONLY the title (dirty = [title]); the foreign edit is
    // disjoint → rebase folds it in → merged raw carries BOTH.
    const logLengthBeforeAdjudication = harness.server.log.length
    const adjudication = await adjudicateDraft({
      backend: harness.backend,
      branch: spec.defaultBranch,
      record: draftOf(
        payloadOf({ baseSha: spec.headSha, formValue: { title: "resumed by founder" } }),
      ),
    })

    expect(adjudication.kind).toBe("offer")
    if (adjudication.kind !== "offer") return
    expect(adjudication.headSha).toBe(foreign.commitSha)
    expect(adjudication.mergedRaw).toBe(
      '{\n  "title": "resumed by founder",\n  "description": "kept"\n}\n',
    )
    // Adopted foreign paths announce ("Kept [name]'s caption" class).
    expect(adjudication.announcements.length).toBeGreaterThan(0)
    // BOOT NEVER WRITES: after the foreign commit, only READS happened.
    expect(
      harness.server.log
        .slice(logLengthBeforeAdjudication)
        .every((event) => event.method === "GET"),
    ).toBe(true)
  })
})

describe("INV-P12 — class: discard", () => {
  it("head content parse-equals the form value → discard (already-live)", async () => {
    const spec = await buildSpec(BASE_CONTENT)
    const harness = createHarness(spec)
    const liveRaw = '{\n  "title": "already live"\n}\n'
    await harness.backend.commitChanges(
      { updates: [{ path: SITE_PATH, bytes: encodeUtf8(liveRaw) }] },
      spec.headSha,
      spec.defaultBranch,
    )

    const adjudication = await adjudicateDraft({
      backend: harness.backend,
      branch: spec.defaultBranch,
      record: draftOf(payloadOf({ baseSha: spec.headSha, formValue: { title: "already live" } })),
    })

    expect(adjudication).toMatchObject({ kind: "discard", reason: "already-live" })
  })

  it("base head unchanged + a no-op draft (form equals base) → discard (converged)", async () => {
    const spec = await buildSpec(BASE_CONTENT)
    const harness = createHarness(spec)
    const adjudication = await adjudicateDraft({
      backend: harness.backend,
      branch: spec.defaultBranch,
      record: draftOf(payloadOf({ baseSha: spec.headSha, formValue: { title: "site" } })),
    })

    expect(adjudication).toMatchObject({ kind: "discard", reason: "converged" })
    expect(harness.server.log.some((event) => event.method !== "GET")).toBe(false)
  })
})

describe("INV-P12 — class: conflict", () => {
  it("foreign edit OVERLAPPING our dirty fields → conflict (freeze UI)", async () => {
    const spec = await buildSpec(BASE_CONTENT)
    const harness = createHarness(spec)
    // Foreign commit edits the SAME field we edited.
    const foreignRaw = '{\n  "title": "foreign edited the title"\n}\n'
    await harness.backend.commitChanges(
      { updates: [{ path: SITE_PATH, bytes: encodeUtf8(foreignRaw) }] },
      spec.headSha,
      spec.defaultBranch,
    )

    const adjudication = await adjudicateDraft({
      backend: harness.backend,
      branch: spec.defaultBranch,
      record: draftOf(
        payloadOf({ baseSha: spec.headSha, formValue: { title: "founder edited the title" } }),
      ),
    })

    expect(adjudication.kind).toBe("conflict")
    if (adjudication.kind !== "conflict") return
    expect(adjudication.details.currentHeadSha).not.toBe(spec.headSha)
    expect(adjudication.verdicts.get(SITE_PATH)?.kind).toBe("field-merge")
    // Boot adjudication never commits anything: exactly the foreign push's
    // own ref update exists.
    expect(successfulRefUpdates(harness.server)).toBe(1)
  })

  it("foreign DELETED our file → conflict with the resurrect block (matrix #6)", async () => {
    const spec = await buildSpec(BASE_CONTENT)
    const harness = createHarness(spec)
    await harness.backend.commitChanges({ deletes: [SITE_PATH] }, spec.headSha, spec.defaultBranch)

    const adjudication = await adjudicateDraft({
      backend: harness.backend,
      branch: spec.defaultBranch,
      record: draftOf(payloadOf({ baseSha: spec.headSha, formValue: { title: "resurrected?" } })),
    })

    expect(adjudication.kind).toBe("conflict")
    if (adjudication.kind !== "conflict") return
    expect(adjudication.verdicts.get(SITE_PATH)).toMatchObject({
      kind: "blocked",
      reason: "resurrect",
    })
  })
})

describe("INV-P12 — uncertainty is conservative (offer, never discard)", () => {
  it("a corrupt baseRaw does NOT discard the founder's words (conservative offer)", async () => {
    const spec = await buildSpec(BASE_CONTENT)
    const harness = createHarness(spec)
    const adjudication = await adjudicateDraft({
      backend: harness.backend,
      branch: spec.defaultBranch,
      record: draftOf(
        payloadOf({
          baseSha: spec.headSha,
          baseRaw: "not json at all",
          formValue: { title: "kept" },
        }),
      ),
    })

    expect(adjudication.kind).toBe("offer")
    expect(harness.server.log.some((event) => event.method !== "GET")).toBe(false)
  })

  it("an UNSHAPED draft with a MOVED head still offers (line-of-defense offer)", async () => {
    const spec = await buildSpec(BASE_CONTENT)
    const harness = createHarness(spec)
    const foreignBlob = await createForeignBlob(harness, '{\n  "title": "moved on"\n}\n')
    await createForeignCommit(harness, [{ path: SITE_PATH, sha: foreignBlob }])

    const adjudication = await adjudicateDraft({
      backend: harness.backend,
      branch: spec.defaultBranch,
      record: draftOf(
        payloadOf({
          baseSha: spec.headSha,
          baseRaw: "not json at all",
          formValue: { title: "kept" },
        }),
      ),
    })

    expect(adjudication.kind).toBe("offer")
    expect(successfulRefUpdates(harness.server)).toBe(1) // the foreign push only
  })

  it("a rebase that cannot run (root-shape mismatch) offers, never discards", async () => {
    const spec = await buildSpec(BASE_CONTENT)
    const harness = createHarness(spec)
    const foreignBlob = await createForeignBlob(harness, '{\n  "title": "moved on"\n}\n')
    await createForeignCommit(harness, [{ path: SITE_PATH, sha: foreignBlob }])

    // baseRaw is a scalar while formValue is an object: dirty paths exist but
    // the field splicer cannot reconcile the shapes → conservative offer.
    const adjudication = await adjudicateDraft({
      backend: harness.backend,
      branch: spec.defaultBranch,
      record: draftOf(
        payloadOf({ baseSha: spec.headSha, baseRaw: "123", formValue: { title: "kept" } }),
      ),
    })

    expect(adjudication.kind).toBe("offer")
  })

  it("a tree read that degraded to not-modified offers (never invents a head)", async () => {
    const spec = await buildSpec(BASE_CONTENT)
    // The stub head MUST differ from the payload base — a same-sha stub would
    // take the fast path and never reach the degraded-read branch.
    const stub: GitBackend = stubBackend(FOREIGN_HEAD, { tree: "not-modified" })
    const adjudication = await adjudicateDraft({
      backend: stub,
      branch: "main",
      record: draftOf(payloadOf({ baseSha: spec.headSha, formValue: { title: "kept" } })),
    })

    expect(adjudication).toMatchObject({ kind: "offer", headSha: FOREIGN_HEAD })
  })

  it("a blob read that degraded to not-modified blocks as unreadable", async () => {
    const spec = await buildSpec(BASE_CONTENT)
    const foreignBlobSha = "b".repeat(40)
    const stub: GitBackend = stubBackend(FOREIGN_HEAD, {
      tree: {
        sha: "t".repeat(40),
        entries: [{ path: SITE_PATH, mode: "100644", type: "blob", sha: foreignBlobSha }],
      },
      file: "not-modified",
    })
    const adjudication = await adjudicateDraft({
      backend: stub,
      branch: "main",
      record: draftOf(payloadOf({ baseSha: spec.headSha, formValue: { title: "kept" } })),
    })

    expect(adjudication.kind).toBe("conflict")
    if (adjudication.kind !== "conflict") return
    expect(adjudication.verdicts.get(SITE_PATH)).toMatchObject({
      kind: "blocked",
      reason: "unreadable",
    })
  })
})

describe("INV-P12 — discard variants (converged by content, not by luck)", () => {
  it("a draft with NO dirty fields offers nothing to resume → discard (converged)", async () => {
    const spec = await buildSpec(BASE_CONTENT)
    const harness = createHarness(spec)
    const foreignBlob = await createForeignBlob(
      harness,
      '{\n  "title": "site",\n  "note": "f"\n}\n',
    )
    await createForeignCommit(harness, [{ path: SITE_PATH, sha: foreignBlob }])

    // The form value equals its base — the founder abandoned these edits.
    const adjudication = await adjudicateDraft({
      backend: harness.backend,
      branch: spec.defaultBranch,
      record: draftOf(payloadOf({ baseSha: spec.headSha, formValue: { title: "site" } })),
    })

    expect(adjudication).toMatchObject({ kind: "discard", reason: "converged" })
  })

  it("a merged result EQUAL to the head bytes discards (convergent edits)", async () => {
    const spec = await buildSpec([
      ["src/content/site.json", '{\n  "title": "site",\n  "extra": "x"\n}\n'],
    ])
    const harness = createHarness(spec)
    const foreignBlob = await createForeignBlob(harness, '{\n  "title": "v2",\n  "extra": "y"\n}\n')
    await createForeignCommit(harness, [{ path: SITE_PATH, sha: foreignBlob }])

    // We changed ONLY title → the splice folds into the head with nothing
    // left over: the intended result already IS the remote content.
    const adjudication = await adjudicateDraft({
      backend: harness.backend,
      branch: spec.defaultBranch,
      record: draftOf(
        payloadOf({
          baseSha: spec.headSha,
          baseRaw: '{\n  "title": "site",\n  "extra": "x"\n}\n',
          formValue: { title: "v2", extra: "x" },
        }),
      ),
    })

    expect(adjudication).toMatchObject({ kind: "discard", reason: "converged" })
  })
})

describe("INV-P12 — non-object drafts (lists and scalars) adjudicate too", () => {
  it("a LIST-root draft is conservatively OFFERED (rebase rejects non-object roots)", async () => {
    const spec = await buildSpec([["src/content/site.json", '[\n  "a"\n]\n']])
    const harness = createHarness(spec)
    const foreignBlob = await createForeignBlob(harness, '[\n  "c"\n]\n')
    await createForeignCommit(harness, [{ path: SITE_PATH, sha: foreignBlob }])

    // The dirty computation still runs (whole-list unit at the root), but
    // rebase() only splices OBJECT documents — the conservative class is
    // offer (keep the founder's words; the next save runs fresh-binding).
    const adjudication = await adjudicateDraft({
      backend: harness.backend,
      branch: spec.defaultBranch,
      record: draftOf(
        payloadOf({
          baseSha: spec.headSha,
          baseRaw: '[\n  "a"\n]\n',
          formValue: ["a", "b"],
        }),
      ),
    })

    expect(adjudication).toMatchObject({
      kind: "offer",
      headSha: harness.server.ref(spec.defaultBranch),
    })
    expect(successfulRefUpdates(harness.server)).toBe(1) // the foreign push only — boot never writes
  })

  it("a SCALAR-root draft is conservatively OFFERED (rebase rejects non-object roots)", async () => {
    const spec = await buildSpec([["src/content/site.json", '"a"\n']])
    const harness = createHarness(spec)
    const foreignBlob = await createForeignBlob(harness, '"c"\n')
    await createForeignCommit(harness, [{ path: SITE_PATH, sha: foreignBlob }])

    const adjudication = await adjudicateDraft({
      backend: harness.backend,
      branch: spec.defaultBranch,
      record: draftOf(
        payloadOf({
          baseSha: spec.headSha,
          baseRaw: '"a"\n',
          formValue: "b",
        }),
      ),
    })

    expect(adjudication).toMatchObject({
      kind: "offer",
      headSha: harness.server.ref(spec.defaultBranch),
    })
    expect(successfulRefUpdates(harness.server)).toBe(1) // the foreign push only — boot never writes
  })
})

type StubShape = {
  readonly tree:
    | "not-modified"
    | { readonly sha: string; readonly entries: readonly TreeEntryTuple[] }
  readonly file: "not-modified" | "file"
}

/** A head sha that is definitely NOT the payload's base (drives past the fast path). */
const FOREIGN_HEAD = "c".repeat(40)

/** Minimal GitBackend stub for degraded-read adjudication classes. */
function stubBackend(
  headSha: string,
  shape: Pick<StubShape, "tree"> & { readonly file?: StubShape["file"] },
): GitBackend {
  return {
    capabilities: { commitStatus: true, branches: true },
    getRef: async () => ({ ref: "refs/heads/main", object: { sha: headSha, type: "commit" } }),
    readTree: async () =>
      shape.tree === "not-modified"
        ? { kind: "not-modified", etag: "x" }
        : {
            kind: "tree",
            tree: { sha: shape.tree.sha, truncated: false, entries: shape.tree.entries },
          },
    readFile: async () =>
      (shape.file ?? "file") === "not-modified"
        ? { kind: "not-modified", etag: "x" }
        : { kind: "file", file: { path: SITE_PATH, sha: "b", bytes: new Uint8Array(), size: 0 } },
    listChangedFiles: async () => new Map(),
    commitChanges: async () => {
      throw new Error("boot never writes")
    },
    readCheckRuns: async () => ({ kind: "ok", totalCount: 0, runs: [] }),
    readCommitStatuses: async () => ({ kind: "ok", statuses: [] }),
  }
}
