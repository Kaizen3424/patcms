/// <reference lib="dom" />
/**
 * IndexedDB Discard store (P5.5).
 * Persists overwritten/discarded field values during conflict resolution
 * in the shared "mycms" database under the "discards" store.
 * 30-day TTL eviction + max 50 records per repo.
 */
import { clear, del, get, keys, set } from "idb-keyval"
import { createSharedStore } from "./idb-store"

export interface DiscardRecord {
  readonly id: string
  readonly draftKey: string
  readonly entryPath: string
  readonly fieldPath: string
  readonly discardedAt: string
  readonly discardedValue: unknown
  readonly formattedPreview: string
}

export interface DiscardStore {
  record(entry: Omit<DiscardRecord, "id" | "discardedAt">): Promise<DiscardRecord>
  list(draftKey?: string): Promise<readonly DiscardRecord[]>
  evictStale(maxAgeMs?: number, maxRecords?: number): Promise<number>
  clear(): Promise<void>
}

export interface IdbDiscardStoreOptions {
  readonly dbName?: string
  readonly storeName?: string
  readonly maxAgeMs?: number
  readonly maxRecords?: number
}

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000
const DEFAULT_MAX_RECORDS = 50

export function createIdbDiscardStore(options: IdbDiscardStoreOptions = {}): DiscardStore {
  const store = createSharedStore(options.dbName ?? "mycms", options.storeName ?? "discards")
  const defaultMaxAge = options.maxAgeMs ?? THIRTY_DAYS_MS
  const defaultMaxRecords = options.maxRecords ?? DEFAULT_MAX_RECORDS

  return {
    async record(entry: Omit<DiscardRecord, "id" | "discardedAt">): Promise<DiscardRecord> {
      await this.evictStale(defaultMaxAge, defaultMaxRecords - 1)

      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
      const record: DiscardRecord = {
        ...entry,
        id,
        discardedAt: new Date().toISOString(),
      }
      try {
        await set(id, record, store)
      } catch {
        // fail-soft
      }
      return record
    },

    async list(draftKey?: string): Promise<readonly DiscardRecord[]> {
      try {
        const allKeys = await keys(store)
        const records: DiscardRecord[] = []
        for (const k of allKeys) {
          const item = await get<DiscardRecord>(k, store)
          if (item && (!draftKey || item.draftKey === draftKey)) {
            records.push(item)
          }
        }
        return records.sort((a, b) => b.discardedAt.localeCompare(a.discardedAt))
      } catch {
        return []
      }
    },

    async evictStale(maxAgeMs = defaultMaxAge, maxRecords = defaultMaxRecords): Promise<number> {
      try {
        const allKeys = await keys(store)
        let evicted = 0
        const now = Date.now()
        const valid: DiscardRecord[] = []

        for (const k of allKeys) {
          const item = await get<DiscardRecord>(k, store)
          if (!item) continue
          const age = now - new Date(item.discardedAt).getTime()
          if (age >= maxAgeMs) {
            await del(k, store)
            evicted += 1
          } else {
            valid.push(item)
          }
        }

        if (valid.length > maxRecords) {
          valid.sort((a, b) => a.discardedAt.localeCompare(b.discardedAt))
          const excess = valid.slice(0, valid.length - maxRecords)
          for (const item of excess) {
            await del(item.id, store)
            evicted += 1
          }
        }
        return evicted
      } catch {
        return 0
      }
    },

    async clear(): Promise<void> {
      try {
        await clear(store)
      } catch {
        // fail-soft
      }
    },
  }
}

export function createMemoryDiscardStore(
  options: { readonly maxAgeMs?: number; readonly maxRecords?: number } = {},
): DiscardStore {
  const records = new Map<string, DiscardRecord>()
  const defaultMaxAge = options.maxAgeMs ?? THIRTY_DAYS_MS
  const defaultMaxRecords = options.maxRecords ?? DEFAULT_MAX_RECORDS

  return {
    async record(entry: Omit<DiscardRecord, "id" | "discardedAt">): Promise<DiscardRecord> {
      await this.evictStale(defaultMaxAge, defaultMaxRecords - 1)
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
      const record: DiscardRecord = {
        ...entry,
        id,
        discardedAt: new Date().toISOString(),
      }
      records.set(id, record)
      return record
    },

    async list(draftKey?: string): Promise<readonly DiscardRecord[]> {
      const list = [...records.values()].filter((r) => !draftKey || r.draftKey === draftKey)
      return list.sort((a, b) => b.discardedAt.localeCompare(a.discardedAt))
    },

    async evictStale(maxAgeMs = defaultMaxAge, maxRecords = defaultMaxRecords): Promise<number> {
      let evicted = 0
      const now = Date.now()
      for (const [id, r] of records.entries()) {
        const age = now - new Date(r.discardedAt).getTime()
        if (age >= maxAgeMs) {
          records.delete(id)
          evicted += 1
        }
      }
      if (records.size > maxRecords) {
        const sorted = [...records.values()].sort((a, b) =>
          a.discardedAt.localeCompare(b.discardedAt),
        )
        const excess = sorted.slice(0, sorted.length - maxRecords)
        for (const item of excess) {
          records.delete(item.id)
          evicted += 1
        }
      }
      return evicted
    },

    async clear(): Promise<void> {
      records.clear()
    },
  }
}
