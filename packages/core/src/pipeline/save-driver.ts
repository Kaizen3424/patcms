/**
 * Save driver — the pipeline entry point above `GitBackend.commitChanges`
 * (ADR-0005 P2 addendum; ADR-0004 laws: fresh `getRef` before EVERY save,
 * confirmation by content, drafts deleted only post-ref-verify [P2.5]).
 *
 * C.1 mechanics:
 * 1. skip-token law rejects user messages BEFORE any network call (INV-D02).
 * 2. Fresh base ref + fresh base tree — challenge decisions NEVER consult a
 *    cache (no conditional headers on driver reads — INV-P08).
 * 3. Zero-diff changesets emit ZERO writes and end as `noop` (INV-S02 C.1).
 * 4. `commitChanges` failures classify: CAS → typed conflict verdict (fresh
 *    challenge reads); auth/scope/422-validation → after-write hook fires
 *    (INV-A03 wiring completes at P2.5); network-class → verify-then-rebuild
 *    (INV-P09): fresh ref → done (content-confirmed publish, INV-P10) /
 *    rebuild with the SAME verified base / conflict.
 *
 * C.3 additions:
 * 5. RATE_LIMIT → typed `parked` verdict carrying the rate window (INV-P11/
 *    N01): the coordinator parks the queued save and resumes EVENT-driven
 *    (single scheduled wake; no guidance ⇒ manual resume, never tight-loop).
 * 6. Published-by-content completion (INV-P10): recovery compares the fresh
 *    head TREE sha against the client-computed expected tree sha (content
 *    addressing = authoritative) before the diff-level confirm. Orphan blobs
 *    are never "cleaned" — no deletion requests exist anywhere in the driver.
 * Rebuild is never a blind replay: every attempt re-enters the CAS primitive
 * whose parent chain pins the verified head.
 */

import { BackendReadError } from "../backend/errors"
import { type GitTreeEntry, gitBlobSha, gitTreeSha } from "../backend/git-sha"
import type {
  CommitChangeSet,
  CommitResult,
  GitBackend,
  TreeEntryTuple,
  TreeRead,
} from "../backend/types"
import {
  BackendWriteError,
  isBackendWriteError,
  type WriteErrorCode,
} from "../backend/write-errors"
import { composeCommitMessage } from "./commit-message"
import type { FieldPath } from "./field-paths"
import { describeRatePause } from "./rate-policy"
import { isZeroDiffChangeSet } from "./zero-diff"

/**
 * Rebase preview carried on a conflict verdict for the freeze UI (P2.9):
 * non-overlapping fields already merged (announcements = `warnings`), the
 * overlapping ones frozen at remote bytes until the founder decides.
 */
export interface ConflictMergePreview {
  readonly path: string
  readonly mergedRaw: string
  readonly frozenFieldPaths: readonly FieldPath[]
  /** Adopted foreign paths — "Kept [name]'s caption" announcements. */
  readonly warnings: readonly FieldPath[]
  /** Machine-checkable commit-body warnings (mode restores, adoptions). */
  readonly engineNotes: readonly string[]
}

export interface SaveConflictDetails {
  /** Head the failed attempt was pinned to. */
  readonly baseHeadSha: string
  /** Freshly read head at decision time ("" only when the read itself failed). */
  readonly currentHeadSha: string
  /** Fresh base→head changed files (INV-P05 tuple domain, C.2 engine input). */
  readonly changed: ReadonlyMap<string, TreeEntryTuple>
  /** Freeze-UI fields — controller-enriched; the driver never fills these. */
  readonly merge?: ConflictMergePreview
  readonly verdicts?: ReadonlyMap<string, import("./invariant-engine").FileConflictVerdict>
}

