/**
 * Read/write facade over one repository. Owns the "fresh ref before every
 * operation" rule and the single tree snapshot, so entries and media cannot
 * disagree about which head they are looking at.
 */
import { assertNotTruncated } from "../backend/guards"
import type { CommitChangeSet, GitBackend, TreeRead } from "../backend/types"
import type { BackendWriteError } from "../backend/write-errors"
import { runSave, type SaveVerdict } from "../pipeline/save-driver"
import type { ClientCache } from "./cache"
import { CMSError, toCMSError } from "./errors"

export class RepoReader {
  readonly #backend: GitBackend
  readonly #branch: string
  readonly #cache: ClientCache
  readonly #requireToken: () => void

  constructor(backend: GitBackend, branch: string, cache: ClientCache, requireToken: () => void) {
    this.#backend = backend
    this.#branch = branch
    this.#cache = cache
    this.#requireToken = requireToken
  }

  async tree(): Promise<TreeRead> {
    this.#requireToken()
    let headSha: string
    try {
      const ref = await this.#backend.getRef(this.#branch)
      headSha = ref.object.sha
    } catch (error) {
      throw toCMSError(error)
    }

    const cached = this.#cache.getTree(headSha)
    if (cached !== undefined) return cached

    let read: Awaited<ReturnType<GitBackend["readTree"]>>
    try {
      read = await this.#backend.readTree(this.#branch, headSha)
    } catch (error) {
      throw toCMSError(error)
    }
    if (read.kind !== "tree") {
      throw new CMSError("UNKNOWN", "unexpected not-modified tree read")
    }

    const guard = assertNotTruncated(read.tree)
    if (!guard.ok) {
      throw new CMSError("UNKNOWN", guard.error.detail)
    }
    this.#cache.setTree(headSha, read.tree)
    return read.tree
  }

  async readFile(path: string, blobSha: string): Promise<Uint8Array> {
    this.#requireToken()
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
    try {
      const bytes = await this.#backend.readBlob(sha)
      this.#cache.putBlob(sha, bytes)
      return bytes
    } catch (error) {
      throw toCMSError(error)
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
    }
  }
}
