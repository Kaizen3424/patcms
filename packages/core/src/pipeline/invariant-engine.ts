/**
 * Conflict invariant engine — FILE-level adjudication of a CAS conflict
 * (ADR-0004 appendix decision matrix; INV-P05/P06/P07/P08).
 *
 * Pure over provided git data plus one injected FRESH challenge read. The
 * engine never consults a cache (INV-P08): every content comparison goes
 * through `readFreshBlob`, whose implementation must be unconditional (no
 * If-None-Match, no memoized bytes).
 *
 * The matrix (normative — ADR-0004 appendix):
 *  1 changed, not ours            → other-file (auto-reapplied)
 *  2 sha equal, mode differs      → mode-restore (+ note)
 *  3 sha equal, type differs      → blocked: type-change
 *  4 sha differs, canon-equal     → adopt-remote (+ note)
 *  5 sha differs, canon-different → field-merge (rebase() adjudicates fields)
 *  6 our write, absent from head  → blocked: resurrect
 *  7 our delete, foreign edited   → blocked: delete-vs-edit
 *  8 our delete, foreign deleted  → reconciled
 *  9 challenge read unavailable   → blocked: unreadable
 */

import { gitBlobSha } from "../backend/git-sha"
import type { TreeEntryTuple } from "../backend/types"
import { decodeUtf8 } from "../safety/encoding"
import { parseUntrustedJson } from "../safety/untrusted-json"
import { jsonEqual } from "../serialization/document"

export interface OurWrite {
  readonly bytes: Uint8Array
  readonly mode: string
}

export interface ConflictEngineInput {
  /** base→head file diff (head-side entries; deletions are NOT in here). */
  readonly changed: ReadonlyMap<string, TreeEntryTuple>
  /** Head tree — detects foreign DELETIONS (resurrection, matrix #6). */
  readonly headEntries: ReadonlyMap<string, TreeEntryTuple>
  /** Base tree entries — what our attempt was built on. */
  readonly baseEntries: ReadonlyMap<string, TreeEntryTuple>
  readonly ourWrites: ReadonlyMap<string, OurWrite>
  readonly ourDeletes: ReadonlySet<string>
  /** Fresh challenge read — MUST be unconditional (INV-P08 seam). */
  readonly readFreshBlob: (path: string, tuple: TreeEntryTuple) => Promise<Uint8Array | undefined>
  /** Raw bytes our attempt was serialized from (canon comparison source). */
  readonly baseRawBytes: (path: string) => Uint8Array | undefined
  /** Canon predicate; default = parse-value equality (formatting-insensitive). */
  readonly canonEqual?: (baseRaw: string, remoteRaw: string) => boolean
}

export type FileConflictVerdict =
  | { readonly kind: "other-file" }
  | { readonly kind: "clean-reapply" }
  | { readonly kind: "adopt-remote" }
  | { readonly kind: "mode-restore" }
  | { readonly kind: "field-merge" }
  | { readonly kind: "reconciled" }
  | {
      readonly kind: "blocked"
      readonly reason: "type-change" | "resurrect" | "delete-vs-edit" | "unreadable"
    }

export interface ConflictEngineResult {
  readonly verdicts: ReadonlyMap<string, FileConflictVerdict>
  /** Machine-checkable commit-body warnings (mode restores, adoptions). */
  readonly notes: readonly string[]
  /**
   * INV-P05 same-file predicate: every path in our write/delete set resolves
   * to a verdict that proceeds WITHOUT field merge or block.
   */
  readonly sameFilePredicateSatisfied: boolean
}

const PROCEEDING_KINDS = new Set(["clean-reapply", "adopt-remote", "mode-restore", "reconciled"])

