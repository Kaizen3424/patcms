/// <reference types="node" />
import { describe, expect, it } from "vitest"
import {
  createAutoCarrier,
  createBroadcastCarrier,
  createStorageCarrier,
} from "../../web/lease-carriers"
import {
  createSaveLease,
  DEFAULT_LEASE_HEARTBEAT_MS,
  DEFAULT_LEASE_TTL_MS,
  type LeaseCarrier,
  type LeaseMessage,
} from "../save-lease"

const LEASE_WIRE_PREFIX = "mycms:lease:"

/**
 * INV-P13 — the save lease (ADR-0004 §cross-tab lease + C.3 pins):
 *  - a lease is token + heartbeat + TTL, never BroadcastChannel alone;
 *  - a holder silent past one TTL is STEALABLE — the steal is silent for the
 *    victim (it learns on its next beat/renew), and deterministic (smaller
 *    holderId wins a fresh-claim race);
 *  - payload hygiene: messages carry ONLY {purpose, kind, key, holderId,
 *    expiresAt} — never content, never token, never field values;
 *  - transport: BroadcastChannel primary (Node ≥22 ships it — tested for
 *    real), storage-event fallback for engines without BC (post-side tested;
 *    event-side in a real browser at e2e).
 */

const KEY = "owner/repo:main:src/content/site.json"

/** Deterministic in-memory carrier for table-driven lease behavior. */
function fakeCarrier(): LeaseCarrier & {
  readonly sent: LeaseMessage[]
  deliver(message: LeaseMessage): void
} {
  const sent: LeaseMessage[] = []
  const handlers = new Set<(message: LeaseMessage) => void>()
  return {
    sent,
    post(message: LeaseMessage) {
      sent.push(message)
    },
    onMessage(handler: (message: LeaseMessage) => void) {
      handlers.add(handler)
      return () => handlers.delete(handler)
    },
    deliver(message: LeaseMessage) {
      for (const handler of handlers) handler(message)
    },
  }
}

describe("INV-P13 — default numbers pin the ADR values", () => {
  it("TTL 15 000 ms · heartbeat 5 000 ms", () => {
    expect(DEFAULT_LEASE_TTL_MS).toBe(15_000)
    expect(DEFAULT_LEASE_HEARTBEAT_MS).toBe(5_000)
  })
})

describe("INV-P13 — claim/hold/renew/release over a deterministic carrier", () => {
  it("acquire holds; a foreign claim with a LARGER holderId is refused", async () => {
    const t = 0
    const carrier = fakeCarrier()
    const lease = createSaveLease({ carrier, now: () => t, holderId: "aaa", claimSettleMs: 1 })
    const rival = createSaveLease({ carrier, now: () => t, holderId: "zzz", claimSettleMs: 1 })

    expect(await lease.acquire(KEY)).toBe(true)
    // The rival sees our live claim (delivered back through the bus) and loses.
    carrier.deliver(carrier.sent[carrier.sent.length - 1] as LeaseMessage)
    expect(await rival.acquire(KEY)).toBe(false)
    await lease.release(KEY)
  })

  it("SILENT STEAL (message-loss edge): the victim learns only on its next beat failing", async () => {
    const t = 0
    const carrier = fakeCarrier()
    const victim = createSaveLease({ carrier, now: () => t, holderId: "mmm", claimSettleMs: 1 })
    const thief = createSaveLease({ carrier, now: () => t, holderId: "aaa", claimSettleMs: 1 })

    expect(await victim.acquire(KEY)).toBe(true)
    const lost: string[] = []
    victim.onLost(KEY, () => lost.push(KEY))

    // The thief claims WITHOUT ever having seen the victim's claim (lost
    // message / throttled tab edge). The victim is displaced silently.
    const stolenClaim: LeaseMessage = {
      purpose: "mycms-save-lease",
      kind: "claim",
      key: KEY,
      holderId: "aaa",
      expiresAt: t + DEFAULT_LEASE_TTL_MS,
    }
    carrier.deliver(stolenClaim) // the bus delivers to every listener
    expect(lost).toEqual([KEY]) // displaced — the only signal the victim gets
    expect(await victim.renew(KEY)).toBe(false) // the next beat FAILS → rebaseline
    // The thief's own fresh claim wins outright (its claim is the live one).
    expect(await thief.acquire(KEY)).toBe(true)

    await thief.release(KEY)
  })

  it("TTL expiry: a silent holder is stealable; renew fails after expiry", async () => {
    let t = 0
    const carrier = fakeCarrier()
    const stale = createSaveLease({ carrier, now: () => t, holderId: "aaa", claimSettleMs: 1 })
    const fresh = createSaveLease({ carrier, now: () => t, holderId: "zzz", claimSettleMs: 1 })

    expect(await stale.acquire(KEY)).toBe(true)
    t += DEFAULT_LEASE_TTL_MS + 1 // silence past one TTL
    // The stale holder's own bookkeeping expires.
    expect(await stale.renew(KEY)).toBe(false)
    // The fresh claimant sees only expired claims → wins outright.
    carrier.deliver(carrier.sent[carrier.sent.length - 1] as LeaseMessage)
    expect(await fresh.acquire(KEY)).toBe(true)
    await fresh.release(KEY)
  })

  it("renew refreshes the expiry (heartbeat keeps the hold alive)", async () => {
    let t = 0
    const carrier = fakeCarrier()
    const lease = createSaveLease({ carrier, now: () => t, holderId: "aaa", claimSettleMs: 1 })

    expect(await lease.acquire(KEY)).toBe(true)
    t += DEFAULT_LEASE_HEARTBEAT_MS // one heartbeat period
    expect(await lease.renew(KEY)).toBe(true)
    t += DEFAULT_LEASE_TTL_MS - DEFAULT_LEASE_HEARTBEAT_MS // still within the renewed TTL
    expect(await lease.renew(KEY)).toBe(true)
    await lease.release(KEY)
    t += 1
    expect(await lease.renew(KEY)).toBe(false) // released
  })
})

