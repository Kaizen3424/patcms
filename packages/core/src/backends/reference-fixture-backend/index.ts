/**
 * Reference-fixture backend — ADR-0009 exemplar 2.
 *
 * Zero-network GitBackend over fixture trees. Its acceptance gate is passing
 * the SAME shared contract suite as GithubBackend (ADR-0009 §4). P1 implements
 * the read surface; write plumbing stays a typed refusal until P2.
 */

import { BackendReadError } from "../../backend/errors"
import {
  type GitTreeEntry,
  gitBlobSha,
  gitCommitShaCanonical,
  gitTreeSha,
} from "../../backend/git-sha"
import type {
  CheckRunsRead,
  CommitChangeSet,
  CommitOptions,
  CommitResult,
  CommitStatusesRead,
  FileRead,
  GitBackend,
  GitBackendCapabilities,
  ReadFileOptions,
  ReadFileResult,
  ReadTreeOptions,
  ReadTreeResult,
  Ref,
  TreeEntryTuple,
} from "../../backend/types"
import { BackendWriteError } from "../../backend/write-errors"
import { encodeUtf8 } from "../../safety/encoding"

/** Typed refusal for unimplemented plumbing — callers switch on `code`. */
export class ContractStubNotImplementedError extends Error {
  override readonly name = "ContractStubNotImplementedError"
  /** `readonly code` as a literal to keep the failure class machine-matchable. */
  readonly code = "STUB_NOT_IMPLEMENTED"

  constructor(what: string) {
    super(`reference-fixture-backend not implemented: ${what}`)
  }
}

export interface FixtureFile {
  readonly bytes: Uint8Array
  readonly sha: string
  readonly etag?: string
}

export interface FixtureRepoSpec {
  /** Head commit sha of the fixture tree (data, not a code literal). */
  readonly headSha: string
  readonly treeSha?: string
  readonly etag?: string
  readonly capabilities?: Partial<GitBackendCapabilities>
  readonly files?: ReadonlyMap<string, FixtureFile>
}

/** Convenience builder for text fixtures (UTF-8 bytes, explicit blob sha). */
export function textFixtureFile(text: string, sha: string, etag?: string): FixtureFile {
  return { bytes: encodeUtf8(text), sha, ...(etag === undefined ? {} : { etag }) }
}

export class FixtureBackend implements GitBackend {
  readonly #branchHeads = new Map<string, string>()
  readonly #snapshots = new Map<string, ReadonlyMap<string, FixtureFile>>()
  readonly #spec: FixtureRepoSpec

  constructor(spec: FixtureRepoSpec) {
    this.#spec = spec
    if (spec.files !== undefined) this.#snapshots.set(spec.headSha, spec.files)
  }

  /** Test hook for future ref-state plumbing (P1/P2). */
  setBranchHead(branch: string, sha: string): void {
    this.#branchHeads.set(branch, sha)
  }

  /** Test hook: register a tree snapshot by commit sha. */
  setSnapshot(sha: string, files: ReadonlyMap<string, FixtureFile>): void {
    this.#snapshots.set(sha, files)
  }

