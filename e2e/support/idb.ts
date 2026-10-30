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
