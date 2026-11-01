/**
 * In-memory `DraftStore` fallback. Used when IndexedDB is unavailable (private
 * mode, exotic engines) and by admin tests. Crash protection degrades to the
 * lifetime of the tab — never a silent no-op, the editor still writes drafts.
 */
import type { DraftKey, DraftRecord, DraftStore } from "patcms/advanced"

export function createMemoryDraftStore(): DraftStore {
  const records = new Map<DraftKey, DraftRecord>()
  return {
    async get<T>(key: DraftKey): Promise<DraftRecord<T> | undefined> {
      return records.get(key) as DraftRecord<T> | undefined
    },
    async put<T>(record: DraftRecord<T>): Promise<void> {
      records.set(record.key, record as DraftRecord)
    },
    async delete(key: DraftKey): Promise<void> {
      records.delete(key)
    },
    async deletePrefix(prefix: string): Promise<void> {
      for (const key of records.keys()) {
        if (key.startsWith(prefix)) {
          records.delete(key)
        }
      }
    },
    async list(prefix?: DraftKey): Promise<readonly DraftRecord[]> {
      const all = [...records.values()]
      if (prefix === undefined) return all
      return all.filter((record) => record.key.startsWith(prefix))
    },
  }
}