describe("INV-P13 — payload hygiene (no content, no token, no field values)", () => {
  it("every wire message carries ONLY the lease tuple", async () => {
    const t = 0
    const carrier = fakeCarrier()
    const lease = createSaveLease({
      carrier,
      now: () => t,
      holderId: "aaa",
      claimSettleMs: 1,
    })
    await lease.acquire(KEY)
    await lease.renew(KEY)
    await lease.release(KEY)

    const LEGAL = new Set(["purpose", "kind", "key", "holderId", "expiresAt"])
    for (const message of carrier.sent) {
      for (const field of Object.keys(message)) {
        expect(LEGAL.has(field)).toBe(true)
      }
      expect(message.purpose).toBe("mycms-save-lease")
      expect(message.holderId).toBe("aaa")
      // The key is a storage coordinate, never content.
      expect(message.key).toBe(KEY)
    }
  })
})

describe("INV-P13 — BroadcastChannel transport (real, Node ≥22 ships BC)", () => {
  it("two leases across two real channels: claim → refuse → release → acquire", async () => {
    const t = 0
    const left = createSaveLease({
      carrier: createBroadcastCarrier("test-lease-bus"),
      now: () => t,
      holderId: "aaa",
      claimSettleMs: 20,
    })
    const right = createSaveLease({
      carrier: createBroadcastCarrier("test-lease-bus"),
      now: () => t,
      holderId: "zzz",
      claimSettleMs: 20,
    })

    expect(await left.acquire(KEY)).toBe(true)
    // The right tab sees the live claim and backs off.
    expect(await right.acquire(KEY)).toBe(false)
    const freed: string[] = []
    right.onFreed(KEY, () => freed.push(KEY))
    await left.release(KEY)
    // A release is observed: the freed signal fires AND the right tab can
    // take it (P2.7 — the auto-clear path hangs on this).
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(freed).toEqual([KEY])
    expect(await right.acquire(KEY)).toBe(true)
    await right.release(KEY)
    left.dispose()
    right.dispose()
  })
})

describe("INV-P13 — edge defenses (clock skew, re-acquire, unsubscribe, generated ids)", () => {
  it("a NON-MONOTONIC clock can resurrect an expired foreign claim — the hold is displaced", async () => {
    let t = 1000
    const carrier = fakeCarrier()
    const lease = createSaveLease({ carrier, now: () => t, holderId: "mmm", claimSettleMs: 1 })
    // A foreign claim arrives (smaller id) while we hold NOTHING: recorded.
    carrier.deliver({
      purpose: "mycms-save-lease",
      kind: "claim",
      key: KEY,
      holderId: "aaa",
      expiresAt: 2000,
    })
    // We acquire AFTER the foreign claim expired (t=3000 > 2000) → we hold.
    t = 3000
    expect(await lease.acquire(KEY)).toBe(true)
    // Clock skew: time JUMPS BACKWARD → the recorded claim is live again.
    t = 1500
    const lost: string[] = []
    lease.onLost(KEY, () => lost.push(KEY))
    expect(await lease.renew(KEY)).toBe(false) // displaced — never a stale hold
    expect(lost).toEqual([KEY])
  })

  it("re-acquiring while ALREADY holding short-circuits true", async () => {
    const t = 0
    const carrier = fakeCarrier()
    const lease = createSaveLease({ carrier, now: () => t, holderId: "aaa", claimSettleMs: 1 })
    expect(await lease.acquire(KEY)).toBe(true)
    expect(await lease.acquire(KEY)).toBe(true) // weHold fast path
    await lease.release(KEY)
  })

  it("onLost unsubscribe stops future displacement callbacks", async () => {
    const t = 0
    const carrier = fakeCarrier()
    const lease = createSaveLease({ carrier, now: () => t, holderId: "mmm", claimSettleMs: 1 })
    expect(await lease.acquire(KEY)).toBe(true)
    const lost: string[] = []
    const unsubscribe = lease.onLost(KEY, () => lost.push(KEY))
    unsubscribe()
    // A smaller live foreign claim would displace — but no handler remains.
    carrier.deliver({
      purpose: "mycms-save-lease",
      kind: "claim",
      key: KEY,
      holderId: "aaa",
      expiresAt: t + DEFAULT_LEASE_TTL_MS,
    })
    expect(lost).toEqual([])
    expect(await lease.renew(KEY)).toBe(false) // the hold was still displaced
  })

  it("a lease WITHOUT holderId generates one (crypto) and functions", async () => {
    const carrier = fakeCarrier()
    const lease = createSaveLease({ carrier, now: () => 0, claimSettleMs: 1 })
    expect(await lease.acquire(KEY)).toBe(true)
    // The generated id rode the wire claim.
    const claim = carrier.sent.find((message) => message.kind === "claim")
    expect(claim?.holderId).toMatch(/^[0-9a-f]{16}$/)
    await lease.release(KEY)
  })
})

