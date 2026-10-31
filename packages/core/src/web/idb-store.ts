/// <reference lib="dom" />
/**
 * Shared IndexedDB schema opener (ADR-0004 "Shared IndexedDB schema" note).
 *
 * idb-keyval's `createStore(dbName, storeName)` sets `onupgradeneeded` to create
 * ITS store, but that event only fires while the database is being created. Two
 * adapters share one database (`auth` for the PAT — ADR-0002, `drafts` for the
 * editor — ADR-0004), so whichever opened second got `NotFoundError` on its
 * first transaction. This module opens the database once, declares every store
 * up front, and bumps the version when an existing database lacks one.
 *
 * Pure browser adapter: core's Node-safe entry never imports it.
 */
import type { UseStore } from "idb-keyval"

/**
 * The object stores the default `mycms` database owns. A new store is added
 * HERE in the same change that starts using it (ADR-0004 note).
 */
export const MYCMS_IDB_STORES = ["auth", "drafts", "journal", "onboarding", "discards"] as const

interface DbState {
  /** Every store an adapter has asked this database to carry so far. */
  readonly requested: Set<string>
  /** The live connection, or one being opened. */
  pending?: Promise<IDBDatabase>
}

const databases = new Map<string, DbState>()

function stateFor(dbName: string): DbState {
  const existing = databases.get(dbName)
  if (existing !== undefined) return existing
  const created: DbState = { requested: new Set() }
  databases.set(dbName, created)
  return created
}

function createMissingStores(db: IDBDatabase, storeNames: Iterable<string>): void {
  for (const name of storeNames) {
    if (!db.objectStoreNames.contains(name)) db.createObjectStore(name)
  }
}

/**
 * Opens `dbName` carrying every store in `storeNames`. A plain `open` creates
 * the database when missing; an existing database at an older schema is
 * reopened one version up so `onupgradeneeded` can add what is missing.
 */
function openDatabase(dbName: string, storeNames: readonly string[]): Promise<IDBDatabase> {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const connect = (version?: number): void => {
      const request =
        version === undefined ? indexedDB.open(dbName) : indexedDB.open(dbName, version)
      request.onupgradeneeded = () => createMissingStores(request.result, storeNames)
      request.onerror = () => reject(request.error ?? new Error(`IndexedDB open failed: ${dbName}`))
      request.onsuccess = () => {
        const db = request.result
        if (storeNames.every((name) => db.objectStoreNames.contains(name))) {
          resolve(db)
          return
        }
        const nextVersion = db.version + 1
        db.close()
        connect(nextVersion)
      }
    }
    connect()
  })
}

/** Connects and records the connection on the state, evicting it on close. */
function connect(dbName: string, state: DbState): Promise<IDBDatabase> {
  let tracked: Promise<IDBDatabase>
  const evict = (): void => {
    if (state.pending === tracked) state.pending = undefined
  }
  tracked = openDatabase(dbName, [...state.requested]).then(
    (db) => {
      // Another tab upgrading the schema closes this connection; the cache
      // entry drops so the next access reopens at the new version.
      db.onversionchange = () => {
        db.close()
        evict()
      }
      db.onclose = evict
      return db
    },
    (error: unknown) => {
      evict()
      throw error
    },
  )
  state.pending = tracked
  return tracked
}

/**
 * Opens (and caches) `dbName` with at least `storeNames`. Calls are additive:
 * the schema is the union of every store any adapter has asked for.
 */
export async function openMycmsDatabase(
  dbName: string = "mycms",
  storeNames: readonly string[] = MYCMS_IDB_STORES,
): Promise<IDBDatabase> {
  const state = stateFor(dbName)
  for (const name of storeNames) state.requested.add(name)

  for (;;) {
    const db = await (state.pending ?? connect(dbName, state))
    const missing = [...state.requested].some((name) => !db.objectStoreNames.contains(name))
    if (!missing) return db
    // A later adapter joined with a store this connection predates: reopen.
    state.pending = undefined
    db.close()
  }
}

/**
 * idb-keyval `UseStore` bound to one store of the shared database. The store is
 * added to the schema automatically, so a custom store name is always creatable.
 */
export function createSharedStore(dbName: string, storeName: string): UseStore {
  const schema = [...MYCMS_IDB_STORES, storeName]
  return (txMode, callback) =>
    openMycmsDatabase(dbName, schema).then((db) =>
      callback(db.transaction(storeName, txMode).objectStore(storeName)),
    )
}

/** Closes every cached connection (tests / teardown). */
export async function closeMycmsDatabases(): Promise<void> {
  const states = [...databases.values()]
  databases.clear()
  await Promise.all(
    states.map(async (state) => {
      const pending = state.pending
      state.pending = undefined
      if (pending === undefined) return
      await pending.then(
        (db) => db.close(),
        () => undefined,
      )
    }),
  )
}
