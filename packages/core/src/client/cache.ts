/**
 * Client cache — one tree snapshot per head, entries keyed by path + blob SHA,
 * blobs keyed by content SHA. There is no background refresh: a host calls
 * `cms.refresh()` on focus or on a timer it owns.
 */
import type { TreeRead } from "../backend/types"
import type { Entry } from "./types"

export class ClientCache {
  #headSha: string | undefined
  #tree: TreeRead | undefined
  readonly #entries = new Map<string, Entry>()
  readonly #blobs = new Map<string, Uint8Array>()

  get headSha(): string | undefined {
    return this.#headSha
  }

  getTree(headSha: string): TreeRead | undefined {
    return this.#headSha === headSha ? this.#tree : undefined
  }

  setTree(headSha: string, tree: TreeRead): void {
    this.#headSha = headSha
    this.#tree = tree
    // Drop entries whose bytes moved; their blob SHA is the version key.
    const live = new Map(tree.entries.map((entry) => [entry.path, entry.sha]))
    for (const [path, entry] of this.#entries) {
      if (live.get(path) !== entry.sha) this.#entries.delete(path)
    }
  }

  getEntry(path: string, sha: string): Entry | undefined {
    const entry = this.#entries.get(path)
    return entry !== undefined && entry.sha === sha ? entry : undefined
  }

  putEntry(entry: Entry): void {
    this.#entries.set(entry.path, entry)
  }

  dropEntry(path: string): void {
    this.#entries.delete(path)
  }

  getBlob(sha: string): Uint8Array | undefined {
    return this.#blobs.get(sha)
  }

  putBlob(sha: string, bytes: Uint8Array): void {
    this.#blobs.set(sha, bytes)
  }

  clear(): void {
    this.#headSha = undefined
    this.#tree = undefined
    this.#entries.clear()
    this.#blobs.clear()
  }
}
