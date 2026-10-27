/**
 * Save lease — ADR-0004 §cross-tab lease + C.3 operational pins (INV-P13):
 * BroadcastChannel alone is not a lease. Token + heartbeat + TTL with silent
 * steal; the stealer MUST run a full rebaseline (never a blind re-dispatch).
 * The lease is UX serialization ONLY — the FF/CAS invariant (INV-P01) remains
 * the sole correctness mechanism.
 *
 * Pure over an injected `LeaseCarrier` (message bus) + clock, so Node tests
 * exercise the exact browser behavior; the browser carriers (BroadcastChannel,
 * storage-event fallback for engines without BC) live in `core/web`.
 *
 * Model per key: `ourExpiry` (our hold's epoch expiry) and `foreignClaim`
 * (the latest foreign claim observed). Deterministic tie-break: the SMALLER
 * holderId holds a contested lease. Payload hygiene: messages carry ONLY
 * {purpose, kind, key, holderId, expiresAt} — never content, never token,
 * never field values.
 */

export interface LeaseMessage {
  readonly purpose: "mycms-save-lease"
  readonly kind: "claim" | "release"
  readonly key: string
  readonly holderId: string
  /** Epoch ms — claims expire (TTL); releases are immediate. */
  readonly expiresAt: number
}

export interface LeaseCarrier {
  post(message: LeaseMessage): void
  onMessage(handler: (message: LeaseMessage) => void): () => void
}

export interface SaveLease {
  /** True when WE hold the lease (fresh claim or valid renewal). */
  acquire(key: string): Promise<boolean>
  /** Heartbeat; false = displaced/expired → caller rebaselines. */
  renew(key: string): Promise<boolean>
  release(key: string): Promise<void>
  /** Fires when a foreign claim displaces ours (silent steal). */
  onLost(key: string, handler: () => void): () => void
  /** Stop listening (host teardown / tests). */
  dispose(): void
}

export interface SaveLeaseOptions {
  readonly carrier: LeaseCarrier
  readonly now: () => number
  /** TTL 15 000 ms (ADR-0004 C.3 pins). */
  readonly ttlMs?: number
  /** Heartbeat every 5 000 ms (ADR-0004 C.3 pins). */
  readonly heartbeatMs?: number
  /** Settle window for competing fresh claims (default 150 ms). */
  readonly claimSettleMs?: number
  readonly holderId?: string
}

export const DEFAULT_LEASE_TTL_MS = 15_000
export const DEFAULT_LEASE_HEARTBEAT_MS = 5_000

interface KeyState {
  readonly foreignClaim?: LeaseMessage
  readonly ourExpiry?: number
}

export function createSaveLease(options: SaveLeaseOptions): SaveLease {
  const ttlMs = options.ttlMs ?? DEFAULT_LEASE_TTL_MS
  const settleMs = options.claimSettleMs ?? 150
  const selfId = options.holderId ?? randomHolderId()
  const now = options.now

  const states = new Map<string, KeyState>()
  const lostHandlers = new Map<string, Set<() => void>>()

  const stateOf = (key: string): KeyState => states.get(key) ?? {}

  const fireLost = (key: string): void => {
    states.set(key, { foreignClaim: stateOf(key).foreignClaim })
    for (const handler of lostHandlers.get(key) ?? []) handler()
  }

  const unsubscribe = options.carrier.onMessage((message) => {
    if (message.purpose !== "mycms-save-lease" || message.holderId === selfId) return
    const current = stateOf(message.key)
    if (message.kind === "claim") {
      states.set(message.key, { ...current, foreignClaim: message })
      // Silent steal: a foreign claim with a smaller id displaces our hold.
      if (
        current.ourExpiry !== undefined &&
        current.ourExpiry > now() &&
        message.holderId < selfId
      ) {
        fireLost(message.key)
      }
    } else if (current.foreignClaim?.holderId === message.holderId) {
      // The claim this release pairs with is gone — the key is up for grabs.
      states.set(message.key, { ourExpiry: current.ourExpiry })
    }
  })

  const post = (message: LeaseMessage): void => {
    options.carrier.post(message) // carriers never echo to self
  }

  /** Live foreign claim (unexpired) — expired ones are stealable noise. */
  const liveForeign = (key: string): LeaseMessage | undefined => {
    const claim = stateOf(key).foreignClaim
    if (claim === undefined || claim.expiresAt <= now()) return undefined
    return claim
  }

  const weHold = (key: string): boolean => {
    const current = stateOf(key)
    if (current.ourExpiry === undefined || current.ourExpiry <= now()) {
      states.set(key, { foreignClaim: current.foreignClaim })
      return false
    }
    const foreign = liveForeign(key)
    if (foreign !== undefined && foreign.holderId < selfId) {
      fireLost(key) // displaced while we believed we held
      return false
    }
    return true
  }

  const claim = (key: string): LeaseMessage => ({
    purpose: "mycms-save-lease",
    kind: "claim",
    key,
    holderId: selfId,
    expiresAt: now() + ttlMs,
  })

  return {
    async acquire(key: string): Promise<boolean> {
      if (weHold(key)) return true
      const ours = claim(key)
      post(ours)
      // Settle window: competing claimants answer; the deterministic
      // tie-break (smaller holderId wins) resolves fresh races. The FULL
      // window is observed (never early-exited) so late competitors count.
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, settleMs)
        if (typeof timer === "object" && timer !== null && "unref" in timer) {
          ;(timer as { unref?: () => void }).unref?.()
        }
      })
      const foreign = liveForeign(key)
      if (foreign !== undefined && foreign.holderId < selfId) return false
      // No live foreign claim, or we out-compete it (it backs off on its own).
      states.set(key, { ...stateOf(key), ourExpiry: ours.expiresAt })
      return true
    },

    async renew(key: string): Promise<boolean> {
      if (!weHold(key)) return false
      const ours = claim(key)
      post(ours)
      states.set(key, { ...stateOf(key), ourExpiry: ours.expiresAt })
      return true
    },

    async release(key: string): Promise<void> {
      const current = stateOf(key)
      states.set(key, { foreignClaim: current.foreignClaim })
      post({
        purpose: "mycms-save-lease",
        kind: "release",
        key,
        holderId: selfId,
        expiresAt: now(),
      })
    },

    onLost(key: string, handler: () => void): () => void {
      const handlers = lostHandlers.get(key) ?? new Set()
      handlers.add(handler)
      lostHandlers.set(key, handlers)
      return () => {
        handlers.delete(handler)
      }
    },

    dispose(): void {
      unsubscribe()
      states.clear()
      lostHandlers.clear()
    },
  }
}

function randomHolderId(): string {
  const bytes = new Uint8Array(8)
  crypto.getRandomValues(bytes)
  let hex = ""
  for (const byte of bytes) hex += byte.toString(16).padStart(2, "0")
  return hex
}