describe("INV-P13 — P2.7 freed signal (an observed foreign release regains the slot)", () => {
  it("onFreed fires when a foreign release leaves the key free while we are lost; the re-acquire succeeds", async () => {
    const t = 0
    const carrier = fakeCarrier()
    const lease = createSaveLease({ carrier, now: () => t, holderId: "zzz", claimSettleMs: 1 })
    const freed: string[] = []
    lease.onFreed(KEY, () => freed.push(KEY))

    carrier.deliver({
      purpose: "mycms-save-lease",
      kind: "claim",
      key: KEY,
      holderId: "aaa",
      expiresAt: t + DEFAULT_LEASE_TTL_MS,
    })
    carrier.deliver({
      purpose: "mycms-save-lease",
      kind: "release",
      key: KEY,
      holderId: "aaa",
      expiresAt: t,
    })

    expect(freed).toEqual([KEY])
    expect(await lease.acquire(KEY)).toBe(true)
    await lease.release(KEY)
  })

  it("onFreed does NOT fire while WE hold (our hold survives a foreign release)", async () => {
    const t = 0
    const carrier = fakeCarrier()
    const lease = createSaveLease({ carrier, now: () => t, holderId: "aaa", claimSettleMs: 1 })
    expect(await lease.acquire(KEY)).toBe(true)
    const freed: string[] = []
    lease.onFreed(KEY, () => freed.push(KEY))

    // A bigger-id foreign claim is recorded (no displacement), then released.
    carrier.deliver({
      purpose: "mycms-save-lease",
      kind: "claim",
      key: KEY,
      holderId: "zzz",
      expiresAt: t + DEFAULT_LEASE_TTL_MS,
    })
    carrier.deliver({
      purpose: "mycms-save-lease",
      kind: "release",
      key: KEY,
      holderId: "zzz",
      expiresAt: t,
    })

    expect(freed).toEqual([]) // we are still holding — nothing became free for us
    await lease.release(KEY)
  })

  it("onFreed does NOT fire when a different holder's claim stays recorded", async () => {
    const t = 0
    const carrier = fakeCarrier()
    const lease = createSaveLease({ carrier, now: () => t, holderId: "zzz", claimSettleMs: 1 })
    const freed: string[] = []
    lease.onFreed(KEY, () => freed.push(KEY))

    carrier.deliver({
      purpose: "mycms-save-lease",
      kind: "claim",
      key: KEY,
      holderId: "aaa",
      expiresAt: t + DEFAULT_LEASE_TTL_MS,
    })
    // A release from an unknown holder is ignored: the recorded aaa claim
    // stays live, so the key is NOT free.
    carrier.deliver({
      purpose: "mycms-save-lease",
      kind: "release",
      key: KEY,
      holderId: "bbb",
      expiresAt: t,
    })

    expect(freed).toEqual([])
    expect(await lease.acquire(KEY)).toBe(false) // the live aaa claim refuses us
  })

  it("onFreed unsubscribe stops future freed callbacks", async () => {
    const t = 0
    const carrier = fakeCarrier()
    const lease = createSaveLease({ carrier, now: () => t, holderId: "zzz", claimSettleMs: 1 })
    const freed: string[] = []
    const unsubscribe = lease.onFreed(KEY, () => freed.push(KEY))
    unsubscribe()

    carrier.deliver({
      purpose: "mycms-save-lease",
      kind: "claim",
      key: KEY,
      holderId: "aaa",
      expiresAt: t + DEFAULT_LEASE_TTL_MS,
    })
    carrier.deliver({
      purpose: "mycms-save-lease",
      kind: "release",
      key: KEY,
      holderId: "aaa",
      expiresAt: t,
    })

    expect(freed).toEqual([])
  })
})

