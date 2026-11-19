/**
 * `patcms/web` — the browser-only adapters a headless host needs: an IndexedDB
 * draft store and the token stores. Everything else in the package is
 * Node-safe, so this entry is the only one that touches DOM globals.
 *
 * A host that keeps drafts in memory (the default) does not need this entry at
 * all; the main package never imports it.
 */

export type { ContentStore, ContentStoreKey } from "../client/content-store"
export { contentStoreKey } from "../client/content-store"
export type { SaveDraftPayload } from "../drafts"
export type { IdbContentStoreOptions } from "./idb-content-store"
export { clearIdbContentStore, createIdbContentStore } from "./idb-content-store"
export type { IdbDraftStoreOptions } from "./idb-draft-store"
export { clearIdbDraftStore, createIdbDraftStore } from "./idb-draft-store"
export {
  closePatcmsDatabases,
  createSharedStore,
  openPatcmsDatabase,
  PATCMS_IDB_STORES,
} from "./idb-store"
export type { IdbTokenStoreOptions } from "./token-stores"
export { createIdbTokenStore, createSessionTokenStore } from "./token-stores"
