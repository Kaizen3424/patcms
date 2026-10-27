/// <reference lib="dom" />
/**
 * Browser token stores — ADR-0002. IndexedDB is the opted-in persistent store;
 * sessionStorage is the per-device fallback. Core never imports these from the
 * Node-safe main entry; hosts import `@mycms/core/web`.
 */
import { del, get, set } from "idb-keyval"
import type { TokenStore } from "../auth"
import { createSharedStore } from "./idb-store"

export interface IdbTokenStoreOptions {
  readonly dbName?: string
  readonly storeName?: string
  readonly key?: string
}

export function createIdbTokenStore(options: IdbTokenStoreOptions = {}): TokenStore {
  const store = createSharedStore(options.dbName ?? "mycms", options.storeName ?? "auth")
  const key = options.key ?? "pat"
  return {
    async read() {
      const value = await get<unknown>(key, store)
      return typeof value === "string" && value.length > 0 ? value : undefined
    },
    async write(token: string) {
      await set(key, token, store)
    },
    async clear() {
      await del(key, store)
    },
  }
}

export function createSessionTokenStore(key = "mycms.pat"): TokenStore {
  return {
    async read() {
      const value = globalThis.sessionStorage?.getItem(key)
      return value === null || value === undefined || value.length === 0 ? undefined : value
    },
    async write(token: string) {
      globalThis.sessionStorage?.setItem(key, token)
    },
    async clear() {
      globalThis.sessionStorage?.removeItem(key)
    },
  }
}
