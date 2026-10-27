/// <reference lib="dom" />
/**
 * IndexedDB draft store — the browser implementation of the Node-safe
 * `DraftStore` seam (01-spec §5; ADR-0004 C.3 pins). Uses idb-keyval (already
 * the token-store dependency — no new packages). Entry drafts are keyed
 * `${repo}/${collection}/${slug}`; staged media tiles key alongside (P4);
 * settings docs key by file path.
 */
import { clear, createStore, del, get, keys, set } from "idb-keyval"
import type { DraftKey, DraftRecord, DraftStore } from "../drafts"

export interface IdbDraftStoreOptions {
  readonly dbName?: string
  readonly storeName?: string
}

export function createIdbDraftStore(options: IdbDraftStoreOptions = {}): DraftStore {
  const store = createStore(options.dbName ?? "mycms", options.storeName ?? "drafts")

  const asRecord = (value: unknown): DraftRecord | undefined => {
    if (typeof value !== "object" || value === null) return undefined
    const record = value as Partial<DraftRecord>
    if (typeof record.key !== "string" || typeof record.savedAt !== "string") return undefined
    if (!("value" in record)) return undefined
    return value as DraftRecord
  }

  return {
    async get<T>(key: DraftKey): Promise<DraftRecord<T> | undefined> {
      const value = await get<unknown>(key, store)
      return asRecord(value) as DraftRecord<T> | undefined
    },
    async put<T>(record: DraftRecord<T>): Promise<void> {
      await set(record.key, record, store)
    },
    async delete(key: DraftKey): Promise<void> {
      await del(key, store)
    },
    async list(prefix?: string): Promise<readonly DraftRecord[]> {
      const all = await keys(store)
      const records: DraftRecord[] = []
      for (const key of all) {
        if (typeof key !== "string") continue
        if (prefix !== undefined && !key.startsWith(prefix)) continue
        const value = await get<unknown>(key, store)
        const record = asRecord(value)
        if (record !== undefined) records.push(record)
      }
      return records
    },
  }
}

/** Test/SSR helper: empties the draft database (never touches auth). */
export async function clearIdbDraftStore(options: IdbDraftStoreOptions = {}): Promise<void> {
  await clear(createStore(options.dbName ?? "mycms", options.storeName ?? "drafts"))
}
