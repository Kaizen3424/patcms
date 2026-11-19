/**
 * On-device content cache — the seam that makes a cold start cheap.
 *
 * Records are keyed by `path` + blob SHA. A SHA names immutable bytes, so a hit
 * can never serve a different revision of the file: when the branch moves, the
 * new tree carries a new SHA and the old record simply misses.
 *
 * `patcms/web` ships the IndexedDB adapter (`createIdbContentStore`). Core
 * never touches a device store itself, and without one reads behave as before.
 * A store is a cache, never a source of truth: a failed read falls back to the
 * network, and a failed write is ignored.
 */
export interface ContentStoreKey {
  readonly path: string
  /** Git blob SHA of the exact bytes stored under `path`. */
  readonly sha: string
}

/** Stable in-memory map key for bulk reads; never persisted as-is. */
export function contentStoreKey(key: ContentStoreKey): string {
  return `${key.path}\u0000${key.sha}`
}

export interface ContentStore {
  /** Stored text for exactly these bytes, or `undefined` on a miss. */
  get(key: ContentStoreKey): Promise<string | undefined>
  put(key: ContentStoreKey, text: string): Promise<void>
  /**
   * Bulk read used by `entries.list`. Only hits are returned, keyed by
   * `contentStoreKey`. Optional: without it, `list` reads records one by one.
   */
  getMany?(keys: readonly ContentStoreKey[]): Promise<ReadonlyMap<string, string>>
  /** Deletes records whose bytes are no longer reachable from the branch. */
  prune(live: readonly ContentStoreKey[]): Promise<void>
  /** Wipes the store (sign-out, or an explicit "clear cache"). */
  clear(): Promise<void>
}