export type SaveVerdict =
  | { readonly kind: "published"; readonly commitSha: string; readonly treeSha?: string }
  | { readonly kind: "noop" }
  | { readonly kind: "conflict"; readonly details: SaveConflictDetails }
  /**
   * RATE_LIMIT with the parsed window (INV-P11): `waitMs === null` means no
   * usable guidance — the coordinator parks for MANUAL resume instead of
   * tight-looping on a null countdown.
   */
  | { readonly kind: "parked"; readonly waitMs: number | null; readonly error: BackendWriteError }
  /** Terminal for this driver call; surfaces through the failure screens. */
  | { readonly kind: "failed"; readonly error: BackendWriteError }

export interface SaveDriverInput {
  readonly backend: GitBackend
  readonly branch: string
  readonly changes: CommitChangeSet
  /** User-editable message; skip-token carrying input is rejected (INV-D02). */
  readonly message?: string
  /** After-write failure hook (401/403/422-class codes) — admin re-probes (INV-A03). */
  readonly onAfterWriteFailure?: (error: BackendWriteError) => void
  /** Unknown-outcome verify-then-rebuild budget (INV-P09). Default 2. */
  readonly maxRebuilds?: number
  /** Epoch-ms clock for rate windows (deterministic tests inject). */
  readonly now?: () => number
}

const REBUILDABLE_CODES: ReadonlySet<string> = new Set(["NETWORK", "UNKNOWN"])
/** 401/403/422-after-write re-probe pairing — CAS conflicts are UI machinery. */
const AFTER_WRITE_HOOK_CODES: ReadonlySet<string> = new Set(["AUTH_EXPIRED", "SCOPE", "VALIDATION"])

export async function runSave(input: SaveDriverInput): Promise<SaveVerdict> {
  const now = input.now ?? (() => Date.now())
  const changeCount =
    (input.changes.adds?.length ?? 0) +
    (input.changes.updates?.length ?? 0) +
    (input.changes.deletes?.length ?? 0)
  const composed = composeCommitMessage({ count: changeCount, userMessage: input.message })
  if (!composed.ok) {
    // INV-D02: refusal happens with zero writes — the deploy is never muted.
    return {
      kind: "failed",
      error: new BackendWriteError(
        "VALIDATION",
        "commit message rejected: deploy-muting skip token (ADR-0008)",
        {},
      ),
    }
  }
  const maxRebuilds = input.maxRebuilds ?? 2

  // Fresh base binding — the ONE authority for this save (ADR-0004).
  const baseRef = await tryGetRef(input)
  if (baseRef instanceof BackendWriteError) return rateOrFailed(baseRef, now)
  const baseHeadSha = baseRef.sha

  const baseTree = await tryReadTree(input, baseHeadSha)
  if (baseTree instanceof BackendWriteError) return rateOrFailed(baseTree, now)
  const baseEntries = new Map(baseTree.entries.map((entry) => [entry.path, entry]))

  if (await isZeroDiffChangeSet({ baseEntries, changes: input.changes })) {
    return { kind: "noop" }
  }

  // INV-P10: the tree sha our writes must produce on top of the verified base.
  const expectedTreeSha = await computeExpectedTreeSha(baseEntries, input.changes)

  let lastError: BackendWriteError | undefined
  for (let attempt = 0; attempt <= maxRebuilds; attempt += 1) {
    let outcome: CommitResult
    try {
      outcome = await input.backend.commitChanges(input.changes, baseHeadSha, input.branch, {
        message: composed.message,
      })
    } catch (error) {
      const writeError = normalizeError(error)
      lastError = writeError
      if (AFTER_WRITE_HOOK_CODES.has(writeError.code)) {
        input.onAfterWriteFailure?.(writeError)
      }
      if (writeError.code === "CAS_CONFLICT") {
        return await conflictVerdict(input, baseHeadSha)
      }
      if (writeError.code === "RATE_LIMIT") {
        return {
          kind: "parked",
          waitMs: describeRatePause(writeError, now),
          error: writeError,
        }
      }
      if (REBUILDABLE_CODES.has(writeError.code)) {
        const recovery = await classifyRecovery(input, baseHeadSha, expectedTreeSha, now)
        if (recovery.kind === "published") return recovery
        if (recovery.kind === "parked") {
          return { kind: "parked", waitMs: recovery.waitMs, error: recovery.error }
        }
        if (recovery.kind === "conflict") {
          return {
            kind: "conflict",
            details: {
              baseHeadSha,
              currentHeadSha: recovery.currentHeadSha,
              changed: recovery.changed,
            },
          }
        }
        if (recovery.kind === "congested") continue // verified base unchanged → rebuild
        return { kind: "failed", error: recovery.error }
      }
      return { kind: "failed", error: writeError }
    }
    return {
      kind: "published",
      commitSha: outcome.commitSha,
      treeSha: outcome.treeSha,
    }
  }
  return {
    kind: "failed",
    error: lastError ?? new BackendWriteError("UNKNOWN", "save attempts exhausted", {}),
  }
}

