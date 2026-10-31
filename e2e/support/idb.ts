import type { Page } from "@playwright/test"

interface BrowserIndexedDB {
  open(name: string): {
    onerror: (() => void) | null
    onsuccess: (() => void) | null
    error: unknown
    result: {
      objectStoreNames: { contains(name: string): boolean }
      transaction(
        storeName: string,
        mode: string,
      ): {
        objectStore(name: string): {
          get(key: string): {
            onsuccess: (() => void) | null
            onerror: (() => void) | null
            result: unknown
            error: unknown
          }
        }
      }
    }
  }
}

/** Reads a draft record by key from the `mycms` IndexedDB database inside the browser page. */
export async function readIdbDraft(page: Page, draftKey: string): Promise<unknown> {
  return page.evaluate(async (key) => {
    const idb = (globalThis as unknown as { indexedDB?: BrowserIndexedDB }).indexedDB
    if (!idb) return undefined
    return new Promise((resolve, reject) => {
      const req = idb.open("mycms")
      req.onerror = () => reject(req.error)
      req.onsuccess = () => {
        const db = req.result
        if (!db.objectStoreNames.contains("drafts")) {
          resolve(undefined)
          return
        }
        const tx = db.transaction("drafts", "readonly")
        const store = tx.objectStore("drafts")
        const getReq = store.get(key)
        getReq.onsuccess = () => resolve(getReq.result)
        getReq.onerror = () => reject(getReq.error)
      }
    })
  }, draftKey)
}

/** Writes a record to the `mycms` IndexedDB database inside the browser page. */
export async function putIdbDraft(
  page: Page,
  record: { key: string; [k: string]: unknown },
): Promise<void> {
  return page.evaluate(async (rec) => {
    // biome-ignore lint/suspicious/noExplicitAny: browser indexedDB in evaluate context
    const idb = (globalThis as unknown as { indexedDB?: any }).indexedDB
    if (!idb) return

    // Ensure bytes is a real native Uint8Array inside browser context
    // biome-ignore lint/suspicious/noExplicitAny: inspect value bytes
    const val = rec.value as any
    if (val?.bytes) {
      if (val.bytes.data && Array.isArray(val.bytes.data)) {
        val.bytes = new Uint8Array(val.bytes.data)
      } else if (Array.isArray(val.bytes)) {
        val.bytes = new Uint8Array(val.bytes)
      } else if (typeof val.bytes === "object" && !(val.bytes instanceof Uint8Array)) {
        val.bytes = new Uint8Array(Object.values(val.bytes))
      }
    }

    return new Promise<void>((resolve, reject) => {
      const req = idb.open("mycms")
      req.onerror = () => reject(req.error)
      req.onsuccess = () => {
        const db = req.result
        const tx = db.transaction("drafts", "readwrite")
        const store = tx.objectStore("drafts")
        const putReq = store.put(rec, rec.key)
        putReq.onsuccess = () => resolve()
        putReq.onerror = () => reject(putReq.error)
        tx.onerror = () => reject(tx.error)
        tx.onabort = () => reject(tx.error)
      }
    })
  }, record)
}

/** Lists all records with keys matching prefix from the `mycms` IndexedDB database. */
export async function listIdbDrafts(page: Page, prefix: string): Promise<unknown[]> {
  return page.evaluate(async (pref) => {
    // biome-ignore lint/suspicious/noExplicitAny: browser indexedDB in evaluate context
    const idb = (globalThis as unknown as { indexedDB?: any }).indexedDB
    if (!idb) return []
    return new Promise<unknown[]>((resolve, reject) => {
      const req = idb.open("mycms")
      req.onerror = () => reject(req.error)
      req.onsuccess = () => {
        const db = req.result
        if (!db.objectStoreNames.contains("drafts")) {
          resolve([])
          return
        }
        const tx = db.transaction("drafts", "readonly")
        const store = tx.objectStore("drafts")
        const allReq = store.getAll()
        allReq.onsuccess = () => {
          const results = (allReq.result as Array<{ key: string }>) || []
          resolve(results.filter((r) => r.key?.startsWith(pref)))
        }
        allReq.onerror = () => reject(allReq.error)
        tx.onerror = () => reject(tx.error)
      }
    })
  }, prefix)
}