export async function resolveConflictPaths(
  input: ConflictEngineInput,
): Promise<ConflictEngineResult> {
  const canonEqual = input.canonEqual ?? defaultCanonEqual
  const verdicts = new Map<string, FileConflictVerdict>()
  const notes: string[] = []

  const paths = [...unionKeys(input).values()].sort((left, right) => (left < right ? -1 : 1))
  let satisfied = true

  for (const path of paths) {
    const write = input.ourWrites.get(path)
    const deleted = !write && input.ourDeletes.has(path)
    const changedTuple = input.changed.get(path)
    let verdict: FileConflictVerdict

    if (changedTuple !== undefined) {
      if (deleted) {
        verdict = { kind: "blocked", reason: "delete-vs-edit" } // matrix #7
      } else if (write !== undefined) {
        verdict = await adjudicateWritten(
          path,
          changedTuple,
          input.baseEntries.get(path),
          write,
          input,
          canonEqual,
          notes,
        )
      } else {
        verdict = { kind: "other-file" } // matrix #1
      }
    } else if (write !== undefined) {
      // Not in the base→head diff: either the foreign commit left it alone
      // (re-applies cleanly) or DELETED it (head tree check, matrix #6).
      verdict = input.headEntries.has(path)
        ? { kind: "clean-reapply" }
        : { kind: "blocked", reason: "resurrect" }
    } else if (deleted) {
      // Both deleted, or we delete what foreign never touched: reconciles.
      verdict = input.headEntries.has(path) ? { kind: "clean-reapply" } : { kind: "reconciled" }
    } else {
      verdict = { kind: "other-file" }
    }

    verdicts.set(path, verdict)
    if (PROCEEDING_KINDS.has(verdict.kind)) continue
    if (verdict.kind === "other-file") continue
    satisfied = false
  }

  return { verdicts, notes, sameFilePredicateSatisfied: satisfied }
}

async function adjudicateWritten(
  path: string,
  remoteTuple: TreeEntryTuple,
  baseTuple: TreeEntryTuple | undefined,
  write: OurWrite,
  input: ConflictEngineInput,
  canonEqual: (baseRaw: string, remoteRaw: string) => boolean,
  notes: string[],
): Promise<FileConflictVerdict> {
  // Matrix #3 — type drift blocks regardless of sha (submodule swaps included).
  if (baseTuple !== undefined && baseTuple.type !== remoteTuple.type) {
    return { kind: "blocked", reason: "type-change" }
  }
  // Content-identical foreign touch: matrix #2 (mode-only — INV-P06) or a
  // no-op tuple that slipped into `changed`.
  if (remoteTuple.sha === baseTuple?.sha) {
    if (baseTuple.mode !== remoteTuple.mode) {
      notes.push(
        `mode ${baseTuple.mode} restored for ${path} (incoming ${remoteTuple.mode} ignored)`,
      )
      return { kind: "mode-restore" }
    }
    return { kind: "clean-reapply" }
  }
  // Convergent edits: our bytes already match the foreign head byte-for-byte.
  if ((await gitBlobSha(write.bytes)) === remoteTuple.sha) return { kind: "clean-reapply" }

  const remoteBytes = await input.readFreshBlob(path, remoteTuple)
  if (remoteBytes === undefined) return { kind: "blocked", reason: "unreadable" } // matrix #9
  const baseRaw = input.baseRawBytes(path)
  if (baseRaw !== undefined && canonEqual(decodeUtf8(baseRaw), decodeUtf8(remoteBytes))) {
    notes.push(`formatting-only change adopted for ${path} (incoming bytes become the base)`)
    return { kind: "adopt-remote" } // matrix #4 — INV-P07 relaxation
  }
  return { kind: "field-merge" } // matrix #5 — rebase() decides fields
}

function unionKeys(input: ConflictEngineInput): Set<string> {
  const keys = new Set<string>()
  for (const path of input.changed.keys()) keys.add(path)
  for (const path of input.ourWrites.keys()) keys.add(path)
  for (const path of input.ourDeletes) keys.add(path)
  return keys
}

/** Parse-value equality — the formatting-insensitive canon predicate (P1). */
function defaultCanonEqual(baseRaw: string, remoteRaw: string): boolean {
  const base = parseUntrustedJson(baseRaw)
  const remote = parseUntrustedJson(remoteRaw)
  return base.ok && remote.ok && jsonEqual(base.value, remote.value)
}
