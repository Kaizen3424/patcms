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
 * (the latest foreign claim observed) + their stamps (`ourHoldStamp` = the
 * post-time of the claim that ESTABLISHED our hold, kept across renewals;
 * `foreignSeenAt` = first observation of the tracked foreign claim — a
 * renewal by the SAME holder keeps it, so a heart-beating hold stays
 * "pre-existing" to later claimants). Deterministic tie-break: the SMALLER
 * holderId wins a CONTEMPORANEOUS fresh-claim race (claims first observed
 * within the settle window). A claim that PREDATES our post is a live hold:
 * acquire refuses it regardless of id, and a hold is NEVER displaced by a
 * claim arrival (P2.7 pins — a live, heart-beating editor must never be
 * silently stolen from; the victim learns only when its own beat fails).
 * Payload hygiene: messages carry ONLY
 * {purpose, kind, key, holderId, expiresAt} — never content, never token,
 * never field values.
 *
 * A tab that LOST the lease regains the slot on an OBSERVED free (`onFreed`):
 * a foreign release leaving the key with no live claim. Silent TTL expiry
 * travels no wire signal — the manual re-check covers that path (ADR-0004
 * P2.7 pins; never a timed auto-acquire, which could steal from a live
 * editor that a throttled browser merely silenced).
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
  /**
   * Fires when an observed foreign `release` leaves the key with no live
   * foreign claim and we do not hold — the key is free for our re-acquire.
   * Silent TTL expiry fires nothing (nothing traveled the wire).
   */
  onFreed(key: string, handler: () => void): () => void
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
  /** Epoch ms — FIRST observation of `foreignClaim` (same-holder renewals keep it). */
  readonly foreignSeenAt?: number
  readonly ourExpiry?: number
  /** Epoch ms — when the claim that ESTABLISHED our hold was posted; renewals keep it. */
  readonly ourHoldStamp?: number
}

export function createSaveLease(options: SaveLeaseOptions): SaveLease {
  const ttlMs = options.ttlMs ?? DEFAULT_LEASE_TTL_MS
  const settleMs = options.claimSettleMs ?? 150
  const selfId = options.holderId ?? randomHolderId()
  const now = options.now

  const states = new Map<string, KeyState>()
  const lostHandlers = new Map<string, Set<() => void>>()
  const freedHandlers = new Map<string, Set<() => void>>()

  const stateOf = (key: string): KeyState => states.get(key) ?? {}

  const fireLost = (key: string): void => {
    const current = stateOf(key)
    states.set(key, {
      foreignClaim: current.foreignClaim,
      foreignSeenAt: current.foreignSeenAt,
    })
    for (const handler of lostHandlers.get(key) ?? []) handler()
  }

  const unsubscribe = options.carrier.onMessage((message) => {
    if (message.purpose !== "mycms-save-lease" || message.holderId === selfId) return
    const current = stateOf(message.key)
    if (message.kind === "claim") {
      // A RENEWAL by the same holder keeps its first-observation stamp, so a
      // heart-beating hold stays pre-existing to later claimants; a new
      // holderId stamps fresh.
      const stamp =
        current.foreignClaim?.holderId === message.holderId && current.foreignSeenAt !== undefined
          ? current.foreignSeenAt
          : now()
      states.set(message.key, {
        ...current,
        foreignClaim: message,
        foreignSeenAt: stamp,
      })
      // A claim arrival NEVER displaces our hold (P2.7). We record it and let
      // acquire/weHold apply the law: pre-existing → refuse; our own beat
      // failing → we step down. No id-based steal of a live hold.
    } else if (current.foreignClaim?.holderId === message.holderId) {
      // The claim this release pairs with is gone — the key is up for grabs.
      states.set(message.key, { ourExpiry: current.ourExpiry, ourHoldStamp: current.ourHoldStamp })
      // A lost tab regains the slot ONLY on an observed free (ADR-0004 P2.7
      // pins): fire when we do not hold and nothing else now claims the key
      // live. Silent TTL expiry never fires this — the wire never saw it.
      if (current.ourExpiry === undefined || current.ourExpiry <= now()) {
        if (liveForeign(message.key) === undefined) {
          for (const handler of freedHandlers.get(message.key) ?? []) handler()
        }
      }
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
      states.set(key, { foreignClaim: current.foreignClaim, foreignSeenAt: current.foreignSeenAt })
      return false
    }
    // Discovery defense (clock-skew / delayed delivery): if a live foreign
    // claim turns out to PREDATE our hold, we acquired into an existing hold
    // and step down honestly (the beat fails — the victim learns late, as the
    // ADR's silent-steal wording allows).
    const foreign = liveForeign(key)
    if (
      foreign !== undefined &&
      current.ourHoldStamp !== undefined &&
      current.foreignSeenAt !== undefined &&
      current.foreignSeenAt < current.ourHoldStamp - settleMs
    ) {
      fireLost(key)
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
      const postedAt = now()
      // Settle window: competing claimants answer. The FULL window is
      // observed (never early-exited) so late competitors count.
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, settleMs)
        if (typeof timer === "object" && timer !== null && "unref" in timer) {
          ;(timer as { unref?: () => void }).unref?.()
        }
      })
      const foreign = liveForeign(key)
      const foreignSeenAt = stateOf(key).foreignSeenAt
      if (
        foreign !== undefined &&
        foreignSeenAt !== undefined &&
        foreignSeenAt < postedAt - settleMs
      ) {
        // P2.7 pin: a claim predating our post is a LIVE hold — we came
        // second and refuse regardless of id (the settle-window grace
        // absorbs message-order inversions in a millisecond race). A
        // silent holder is stealable only once its claim EXPIRED, which
        // `liveForeign` already filters.
        return false
      }
      if (foreign !== undefined && foreign.holderId < selfId) {
        // Contemporaneous fresh-claim race — the deterministic tie-break.
        return false
      }
      // No live foreign claim, or we out-compete a contemporaneous rival
      // (it backs off on its own).
      states.set(key, { ...stateOf(key), ourExpiry: ours.expiresAt, ourHoldStamp: postedAt })
      return true
    },

    async renew(key: string): Promise<boolean> {
      if (!weHold(key)) return false
      const ours = claim(key)
      post(ours)
      // A renewal continues the SAME hold: `ourHoldStamp` stays, so any pre-
      // existing claim we somehow missed keeps our step-down guard armed.
      states.set(key, { ...stateOf(key), ourExpiry: ours.expiresAt })
      return true
    },

    async release(key: string): Promise<void> {
      const current = stateOf(key)
      states.set(key, {
        foreignClaim: current.foreignClaim,
        foreignSeenAt: current.foreignSeenAt,
      })
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

    onFreed(key: string, handler: () => void): () => void {
      const handlers = freedHandlers.get(key) ?? new Set()
      handlers.add(handler)
      freedHandlers.set(key, handlers)
      return () => {
        handlers.delete(handler)
      }
    },

    dispose(): void {
      unsubscribe()
      states.clear()
      lostHandlers.clear()
      freedHandlers.clear()
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
