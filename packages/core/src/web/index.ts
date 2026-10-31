/**
 * Node-safe seam — browser-only adapters (IndexedDB drafts, BroadcastChannel
 * lease carriers, sessionStorage fallback) implement the pipeline INTERFACES;
 * core never imports their implementations (01-spec §5, ADR-0001). Drafts and
 * lease types come from the Node-safe modules; only the concrete adapters
 * (idb-keyval, DOM storage/BroadcastChannel) live here.
 */
export interface WebKeyValueStore {
  get(key: string): Promise<unknown>
  set(key: string, value: unknown): Promise<void>
  delete(key: string): Promise<void>
}

export type { SaveDraftPayload } from "../drafts"
export type {
  LeaseCarrier,
  LeaseMessage,
} from "../pipeline/save-lease"
export type { IdbDraftStoreOptions } from "./idb-draft-store"
export { clearIdbDraftStore, createIdbDraftStore } from "./idb-draft-store"
export type {
  IdbJournalStoreOptions,
  JournalRecord,
  JournalStore,
} from "./idb-journal-store"
export {
  createIdbJournalStore,
  createMemoryJournalStore,
} from "./idb-journal-store"
export type {
  IdbOnboardingStoreOptions,
  OnboardingState,
  OnboardingStore,
} from "./idb-onboarding-store"
export {
  createIdbOnboardingStore,
  createMemoryOnboardingStore,
} from "./idb-onboarding-store"
export {
  closeMycmsDatabases,
  createSharedStore,
  MYCMS_IDB_STORES,
  openMycmsDatabase,
} from "./idb-store"
export {
  createAutoCarrier,
  createBroadcastCarrier,
  createStorageCarrier,
} from "./lease-carriers"
export type { IdbTokenStoreOptions } from "./token-stores"
export { createIdbTokenStore, createSessionTokenStore } from "./token-stores"