type Recovery =
  | { readonly kind: "published"; readonly commitSha: string }
  | {
      readonly kind: "conflict"
      readonly baseHeadSha: string
      readonly currentHeadSha: string
      readonly changed: ReadonlyMap<string, TreeEntryTuple>
    }
  | { readonly kind: "congested" }
  | { readonly kind: "parked"; readonly waitMs: number | null; readonly error: BackendWriteError }
  | { readonly kind: "failed"; readonly error: BackendWriteError }

/**
 * INV-P09 classification: fresh ref decides done / rebuild / conflict. Never a
 * blind replay — every branch is proof-read against THE verified base sha.
 * INV-P10 completion: tree-sha equality confirms publication by CONTENT first.
 */
async function classifyRecovery(
  input: SaveDriverInput,
  baseHeadSha: string,
  expectedTreeSha: string | undefined,
  now: () => number,
): Promise<Recovery> {
  const head = await tryGetRef(input)
  if (head instanceof BackendWriteError) {
    if (head.code === "RATE_LIMIT") {
      return { kind: "parked", waitMs: describeRatePause(head, now), error: head }
    }
    return { kind: "congested" } // read died too — rebuild attempt resumes it
  }
  if (head.sha === baseHeadSha) return { kind: "congested" }

  // INV-P10: the fresh head's tree sha pins publication by content — no diff
  // reconstruction needed, and orphan blobs from a partial attempt stay
  // orphaned (git GC's them; the driver never issues cleanup requests).
  if (expectedTreeSha !== undefined) {
    const headTree = await tryReadTree(input, head.sha)
    if (!(headTree instanceof BackendWriteError) && headTree.sha === expectedTreeSha) {
      return { kind: "published", commitSha: head.sha }
    }
  }

  const challenge = await remoteMatches(input, baseHeadSha, head.sha)
  if (challenge.matched) {
    return { kind: "published", commitSha: head.sha }
  }
  return {
    kind: "conflict",
    baseHeadSha,
    currentHeadSha: head.sha,
    changed: challenge.changed,
  }
}

/**
 * The tree sha the transport's own framing must produce: base tree with our
 * writes applied (mode 100644 / blob — mirrors `commitChanges` exactly) and
 * our deletes removed. Content addressing makes this authoritative.
 */
async function computeExpectedTreeSha(
  baseEntries: ReadonlyMap<string, TreeEntryTuple>,
  changes: CommitChangeSet,
): Promise<string | undefined> {
  try {
    const applied = new Map<string, GitTreeEntry>()
    for (const [path, tuple] of baseEntries) {
      applied.set(path, { path, mode: tuple.mode, type: tuple.type, sha: tuple.sha })
    }
    const writes = [...(changes.adds ?? []), ...(changes.updates ?? [])]
    for (const write of writes) {
      applied.set(write.path, {
        path: write.path,
        mode: "100644",
        type: "blob",
        sha: await gitBlobSha(write.bytes),
      })
    }
    for (const path of changes.deletes ?? []) applied.delete(path)
    return await gitTreeSha([...applied.values()])
  } catch {
    return undefined // framing edge (path collision) — diff-level confirm covers
  }
}

