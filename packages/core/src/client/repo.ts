/**
 * Read/write facade over one repository. Owns the "fresh ref before every
 * operation" rule and the single tree snapshot, so entries and media cannot
 * disagree about which head they are looking at.
 *
 * Reads may reuse a head verified less than `readReuseMs` ago (default 30 s);
 * saves always re-bind fresh inside the driver. Concurrent identical reads are
 * single-flight, and entry bodies are addressed by blob SHA (immutable) rather
 * than by path.
 */
import { isEmptyRepoError } from "../backend/errors"
import { GIT_EMPTY_TREE_SHA1 } from "../backend/git-sha"
import { assertNotTruncated } from "../backend/guards"
import type {
  CommitChangeSet,
  CommitLogEntry,
  CommitLogOptions,
  GitBackend,
  TreeEntryTuple,
  TreeRead,
} from "../backend/types"
import type { BackendWriteError } from "../backend/write-errors"
import { runSave, type SaveVerdict } from "../pipeline/save-driver"
import type { ClientCache } from "./cache"
import { CMSError, toCMSError } from "./errors"

export const DEFAULT_READ_REUSE_MS = 30_000

/**
 * The stand-in snapshot for a repository with ZERO commits (ADR-0011): reads
 * must behave exactly like a collection with no files. Git hashes the empty
 * tree deterministically (`GIT_EMPTY_TREE_SHA1`, pinned in git-sha.test.ts),
 * so the snapshot keys, caches, and prunes like any other tree.
 */
function emptyRepoSnapshot(): TreeRead {
  return { sha: GIT_EMPTY_TREE_SHA1, truncated: false, entries: [] as TreeEntryTuple[] }
}

export interface RepoReaderOptions {
  /** How long a verified head may be reused for reads. 0 = always re-check. */
  readonly readReuseMs?: number
  /** Epoch-ms clock (tests inject for deterministic windows). */
  readonly now?: () => number
}

export interface TreeOptions {
  /** Skip the reuse window and re-check the ref now (still reuses the tree). */
  readonly recheck?: boolean
}

export class RepoReader {
  readonly #backend: GitBackend
  readonly #branch: string
  readonly #cache: ClientCache
  readonly #requireToken: () => void
  readonly #readReuseMs: number
  readonly #now: () => number
  #refInFlight: Promise<string | undefined> | undefined
  readonly #treeInFlight = new Map<string, Promise<TreeRead>>()
  readonly #blobInFlight = new Map<string, Promise<Uint8Array>>()

  constructor(
    backend: GitBackend,
    branch: string,
    cache: ClientCache,
    requireToken: () => void,
    options: RepoReaderOptions = {},
  ) {
    this.#backend = backend
    this.#branch = branch
    this.#cache = cache
    this.#requireToken = requireToken
    this.#readReuseMs = options.readReuseMs ?? DEFAULT_READ_REUSE_MS
    this.#now = options.now ?? ((): number => Date.now())
  }

  async tree(options: TreeOptions = {}): Promise<TreeRead> {
    this.#requireToken()
    const now = this.#now()
    if (options.recheck !== true) {
      const recent = this.#cache.getRecentTree(now, this.#readReuseMs)
      if (recent !== undefined) return recent.tree
    }

    const headSha = await this.#headSha()
    if (headSha === undefined) {
      // Empty repository (GitHub answers every branch read 409 "Git Repository
      // is empty", ADR-0011): reads see zero files. Cached under the canonical
      // empty-tree sha like any head; a save's invalidateTree clears it.
      const empty = emptyRepoSnapshot()
      this.#cache.setTree(empty.sha, empty, now)
      return empty
    }
    const cached = this.#cache.getTree(headSha)
    if (cached !== undefined) {
      this.#cache.markVerified(now)
      return cached
    }

    const tree = await this.#readTree(headSha)
    this.#cache.setTree(headSha, tree, now)
    return tree
  }

