/// <reference lib="dom" />
/**
 * IndexedDB Publish Journal store (P5.2).
 * Persists recent commit/publish records in the shared "mycms" database under the "journal" store.
 * Framework-free adapter with memory fallback for testing.
 */
import { clear, del, get, keys, set } from "idb-keyval"
import { createSharedStore } from "patcms/web"

export interface JournalRecord {
  readonly id: string
  readonly commitSha: string
  readonly entryId: string
  readonly collectionName: string
  readonly entryTitle: string
  readonly path: string
  readonly publishedAt: string
  readonly author: string
  readonly publicUrl?: string
}

export interface JournalStore {
  append(record: Omit<JournalRecord, "id">): Promise<JournalRecord>
  list(options?: { readonly limit?: number }): Promise<readonly JournalRecord[]>
  clear(): Promise<void>
  subscribe(listener: () => void): () => void
}

export interface IdbJournalStoreOptions {
  readonly dbName?: string
  readonly storeName?: string
  readonly maxRecords?: number
}

const DEFAULT_MAX_RECORDS = 100

function asRecord(value: unknown): JournalRecord | undefined {
  if (typeof value !== "object" || value === null) return undefined
  const r = value as Partial<JournalRecord>
  if (
    typeof r.id !== "string" ||
    typeof r.commitSha !== "string" ||
    typeof r.entryId !== "string" ||
    typeof r.collectionName !== "string" ||
    typeof r.entryTitle !== "string" ||
    typeof r.path !== "string" ||
    typeof r.publishedAt !== "string" ||
    typeof r.author !== "string"
  ) {
    return undefined
  }
  return value as JournalRecord
}

export function createIdbJournalStore(options: IdbJournalStoreOptions = {}): JournalStore {
  const store = createSharedStore(options.dbName ?? "mycms", options.storeName ?? "journal")
  const maxRecords = options.maxRecords ?? DEFAULT_MAX_RECORDS
  const listeners = new Set<() => void>()

  const notify = (): void => {
    for (const listener of listeners) listener()
  }

  return {
    async append(item: Omit<JournalRecord, "id">): Promise<JournalRecord> {
      const id = `${item.publishedAt}_${item.commitSha.slice(0, 7)}`
      const record: JournalRecord = { ...item, id }
      await set(id, record, store)

      // Evict oldest if exceeding capacity
      const allKeys = await keys(store)
      if (allKeys.length > maxRecords) {
        const sorted = allKeys.filter((k): k is string => typeof k === "string").sort() // chronological by publishedAt prefix
        const excess = sorted.slice(0, sorted.length - maxRecords)
        for (const k of excess) {
          await del(k, store)
        }
      }

      notify()
      return record
    },

    async list(opts?: { readonly limit?: number }): Promise<readonly JournalRecord[]> {
      const allKeys = await keys(store)
      const sortedKeys = allKeys
        .filter((k): k is string => typeof k === "string")
        .sort()
        .reverse() // newest first

      const limit = opts?.limit ?? maxRecords
      const keysToFetch = sortedKeys.slice(0, limit)

      const records: JournalRecord[] = []
      for (const key of keysToFetch) {
        const raw = await get<unknown>(key, store)
        const record = asRecord(raw)
        if (record) records.push(record)
      }
      return records
    },

    async clear(): Promise<void> {
      await clear(store)
      notify()
    },

    subscribe(listener: () => void): () => void {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}

export function createMemoryJournalStore(maxRecords = DEFAULT_MAX_RECORDS): JournalStore {
  const records = new Map<string, JournalRecord>()
  const listeners = new Set<() => void>()

  const notify = (): void => {
    for (const listener of listeners) listener()
  }

  return {
    async append(item: Omit<JournalRecord, "id">): Promise<JournalRecord> {
      const id = `${item.publishedAt}_${item.commitSha.slice(0, 7)}`
      const record: JournalRecord = { ...item, id }
      records.set(id, record)

      if (records.size > maxRecords) {
        const oldestKey = [...records.keys()].sort()[0]
        if (oldestKey) records.delete(oldestKey)
      }

      notify()
      return record
    },

    async list(opts?: { readonly limit?: number }): Promise<readonly JournalRecord[]> {
      const sorted = [...records.values()].sort((a, b) =>
        b.publishedAt.localeCompare(a.publishedAt),
      )
      const limit = opts?.limit ?? maxRecords
      return sorted.slice(0, limit)
    },

    async clear(): Promise<void> {
      records.clear()
      notify()
    },

    subscribe(listener: () => void): () => void {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}
