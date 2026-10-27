/**
 * Boot replay + full-batch rebaseline — ADR-0004 §state machine + C.3 pins
 * (INV-P12 core adjudication; the browser kill-tab journey lands in e2e):
 *
 * Boot NEVER auto-writes to the remote. Each surviving draft is adjudicated
 * against a FRESH head through the invariant engine (C.2) + `rebase()`:
 *  1. `discard`   — head already carries our content (parse-equal to the form
 *                   value or byte-equal to the merged would-be result): the
 *                   save landed or converged → delete the draft.
 *  2. `offer`     — adjudication resolves to a clean apply (clean-reapply /
 *                   adopt-remote / mode-restore, or a rebase without field
 *                   overlaps): "resume your unsaved changes" — the founder
 *                   confirms; nothing writes at boot.
 *  3. `conflict`  — field-merge with real overlap, or a blocked class
 *                   (resurrect / type-change / delete-vs-edit / unreadable):
 *                   straight into the field-granularity freeze UI.
 * The SAME adjudication is the lease-steal / visibilitychange REBASELINE
 * (`queued|conflict` — never a blind re-dispatch, ADR-0004 rule).
 *
 * Uncertainty is conservative: unreadable/unshaped inputs resolve `offer`
 * (keep the founder's words; the next save runs the full fresh-binding path) —
 * never a discard, never a silent write.
 */

import type { GitBackend, TreeEntryTuple } from "../backend/types"
import type { DraftRecord, SaveDraftPayload } from "../drafts"
import { decodeUtf8, encodeUtf8 } from "../safety/encoding"
import { parseUntrustedJson } from "../safety/untrusted-json"
import { canonicalJson, jsonEqual } from "../serialization/document"
import { computeDirtyPaths, type FieldPath } from "./field-paths"
import { type FileConflictVerdict, type OurWrite, resolveConflictPaths } from "./invariant-engine"
import { rebase } from "./rebase"

export type DraftAdjudication =
  | {
      readonly kind: "discard"
      readonly reason: "already-live" | "converged"
      readonly headSha: string
    }
  | {
      readonly kind: "offer"
      readonly headSha: string
      /** Merged bytes when a foreign edit was already folded in; else absent. */
      readonly mergedRaw?: string
      /** Commit-body warnings from the engine (mode restores, adoptions). */
      readonly notes: readonly string[]
      /** Adopted foreign paths — announcements ("Kept [name]'s caption"). */
      readonly announcements: readonly FieldPath[]
    }
  | {
      readonly kind: "conflict"
      readonly headSha: string
      readonly details: {
        readonly baseHeadSha: string
        readonly currentHeadSha: string
        readonly changed: ReadonlyMap<string, TreeEntryTuple>
      }
      readonly verdicts: ReadonlyMap<string, FileConflictVerdict>
    }

export interface AdjudicateDraftInput {
  readonly backend: GitBackend
  readonly branch: string
  readonly record: DraftRecord<SaveDraftPayload>
}

