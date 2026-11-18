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
import { assertNotTruncated } from "../backend/guards"
import type { CommitChangeSet, GitBackend, TreeRead } from "../backend/types"
import type { BackendWriteError } from "../backend/write-errors"
import { runSave, type SaveVerdict } from "../pipeline/save-driver"
import type { ClientCache } from "./cache"
import { CMSError, toCMSError } from "./errors"

export const DEFAULT_READ_REUSE_MS = 30_000

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
  #refInFlight: Promise<string> | undefined
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

  async #headSha(): Promise<string> {
    if (this.#refInFlight !== undefined) return this.#refInFlight

    const request = (async () => {
      try {
        const ref = await this.#backend.getRef(this.#branch)
        return ref.object.sha
      } catch (error) {
        throw toCMSError(error)
      }
    })()
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
