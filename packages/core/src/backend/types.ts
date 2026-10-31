/**
 * GitBackend contract — ADR-0005.
 *
 * Transport law: this is the ONLY GitHub surface core knows about. Transactional
 * git-data commits (blobs → tree with `base_tree` → commit → FF-only `updateRef`).
 * Branch is a parameter on EVERY method — zero hard-coded branch names anywhere
 * in backend/pipeline (INV-P14, standing veto on `main` literals).
 */

export interface RefObject {
  readonly sha: string
  readonly type: string
}

export interface Ref {
  readonly ref: string
  readonly object: RefObject
}

/** Tuple equality is `{sha, mode, type}` — mode/type-only foreign drift is never silently applied (INV-P06). */
export interface TreeEntryTuple {
  /** Repo-relative POSIX path (ADR-0005 P1 addendum). */
  readonly path: string
  readonly sha: string
  readonly mode: string
  readonly type: string
  /** Byte size of blob entries from git trees (ADR-0005 P4 addendum). */
  readonly size?: number
}

/** Recursive root-tree read result (ADR-0005 §reads). Callers MUST run `assertNotTruncated` (INV-N02). */
export interface TreeRead {
  readonly sha: string
  readonly truncated: boolean
  readonly entries: readonly TreeEntryTuple[]
}

/** File bytes read from the contents/git-blobs routes (never raw.githubusercontent). */
export interface FileRead {
  readonly path: string
  readonly sha: string
  readonly bytes: Uint8Array
  readonly size: number
}

export interface ReadTreeOptions {
  /** ETag from a previous read; backend sends If-None-Match and may return not-modified. */
  readonly etag?: string
}

export interface ReadFileOptions {
  readonly etag?: string
}

export type ReadTreeResult =
  | { readonly kind: "tree"; readonly tree: TreeRead; readonly etag?: string }
  | { readonly kind: "not-modified"; readonly etag?: string }

export type ReadFileResult =
  | { readonly kind: "file"; readonly file: FileRead; readonly etag?: string }
  | { readonly kind: "not-modified"; readonly etag?: string }

export interface FileWrite {
  readonly path: string
  /** Serialized bytes — the canonical serializer (P1) owns encoding; the backend never re-serializes. */
  readonly bytes: Uint8Array
}

export interface CommitChangeSet {
  readonly adds?: readonly FileWrite[]
  readonly updates?: readonly FileWrite[]
  /** Deletions are repo-relative paths (safePath-validated upstream, ADR-0006). */
  readonly deletes?: readonly string[]
}

export interface CommitResult {
  readonly commitSha: string
  readonly treeSha: string
}

/** Deploy-status reads (ADR-0008 P2.8 appendix; ADR-0005 P2.8 addendum). */
export type CheckRunStatus =
  | "queued"
  | "in_progress"
  | "completed"
  | "pending"
  | "requested"
  | "waiting"

export type CheckRunConclusion =
  | "success"
  | "failure"
  | "neutral"
  | "cancelled"
  | "skipped"
  | "timed_out"
  | "action_required"
  | "stale"

export interface CheckRunSummary {
  readonly id: number
  readonly name: string
  readonly status: CheckRunStatus
  /** null until completed; unknown values are normalized to null by readers. */
  readonly conclusion: CheckRunConclusion | null
  /** Only https URLs survive parsing (ADR-0006 render rules). */
  readonly detailsUrl?: string
}

export type CheckRunsRead =
  | {
      readonly kind: "ok"
      readonly totalCount: number
      readonly runs: readonly CheckRunSummary[]
    }
  | { readonly kind: "unsupported" }

export type CommitStatusState = "error" | "failure" | "pending" | "success"

export interface CommitStatusSummary {
  readonly context: string
  readonly state: CommitStatusState
  readonly targetUrl?: string
}

export type CommitStatusesRead =
  | { readonly kind: "ok"; readonly statuses: readonly CommitStatusSummary[] }
  | { readonly kind: "unsupported" }

/**
 * Capability object — exhaustive, compile-time literal (ADR-0005 §capabilities):
 * adding a key here breaks every backend implementation until it declares it.
 * Optional method-shaped capabilities are accessed ONLY after a capability check.
 */
export interface GitBackendCapabilities {
  /** Check-runs deploy-status pipeline usable with this token (ADR-0008). */
  readonly commitStatus: boolean
  /** Branch listing/mutability checks (FF-only CAS) apply. */
  readonly branches: boolean
}

/**
 * Commit context (ADR-0005 P2 addendum): `createCommit` requires a message; the
 * pipeline supplies the machine-checkable `chore(cms): …` default (ADR-0008 §4
 * skip-token law polices user-editable messages — pure pipeline concern).
 */
export interface CommitOptions {
  readonly message?: string
}

export interface GitBackend {
  readonly capabilities: GitBackendCapabilities
  getRef(branch: string): Promise<Ref>
  readTree(branch: string, commitSha: string, options?: ReadTreeOptions): Promise<ReadTreeResult>
  readFile(
    branch: string,
    path: string,
    blobSha: string,
    options?: ReadFileOptions,
  ): Promise<ReadFileResult>
  /** Content-addressed blob read (never takes branch or path; ADR-0007 §4). */
  readBlob(sha: string): Promise<Uint8Array>
  listChangedFiles(
    branch: string,
    baseSha: string,
    headSha: string,
  ): Promise<ReadonlyMap<string, TreeEntryTuple>>
  commitChanges(
    changes: CommitChangeSet,
    baseHeadSha: string,
    branch: string,
    options?: CommitOptions,
  ): Promise<CommitResult>
  /** Check-runs truth for one commit (gated by `capabilities.commitStatus`). */
  readCheckRuns(branch: string, sha: string): Promise<CheckRunsRead>
  /** Commit-statuses fallback (gated by `capabilities.commitStatus`). */
  readCommitStatuses(branch: string, sha: string): Promise<CommitStatusesRead>
}