  async readFile(path: string, blobSha: string): Promise<Uint8Array> {
    this.#requireToken()
    if (blobSha.length > 0) return this.readBlob(blobSha)
    try {
      const read = await this.#backend.readFile(this.#branch, path, blobSha)
      if (read.kind !== "file") {
        throw new CMSError("UNKNOWN", `unexpected not-modified read for ${path}`)
      }
      return read.file.bytes
    } catch (error) {
      throw toCMSError(error)
    }
  }

  async readBlob(sha: string): Promise<Uint8Array> {
    this.#requireToken()
    const cached = this.#cache.getBlob(sha)
    if (cached !== undefined) return cached

    const inFlight = this.#blobInFlight.get(sha)
    if (inFlight !== undefined) return inFlight

    const request = (async () => {
      try {
        const bytes = await this.#backend.readBlob(sha)
        this.#cache.putBlob(sha, bytes)
        return bytes
      } catch (error) {
        throw toCMSError(error)
      }
    })()
    this.#blobInFlight.set(sha, request)
    try {
      return await request
    } finally {
      if (this.#blobInFlight.get(sha) === request) this.#blobInFlight.delete(sha)
    }
  }

  /**
   * Commit log for the branch, newest first. Historical data is not cached:
   * a branch's log moves, and a `before`-paged slice is rare enough to fetch.
   * An empty repository has no commits — an empty log, like empty listings.
   */
  async listCommits(options: CommitLogOptions = {}): Promise<readonly CommitLogEntry[]> {
    this.#requireToken()
    try {
      return await this.#backend.listCommits(this.#branch, options)
    } catch (error) {
      if (isEmptyRepoError(error)) return []
      throw toCMSError(error)
    }
  }

  /**
   * The tree as it stood at a commit. Shares the in-flight map but never the
   * head cache: a historical tree must not be mistaken for the current one.
   */
  async treeAt(commitSha: string): Promise<TreeRead> {
    this.#requireToken()
    return this.#readTree(commitSha)
  }

  async save(
    changes: CommitChangeSet,
    message?: string,
    onAfterWriteFailure?: (error: BackendWriteError) => void,
  ): Promise<SaveVerdict> {
    this.#requireToken()
    try {
      return await runSave({
        backend: this.#backend,
        branch: this.#branch,
        changes,
        ...(message === undefined ? {} : { message }),
        ...(onAfterWriteFailure === undefined ? {} : { onAfterWriteFailure }),
      })
    } catch (error) {
      throw toCMSError(error)
    } finally {
      // Any write attempt may have moved the head (published, conflict, or an
      // unknown outcome). The next read re-checks it; content stays cached.
      this.#cache.invalidateTree()
    }
  }

  /**
   * The branch head, refreshed through a single-flight ref read. Returns
   * `undefined` when the repository has zero commits (ADR-0011: reads see "no
   * content"); every other failure is a `CMSError`.
   */
  async #headSha(): Promise<string | undefined> {
    if (this.#refInFlight !== undefined) return this.#refInFlight

    const request = (async () => {
      try {
        const ref = await this.#backend.getRef(this.#branch)
        return ref.object.sha
      } catch (error) {
        if (isEmptyRepoError(error)) return undefined
        throw toCMSError(error)
      }
    })() as Promise<string | undefined>
    this.#refInFlight = request
    try {
      return await request
    } finally {
      if (this.#refInFlight === request) this.#refInFlight = undefined
    }
  }

  async #readTree(headSha: string): Promise<TreeRead> {
    const inFlight = this.#treeInFlight.get(headSha)
    if (inFlight !== undefined) return inFlight

    const request = (async () => {
      try {
        const read = await this.#backend.readTree(this.#branch, headSha)
        if (read.kind !== "tree") {
          throw new CMSError("UNKNOWN", "unexpected not-modified tree read")
        }
        const guard = assertNotTruncated(read.tree)
        if (!guard.ok) {
          throw new CMSError("UNKNOWN", guard.error.detail)
        }
        return read.tree
      } catch (error) {
        throw toCMSError(error)
      }
    })()
    this.#treeInFlight.set(headSha, request)
    try {
      return await request
    } finally {
      if (this.#treeInFlight.get(headSha) === request) this.#treeInFlight.delete(headSha)
    }
  }
}
