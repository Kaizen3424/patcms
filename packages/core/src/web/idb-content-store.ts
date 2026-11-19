/// <reference lib="dom" />
/**
 * IndexedDB content cache — the browser implementation of `ContentStore`.
 *
 * Records are keyed by `${path}\0${sha}` and hold the RAW JSON text, never a
 * parsed value: a schema change cannot corrupt the cache, and parsing is cheap.
 * Keys are immutable, so a foreign push simply misses instead of overwriting.
 *
 * Bounds: a soft byte cap and a record cap evict the oldest records; `prune()`
 * drops records no longer reachable from the branch. Both are best-effort —
 * the caller treats a store failure as a miss, not a read error.
 */
import { clear, delMany, entries, get, getMany as idbGetMany, keys, set } from "idb-keyval"
import type { ContentStore, ContentStoreKey } from "../client/content-store"
import { contentStoreKey } from "../client/content-store"
import { createSharedStore } from "./idb-store"

export interface IdbContentStoreOptions {
  readonly dbName?: string
  readonly storeName?: string
  /** Soft cap on stored text; oldest records go first. Default 8 MiB. */
  readonly maxBytes?: number
  /** Hard cap on record count. Default 2000. */
  readonly maxEntries?: number
}

interface StoredContent {
  readonly text: string
  readonly savedAt: number
}

const DEFAULT_MAX_BYTES = 8 * 1024 * 1024
const DEFAULT_MAX_ENTRIES = 2000

export function createIdbContentStore(options: IdbContentStoreOptions = {}): ContentStore {
  const store = createSharedStore(options.dbName ?? "patcms", options.storeName ?? "content")
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES

  let seeded = false
  let count = 0
  let bytes = 0

  const asRecord = (value: unknown): StoredContent | undefined => {
    if (typeof value !== "object" || value === null) return undefined
    const record = value as Partial<StoredContent>
    if (typeof record.text !== "string" || typeof record.savedAt !== "number") return undefined
    return record as StoredContent
  }

  async function seed(): Promise<void> {
    if (seeded) return
    const all = await entries<IDBValidKey, unknown>(store)
    count = all.length
    bytes = 0
    for (const [, value] of all) {
      const record = asRecord(value)
      if (record !== undefined) bytes += record.text.length
    }
    seeded = true
  }

  async function enforceCap(): Promise<void> {
    if (count <= maxEntries && bytes <= maxBytes) return
    const all = await entries<IDBValidKey, unknown>(store)
    const ranked = all
      .map(([key, value]) => ({ key, record: asRecord(value) }))
      .filter((row): row is { key: IDBValidKey; record: StoredContent } => row.record !== undefined)
      .sort((left, right) => left.record.savedAt - right.record.savedAt)
    let drop = 0
    let remainingBytes = bytes
    let remainingCount = count
    while (drop < ranked.length && (remainingCount > maxEntries || remainingBytes > maxBytes)) {
      remainingBytes -= ranked[drop]?.record.text.length ?? 0
      remainingCount -= 1
      drop += 1
    }
    if (drop === 0) return
    await delMany(
      ranked.slice(0, drop).map((row) => row.key),
      store,
    )
    count = remainingCount
    bytes = remainingBytes
  }

  return {
    async get(key: ContentStoreKey): Promise<string | undefined> {
      const record = asRecord(await get<unknown>(contentStoreKey(key), store))
      return record?.text
    },

    async getMany(asked: readonly ContentStoreKey[]): Promise<ReadonlyMap<string, string>> {
      if (asked.length === 0) return new Map()
      const values = await idbGetMany<unknown>(
        asked.map((key) => contentStoreKey(key)),
        store,
      )
      const hits = new Map<string, string>()
      for (const [index, key] of asked.entries()) {
        const record = asRecord(values[index])
        if (record !== undefined) hits.set(contentStoreKey(key), record.text)
      }
      return hits
    },

    async put(key: ContentStoreKey, text: string): Promise<void> {
      await seed()
      await set(contentStoreKey(key), { text, savedAt: Date.now() }, store)
      count += 1
      bytes += text.length
      await enforceCap()
    },

    async prune(live: readonly ContentStoreKey[]): Promise<void> {
      // Only entries reach this store, so the live set is entry path + sha.
      const reachable = new Set(live.map(contentStoreKey))
      const all = await keys<IDBValidKey>(store)
      const stale = all.filter((key) => typeof key === "string" && !reachable.has(key))
      if (stale.length === 0) return
      await delMany(stale, store)
      seeded = false // counters are stale; the next write reseeds them
    },

    async clear(): Promise<void> {
      await clear(store)
      seeded = false
      count = 0
      bytes = 0
    },
  }
}

/** Test/SSR helper: empties only the content store (never drafts or auth). */
export async function clearIdbContentStore(options: IdbContentStoreOptions = {}): Promise<void> {
  await clear(createSharedStore(options.dbName ?? "patcms", options.storeName ?? "content"))
}