  get capabilities(): GitBackendCapabilities {
    return { commitStatus: true, branches: true, ...this.#spec.capabilities }
  }

  async getRef(branch: string): Promise<Ref> {
    const sha = this.#branchHeads.get(branch) ?? this.#spec.headSha
    return { ref: `refs/heads/${branch}`, object: { sha, type: "commit" } }
  }

  async readCheckRuns(branch: string, sha: string): Promise<CheckRunsRead> {
    if (!this.capabilities.commitStatus) return { kind: "unsupported" }
    requireStatusArgs(branch, sha)
    // The exemplar hosts no status data; empty is truthful, not invented.
    return { kind: "ok", totalCount: 0, runs: [] }
  }

  async readCommitStatuses(branch: string, sha: string): Promise<CommitStatusesRead> {
    if (!this.capabilities.commitStatus) return { kind: "unsupported" }
    requireStatusArgs(branch, sha)
    return { kind: "ok", statuses: [] }
  }

  async readTree(
    branch: string,
    commitSha: string,
    options: ReadTreeOptions = {},
  ): Promise<ReadTreeResult> {
    const sha = commitSha.length > 0 ? commitSha : (await this.getRef(branch)).object.sha
    const snapshot = this.#snapshots.get(sha)
    if (snapshot === undefined) {
      throw new BackendReadError("NOT_FOUND", `fixture tree not found: ${sha}`)
    }
    if (this.#spec.etag !== undefined && options.etag === this.#spec.etag) {
      return { kind: "not-modified", etag: this.#spec.etag }
    }
    const entries: TreeEntryTuple[] = [...snapshot.keys()].sort().map((path) => {
      const file = snapshot.get(path)
      if (file === undefined)
        throw new BackendReadError("UNKNOWN", `fixture file vanished: ${path}`)
      return { path, sha: file.sha, mode: "100644", type: "blob", size: file.bytes.length }
    })
    return {
      kind: "tree",
      tree: { sha: this.#spec.treeSha ?? sha, truncated: false, entries },
      ...(this.#spec.etag === undefined ? {} : { etag: this.#spec.etag }),
    }
  }

  async readFile(
    branch: string,
    path: string,
    blobSha: string,
    options: ReadFileOptions = {},
  ): Promise<ReadFileResult> {
    const head = this.#branchHeads.get(branch) ?? this.#spec.headSha
    const snapshot = this.#snapshots.get(head)
    if (snapshot === undefined)
      throw new BackendReadError("NOT_FOUND", `fixture branch not found: ${branch}`)
    const file = snapshot.get(path)
    if (file === undefined)
      throw new BackendReadError("NOT_FOUND", `fixture file not found: ${path}`)
    if (blobSha.length > 0 && blobSha !== file.sha) {
      throw new BackendReadError("NOT_FOUND", `fixture blob not found: ${blobSha}`)
    }
    if (file.etag !== undefined && options.etag === file.etag) {
      return { kind: "not-modified", etag: file.etag }
    }
    const read: FileRead = {
      path,
      sha: file.sha,
      bytes: Uint8Array.from(file.bytes),
      size: file.bytes.length,
    }
    return { kind: "file", file: read, ...(file.etag === undefined ? {} : { etag: file.etag }) }
  }

  async readBlob(sha: string): Promise<Uint8Array> {
    for (const snapshot of this.#snapshots.values()) {
      for (const file of snapshot.values()) {
        if (file.sha === sha) return file.bytes
      }
    }
    throw new BackendReadError("NOT_FOUND", `fixture blob not found: ${sha}`)
  }

  async listChangedFiles(
    _branch: string,
    baseSha: string,
    headSha: string,
  ): Promise<ReadonlyMap<string, TreeEntryTuple>> {
    if (baseSha === headSha) return new Map()
    const base = this.#snapshots.get(baseSha)
    const head = this.#snapshots.get(headSha)
    if (base === undefined || head === undefined) {
      throw new BackendReadError("NOT_FOUND", "fixture snapshot not found for tree diff")
    }
    const changed = new Map<string, TreeEntryTuple>()
    for (const [path, file] of head) {
      const before = base.get(path)
      if (before === undefined || before.sha !== file.sha) {
        changed.set(path, { path, sha: file.sha, mode: "100644", type: "blob" })
      }
    }
    return changed
  }

  async commitChanges(
    changes: CommitChangeSet,
    baseHeadSha: string,
    branch: string,
    options: CommitOptions = {},
  ): Promise<CommitResult> {
    const current = this.#branchHeads.get(branch) ?? this.#spec.headSha
    if (current !== baseHeadSha) {
      throw new BackendWriteError(
        "CAS_CONFLICT",
        `fixture branch ${branch} no longer points at ${baseHeadSha}`,
        {},
      )
    }
    const base = this.#snapshots.get(baseHeadSha)
    if (base === undefined) {
      throw new BackendWriteError("NOT_FOUND", `fixture snapshot missing: ${baseHeadSha}`, {})
    }

    const next = new Map(base)
    const writes = [...(changes.adds ?? []), ...(changes.updates ?? [])]
    for (const write of writes) {
      next.set(write.path, { bytes: write.bytes, sha: await gitBlobSha(write.bytes) })
    }
    for (const path of changes.deletes ?? []) {
      next.delete(path)
    }

    const entries: GitTreeEntry[] = [...next.entries()]
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([path, file]) => ({ path, mode: "100644", type: "blob", sha: file.sha }))
    const treeSha = await gitTreeSha(entries)
    const commitSha = await gitCommitShaCanonical({
      treeSha,
      parentShas: [current],
      message: options.message ?? defaultFixtureCommitMessage(changes),
    })
    if (!this.#snapshots.has(commitSha)) {
      this.#snapshots.set(commitSha, next)
      this.#branchHeads.set(branch, commitSha)
    }
    // Idempotent retry: equal content resolves to the same commit sha (INV-P03).
    return { commitSha, treeSha }
  }
}

function requireStatusArgs(branch: string, sha: string): void {
  if (branch.length === 0) throw new BackendReadError("UNKNOWN", "branch must not be empty")
  if (sha.length === 0) throw new BackendReadError("UNKNOWN", "commit sha must not be empty")
}

/** Machine-checkable content-commit default (AGENTS.md §4; ADR-0008 §4). */
function defaultFixtureCommitMessage(changes: CommitChangeSet): string {
  const count =
    (changes.adds?.length ?? 0) + (changes.updates?.length ?? 0) + (changes.deletes?.length ?? 0)
  return `chore(cms): save ${count} file(s)`
}
