/// <reference lib="dom" />
/**
 * Lease carriers — the transport under the pure `createSaveLease` (ADR-0004
 * §cross-tab lease). BroadcastChannel is the primary carrier; the storage-event
 * fallback serves engines without BC (Safari <15.4). Both carry ONLY the lease
 * payload — never content, never token (INV-P13).
 */
import type { LeaseCarrier, LeaseMessage } from "../../pipeline/save-lease"

const LEASE_WIRE_PREFIX = "patcms:lease:"

/** Minimal listener registry seam — globalThis in browsers, EventTarget in tests. */
interface EventSource {
  addEventListener(type: "storage", listener: (event: StorageEvent) => void): void
  removeEventListener(type: "storage", listener: (event: StorageEvent) => void): void
}

function parseWireMessage(data: unknown): LeaseMessage | undefined {
  if (typeof data !== "string") return undefined
  if (!data.startsWith(LEASE_WIRE_PREFIX)) return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(data.slice(LEASE_WIRE_PREFIX.length))
  } catch {
    return undefined
  }
  if (typeof parsed !== "object" || parsed === null) return undefined
  const record = parsed as Record<string, unknown>
  if (record.purpose !== "patcms-save-lease") return undefined
  if (record.kind !== "claim" && record.kind !== "release") return undefined
  if (typeof record.key !== "string" || typeof record.holderId !== "string") return undefined
  if (typeof record.expiresAt !== "number") return undefined
  return {
    purpose: "patcms-save-lease",
    kind: record.kind,
    key: record.key,
    holderId: record.holderId,
    expiresAt: record.expiresAt,
  }
}

/** BroadcastChannel carrier — same-origin tabs, lowest latency. */
export function createBroadcastCarrier(channelName = "patcms-save-lease"): LeaseCarrier {
  const channel = new BroadcastChannel(channelName)
  return {
    post(message: LeaseMessage) {
      channel.postMessage(`${LEASE_WIRE_PREFIX}${JSON.stringify(message)}`)
    },
    onMessage(handler) {
      const listener = (event: MessageEvent): void => {
        const message = parseWireMessage(event.data)
        if (message !== undefined) handler(message)
      }
      channel.addEventListener("message", listener)
      return () => channel.removeEventListener("message", listener)
    },
  }
}

export interface StorageCarrierOptions {
  readonly storage: Storage
  /** localStorage slot prefix for wire messages. */
  readonly slotKey?: string
  /**
   * Listener registry — globalThis in browsers. Node tests inject an
   * EventTarget (and fire storage-shaped events at it) to exercise the
   * event side without a browser.
   */
  readonly events?: EventSource
}

/**
 * storage-event carrier — writes the wire message into a localStorage slot;
 * the `storage` event fires in OTHER tabs (never self), which is exactly the
 * cross-tab visibility the fallback needs. Self-echo is unnecessary: the pure
 * lease keeps its own view for its own posts.
 */
export function createStorageCarrier(options: StorageCarrierOptions): LeaseCarrier {
  const storage = options.storage
  const slotKey = options.slotKey ?? "patcms.save-lease.wire"
  const events = options.events ?? defaultEventSource()
  return {
    post(message: LeaseMessage) {
      // Unique suffix every post: identical writes would not fire a storage
      // event (value unchanged), so each message gets its own slot revision.
      storage.setItem(`${slotKey}.${Date.now()}.${Math.random()}`, JSON.stringify(message))
    },
    onMessage(handler) {
      if (events === undefined) {
        // Engine without a registry (exotic SSR): the carrier degrades to
        // post-only — the lease still functions within the tab.
        return () => undefined
      }
      const listener = (event: StorageEvent): void => {
        if (event.storageArea !== storage) return
        if (event.newValue === null) return
        const message = parseWireMessage(event.newValue)
        if (message !== undefined) handler(message)
      }
      events.addEventListener("storage", listener)
      return () => events.removeEventListener("storage", listener)
    },
  }
}

function defaultEventSource(): EventSource | undefined {
  const candidate = globalThis as {
    addEventListener?: EventSource["addEventListener"]
    removeEventListener?: EventSource["removeEventListener"]
  }
  if (typeof candidate.addEventListener !== "function") return undefined
  return {
    addEventListener: (type, listener) =>
      (candidate.addEventListener as (t: string, l: unknown) => void)(type, listener),
    removeEventListener: (type, listener) =>
      (candidate.removeEventListener as (t: string, l: unknown) => void)(type, listener),
  }
}

/** Feature-detected carrier choice (BC primary; storage fallback second). */
export function createAutoCarrier(): LeaseCarrier {
  if (typeof globalThis.BroadcastChannel === "function") return createBroadcastCarrier()
  return createStorageCarrier({ storage: globalThis.localStorage })
}