/** One challenge: fresh diff decides confirmation AND carries conflict detail. */
async function remoteMatches(
  input: SaveDriverInput,
  baseHeadSha: string,
  headSha: string,
): Promise<{ readonly matched: boolean; readonly changed: ReadonlyMap<string, TreeEntryTuple> }> {
  const writes = [...(input.changes.adds ?? []), ...(input.changes.updates ?? [])]
  const deletes = input.changes.deletes ?? []
  try {
    const diff = await input.backend.listChangedFiles(input.branch, baseHeadSha, headSha)
    // Confirmation (ADR-0004 by-content): head's diff against OUR base equals
    // exactly our writes (sha-level, hence byte-exact) and our deletions hold.
    let matched = diff.size === writes.length
    for (const [, tuple] of diff) {
      const ours = writes.find((write) => write.path === tuple.path)
      if (ours === undefined || (await gitBlobSha(ours.bytes)) !== tuple.sha) {
        matched = false
        break
      }
    }
    if (matched && deletes.length > 0) {
      const headTree = await input.backend.readTree(input.branch, headSha)
      if (headTree.kind !== "tree") return { matched: false, changed: diff }
      const headPaths = new Set(headTree.tree.entries.map((entry) => entry.path))
      if (deletes.some((path) => headPaths.has(path))) {
        return { matched: false, changed: diff }
      }
    }
    return { matched, changed: diff }
  } catch {
    return { matched: false, changed: new Map() } // unverifiable ⇒ conflict re-probes
  }
}

async function conflictVerdict(input: SaveDriverInput, baseHeadSha: string): Promise<SaveVerdict> {
  const head = await tryGetRef(input)
  const currentHeadSha = head instanceof BackendWriteError ? "" : head.sha
  let changed: ReadonlyMap<string, TreeEntryTuple> = new Map()
  if (currentHeadSha.length > 0 && currentHeadSha !== baseHeadSha) {
    try {
      changed = await input.backend.listChangedFiles(input.branch, baseHeadSha, currentHeadSha)
    } catch {
      changed = new Map() // re-probe needed; details stay honest-and-empty
    }
  }
  return {
    kind: "conflict",
    details: { baseHeadSha, currentHeadSha, changed },
  }
}

/** All driver reads are UNCONDITIONAL (fresh-binding: never If-None-Match). */
async function tryGetRef(input: SaveDriverInput): Promise<{ sha: string } | BackendWriteError> {
  try {
    const ref = await input.backend.getRef(input.branch)
    return { sha: ref.object.sha }
  } catch (error) {
    return toWriteError(error)
  }
}

async function tryReadTree(
  input: SaveDriverInput,
  headSha: string,
): Promise<TreeRead | BackendWriteError> {
  try {
    const tree = await input.backend.readTree(input.branch, headSha)
    if (tree.kind !== "tree") {
      return new BackendWriteError("UNKNOWN", "tree read returned not-modified unconditionally")
    }
    return tree.tree
  } catch (error) {
    return toWriteError(error)
  }
}

/** Preserve typed descriptors (rate windows!) through read→write vocabulary. */
function toWriteError(error: unknown): BackendWriteError {
  if (isBackendWriteError(error)) return error
  if (error instanceof BackendReadError) {
    return new BackendWriteError(error.code as WriteErrorCode, error.message, {
      ...(error.status === undefined ? {} : { status: error.status }),
      ...(error.retryAfter === undefined ? {} : { retryAfter: error.retryAfter }),
      ...(error.resetAt === undefined ? {} : { resetAt: error.resetAt }),
    })
  }
  const code = (error as BackendReadError | undefined)?.code
  if (typeof code === "string") {
    return new BackendWriteError(code as WriteErrorCode, "read failed")
  }
  return new BackendWriteError(
    "UNKNOWN",
    error instanceof Error ? error.message : "transport failed",
  )
}

function rateOrFailed(error: BackendWriteError, now: () => number): SaveVerdict {
  if (error.code === "RATE_LIMIT") {
    return { kind: "parked", waitMs: describeRatePause(error, now), error }
  }
  return { kind: "failed", error }
}

function normalizeError(error: unknown): BackendWriteError {
  if (isBackendWriteError(error)) return error
  return toWriteError(error)
}