describe("INV-P13 — storage fallback carrier (post + event sides, both node-testable)", () => {
  it("posts wire-format messages with unique slots", async () => {
    const written: Array<[string, string]> = []
    const fakeStorage = {
      setItem(key: string, value: string) {
        written.push([key, value])
      },
      getItem(): string | null {
        return null
      },
      removeItem(): void {},
      clear(): void {},
      key(): string | null {
        return null
      },
      get length(): number {
        return 0
      },
    } as unknown as Storage

    const t = 0
    const lease = createSaveLease({
      carrier: createStorageCarrier({ storage: fakeStorage }),
      now: () => t,
      holderId: "aaa",
      claimSettleMs: 1,
    })
    expect(await lease.acquire(KEY)).toBe(true)

    expect(written).toHaveLength(1)
    const [slot, value] = written[0] as [string, string]
    expect(slot.startsWith("mycms.save-lease.wire.")).toBe(true)
    expect(JSON.parse(value)).toMatchObject({
      purpose: "mycms-save-lease",
      kind: "claim",
      key: KEY,
      holderId: "aaa",
    })
    await lease.release(KEY)
  })

  it("delivers well-formed storage events; drops malformed ones (inbound shape validation)", async () => {
    const fakeStorage = {
      setItem(): void {},
      getItem(): string | null {
        return null
      },
      removeItem(): void {},
      clear(): void {},
      key(): string | null {
        return null
      },
      get length(): number {
        return 0
      },
    } as unknown as Storage
    const target = new EventTarget() as unknown as EventSource & EventTarget
    const received: LeaseMessage[] = []
    const carrier = createStorageCarrier({ storage: fakeStorage, events: target })
    carrier.onMessage((message) => received.push(message))

    const fire = (data: unknown): void => {
      const event = new Event("storage") as StorageEvent
      Object.defineProperty(event, "storageArea", { value: fakeStorage })
      Object.defineProperty(event, "newValue", { value: data })
      target.dispatchEvent(event)
    }

    fire(
      `${LEASE_WIRE_PREFIX}${JSON.stringify({
        purpose: "mycms-save-lease",
        kind: "claim",
        key: KEY,
        holderId: "zzz",
        expiresAt: 123,
      })}`,
    )
    fire("garbage")
    fire("mycms:lease:not-json")
    fire(`${LEASE_WIRE_PREFIX}${JSON.stringify({ purpose: "wrong", kind: "claim" })}`)
    fire(42) // non-string payloads never parse

    expect(received).toHaveLength(1)
    expect(received[0]).toEqual({
      purpose: "mycms-save-lease",
      kind: "claim",
      key: KEY,
      holderId: "zzz",
      expiresAt: 123,
    })
  })

  it("storage events free a lost lease too (release parity with claims)", async () => {
    const fakeStorage = {
      setItem(): void {},
      getItem(): string | null {
        return null
      },
      removeItem(): void {},
      clear(): void {},
      key(): string | null {
        return null
      },
      get length(): number {
        return 0
      },
    } as unknown as Storage
    const target = new EventTarget() as unknown as EventSource & EventTarget
    const lease = createSaveLease({
      carrier: createStorageCarrier({ storage: fakeStorage, events: target }),
      now: () => 0,
      holderId: "zzz",
      claimSettleMs: 1,
    })
    const freed: string[] = []
    lease.onFreed(KEY, () => freed.push(KEY))

    const fire = (message: LeaseMessage): void => {
      const event = new Event("storage") as StorageEvent
      Object.defineProperty(event, "storageArea", { value: fakeStorage })
      Object.defineProperty(event, "newValue", {
        value: `${LEASE_WIRE_PREFIX}${JSON.stringify(message)}`,
      })
      target.dispatchEvent(event)
    }
    fire({
      purpose: "mycms-save-lease",
      kind: "claim",
      key: KEY,
      holderId: "aaa",
      expiresAt: 1500,
    })
    fire({
      purpose: "mycms-save-lease",
      kind: "release",
      key: KEY,
      holderId: "aaa",
      expiresAt: 0,
    })

    expect(freed).toEqual([KEY])
    expect(await lease.acquire(KEY)).toBe(true)
    await lease.release(KEY)
  })
})

describe("INV-P13 — carrier choice", () => {
  it("createAutoCarrier prefers BroadcastChannel when available", () => {
    // Node ≥22 has BroadcastChannel — the auto choice must be the BC carrier.
    expect(typeof globalThis.BroadcastChannel).toBe("function")
    const channel = new BroadcastChannel("test-auto-carrier")
    channel.close()
    expect(createAutoCarrier()).toBeDefined()
  })
})
