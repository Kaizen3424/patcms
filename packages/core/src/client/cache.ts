/**
 * Client cache — one tree snapshot per head, entries keyed by path + blob SHA,
 * blobs keyed by content SHA (LRU-bounded). There is no background refresh: a
 * host calls `cms.refresh()` on focus or on a timer it owns.
 *
 * `verifiedAt` records when the head was last confirmed against GitHub. Reads
 * may reuse that confirmation for `readReuseMs` (RepoReader); writes never do.
 */
import type { TreeRead } from "../backend/types"
import type { ParseIssue } from "../fields/parse"
import type { Entry } from "./types"

/**
 * A parsed entry plus the issues that do not depend on the rest of the
 * repository. Relation issues are recomputed on every read, so a cache hit
 * still reflects the current tree.
 */
export interface CachedEntry {
  readonly entry: Entry
  readonly localIssues: readonly ParseIssue[]
}

export interface ClientCacheOptions {
  /** Soft cap for cached media bytes. A single larger blob is not cached. */
  readonly maxBlobBytes?: number
  readonly maxBlobEntries?: number
}

const DEFAULT_MAX_BLOB_BYTES = 64 * 1024 * 1024
const DEFAULT_MAX_BLOB_ENTRIES = 256

export class ClientCache {
  #headSha: string | undefined
  #tree: TreeRead | undefined
  #verifiedAt = 0
  readonly #entries = new Map<string, CachedEntry>()
  readonly #blobs = new Map<string, Uint8Array>()
  readonly #maxBlobBytes: number
  readonly #maxBlobEntries: number
  #blobBytes = 0

  constructor(options: ClientCacheOptions = {}) {
    this.#maxBlobBytes = options.maxBlobBytes ?? DEFAULT_MAX_BLOB_BYTES
    this.#maxBlobEntries = options.maxBlobEntries ?? DEFAULT_MAX_BLOB_ENTRIES
  }

  get headSha(): string | undefined {
    return this.#headSha
  }

  get verifiedAt(): number {
    return this.#verifiedAt
  }

  getTree(headSha: string): TreeRead | undefined {
    return this.#headSha === headSha ? this.#tree : undefined
  }

  /**
   * A head confirmed less than `maxAgeMs` ago, including its tree. Returns
   * undefined when there is no confirmation or the window has expired.
   */
  getRecentTree(now: number, maxAgeMs: number): { headSha: string; tree: TreeRead } | undefined {
    if (maxAgeMs <= 0) return undefined
    if (this.#tree === undefined || this.#headSha === undefined) return undefined
    if (now - this.#verifiedAt > maxAgeMs) return undefined
    return { headSha: this.#headSha, tree: this.#tree }
  }

  /** Marks the CURRENT head as freshly confirmed; no-op without a tree. */
  markVerified(now: number = Date.now()): void {
    if (this.#tree !== undefined) this.#verifiedAt = now
  }

  setTree(headSha: string, tree: TreeRead, now: number = Date.now()): void {
    this.#headSha = headSha
    this.#tree = tree
    this.#verifiedAt = now
    // Drop entries whose bytes moved; their blob SHA is the version key.
    const live = new Map(tree.entries.map((entry) => [entry.path, entry.sha]))
    for (const [path, cached] of this.#entries) {
      if (live.get(path) !== cached.entry.sha) this.#entries.delete(path)
    }
  }

  /**
   * Forgets the head confirmation but keeps content-addressed entries and
   * blobs. The next read re-checks the ref and reuses the tree when the head
   * did not move.
   */
  invalidateTree(): void {
    this.#verifiedAt = 0
  }

  getEntry(path: string, sha: string): CachedEntry | undefined {
    const cached = this.#entries.get(path)
    return cached !== undefined && cached.entry.sha === sha ? cached : undefined
  }

  putEntry(cached: CachedEntry): void {
    this.#entries.set(cached.entry.path, cached)
  }

  dropEntry(path: string): void {
    this.#entries.delete(path)
  }

  getBlob(sha: string): Uint8Array | undefined {
    const bytes = this.#blobs.get(sha)
    if (bytes === undefined) return undefined
    // Refresh recency without changing the byte count.
    this.#blobs.delete(sha)
    this.#blobs.set(sha, bytes)
    return bytes
  }

  putBlob(sha: string, bytes: Uint8Array): void {
    const existing = this.#blobs.get(sha)
    if (existing !== undefined) {
      this.#blobBytes -= existing.byteLength
      this.#blobs.delete(sha)
    }
    if (bytes.byteLength > this.#maxBlobBytes) return
    this.#blobs.set(sha, bytes)
    this.#blobBytes += bytes.byteLength
    this.#evictBlobs()
  }

  clear(): void {
    this.#headSha = undefined
    this.#tree = undefined
    this.#verifiedAt = 0
    this.#entries.clear()
    this.#blobs.clear()
    this.#blobBytes = 0
  }

  #evictBlobs(): void {
    while (
      this.#blobs.size > this.#maxBlobEntries ||
      (this.#blobBytes > this.#maxBlobBytes && this.#blobs.size > 0)
    ) {
      const oldest = this.#blobs.keys().next()
      if (oldest.done === true) return
      const bytes = this.#blobs.get(oldest.value)
      if (bytes !== undefined) this.#blobBytes -= bytes.byteLength
      this.#blobs.delete(oldest.value)
    }
  }
}