export async function adjudicateDraft(input: AdjudicateDraftInput): Promise<DraftAdjudication> {
  const { backend, branch, record } = input
  const payload = record.value
  const path = payload.filePath

  // Derived, never persisted (ADR-0004 C.3 pins): oldBase + dirtyPaths come
  // from the stored record alone. `undefined` = unshaped/corrupt draft →
  // every branch below resolves conservatively.
  const oldBaseParsed = parseUntrustedJson(payload.baseRaw)
  const formValueParsed = parseUntrustedJson(safeStringify(payload.formValue))
  const dirtyPaths =
    oldBaseParsed.ok && formValueParsed.ok
      ? computeDirtyPaths(formValueParsed.value, oldBaseParsed.value)
      : undefined

  const head = await backend.getRef(branch) // FRESH — never a cache (INV-P08 posture)
  const headSha = head.object.sha
  const details = {
    baseHeadSha: payload.baseSha,
    currentHeadSha: headSha,
    changed: new Map<string, TreeEntryTuple>(),
  } as const

  // Fast path: the ref still points at our base commit — nothing foreign and
  // nothing of ours landed. An empty dirty set is a no-op draft (discard);
  // real edits offer; a corrupt draft offers conservatively.
  if (headSha === payload.baseSha) {
    if (dirtyPaths !== undefined && dirtyPaths.length === 0) {
      return { kind: "discard", reason: "converged", headSha }
    }
    return { kind: "offer", headSha, notes: [], announcements: [] }
  }

  const [headTree, baseTree] = await Promise.all([
    backend.readTree(branch, headSha),
    backend.readTree(branch, payload.baseSha),
  ])
  if (headTree.kind !== "tree" || baseTree.kind !== "tree") {
    // History rewritten / base unreadable: conservative offer; the next save
    // re-runs the full fresh-binding conflict path anyway.
    return { kind: "offer", headSha, notes: [], announcements: [] }
  }
  const headEntries = new Map(headTree.tree.entries.map((entry) => [entry.path, entry]))
  const baseEntries = new Map(baseTree.tree.entries.map((entry) => [entry.path, entry]))
  const changed = diffTrees(baseEntries, headEntries)
  const conflictDetails = { ...details, changed }

  const headTuple = headEntries.get(path)
  if (headTuple === undefined) {
    // Foreign deleted the file we edited — resurrection block (matrix #6).
    return {
      kind: "conflict",
      headSha,
      details: conflictDetails,
      verdicts: new Map([[path, { kind: "blocked", reason: "resurrect" } as FileConflictVerdict]]),
    }
  }

  const headRaw = await readFreshRaw(backend, branch, path, headTuple)
  if (headRaw === undefined) {
    return {
      kind: "conflict",
      headSha,
      details: conflictDetails,
      verdicts: new Map([[path, { kind: "blocked", reason: "unreadable" } as FileConflictVerdict]]),
    }
  }

  // Already-live: head content parse-equals the form value — whatever was
  // pending is live; the draft can never add anything (discard).
  const headValue = parseUntrustedJson(headRaw)
  if (headValue.ok && jsonEqual(headValue.value, payload.formValue)) {
    return { kind: "discard", reason: "already-live", headSha }
  }

  // Unshaped draft (parse failure): conservative offer — the form value is
  // still the founder's words; never discard, never write.
  if (dirtyPaths === undefined || formValueParsed.ok === false || oldBaseParsed.ok === false) {
    return { kind: "offer", headSha, notes: [], announcements: [] }
  }
  // Nothing of ours is pending anywhere (the form equals its base): no matter
  // where the head moved, there is nothing to resume — discard.
  if (dirtyPaths.length === 0) {
    return { kind: "discard", reason: "converged", headSha }
  }

  const merged = rebase({
    formValue: formValueParsed.value,
    dirtyPaths: new Set(dirtyPaths),
    oldBase: oldBaseParsed.value,
    oldRaw: payload.baseRaw,
    newBaseRaw: headRaw,
  })
  if (!merged.ok) {
    return { kind: "offer", headSha, notes: [], announcements: [] }
  }

  // The engine sees our INTENDED content (the form's serialized value) — the
  // merge preview is presentation for the founder, never adjudication input:
  // adjudicating with merged bytes would mask contested fields as canon-equal.
  const intendedBytes = encodeUtf8(canonicalJson(formValueParsed.value))
  const engine = await resolveConflictPaths({
    changed,
    headEntries,
    baseEntries,
    ourWrites: new Map<string, OurWrite>([
      [path, { bytes: intendedBytes, mode: baseTupleMode(baseEntries, path) }],
    ]),
    ourDeletes: new Set(),
    readFreshBlob: (freshPath, tuple) => readFreshBytes(backend, branch, freshPath, tuple),
    baseRawBytes: (rawPath) => (rawPath === path ? encodeUtf8(payload.baseRaw) : undefined),
  })

  const verdict = engine.verdicts.get(path)
  if (verdict?.kind === "blocked") {
    return { kind: "conflict", headSha, details: conflictDetails, verdicts: engine.verdicts }
  }
  // Field-merge WITH real overlap freezes FIRST — a merged result equal to the
  // remote bytes here means our contested values lost the splice, which is a
  // founder decision, never a silent convergence (ADR-0004 freeze UI).
  if (verdict?.kind === "field-merge" && merged.conflicts.length > 0) {
    return { kind: "conflict", headSha, details: conflictDetails, verdicts: engine.verdicts }
  }
  if (merged.mergedRaw === headRaw) {
    // Our intended content IS the head content: converged → discard.
    return { kind: "discard", reason: "converged", headSha }
  }
  // field-merge without overlaps = disjoint auto-merge (rebase already did the
  // splicing); clean-reapply/adopt-remote/mode-restore resume cleanly too.
  return {
    kind: "offer",
    headSha,
    mergedRaw: merged.mergedRaw,
    notes: engine.notes,
    announcements: merged.warnings,
  }
}

function diffTrees(
  baseEntries: ReadonlyMap<string, TreeEntryTuple>,
  headEntries: ReadonlyMap<string, TreeEntryTuple>,
): Map<string, TreeEntryTuple> {
  const changed = new Map<string, TreeEntryTuple>()
  for (const [path, tuple] of headEntries) {
    const previous = baseEntries.get(path)
    if (
      previous === undefined ||
      previous.sha !== tuple.sha ||
      previous.mode !== tuple.mode ||
      previous.type !== tuple.type
    ) {
      changed.set(path, tuple)
    }
  }
  return changed
}

async function readFreshRaw(
  backend: GitBackend,
  branch: string,
  path: string,
  tuple: TreeEntryTuple,
): Promise<string | undefined> {
  const bytes = await readFreshBytes(backend, branch, path, tuple)
  return bytes === undefined ? undefined : decodeUtf8(bytes)
}

/** Fresh blob bytes — UNCONDITIONAL read, never a cache (INV-P08 posture). */
async function readFreshBytes(
  backend: GitBackend,
  branch: string,
  path: string,
  tuple: TreeEntryTuple,
): Promise<Uint8Array | undefined> {
  try {
    const file = await backend.readFile(branch, path, tuple.sha)
    if (file.kind !== "file") return undefined
    return file.file.bytes
  } catch {
    return undefined
  }
}

function baseTupleMode(baseEntries: ReadonlyMap<string, TreeEntryTuple>, path: string): string {
  return baseEntries.get(path)?.mode ?? "100644"
}

/** Re-serialize through the caps-enforcing parser — JSON-safe in, JsonValue out. */
function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? "null"
  } catch {
    return "null"
  }
}
