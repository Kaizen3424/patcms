/**
 * Session publish journal (ADR-0008 P2.8 appendix): `entryId -> latestCommitSha`
 * filled from the `published` verdict. A reload starts empty — the persistent
 * journal is P5.2 work and an explicit non-goal here.
 */

import { describe, expect, it, vi } from "vitest"
import { createPublishStore } from "../publish-store"

const ROCK = "products/rock"
const IRIS = "products/iris"
const SHA_A = "a".repeat(40)
const SHA_B = "b".repeat(40)

describe("publish store", () => {
  it("records the latest sha per entry and notifies only on change", () => {
    const store = createPublishStore()
    const listener = vi.fn()
    store.subscribe(listener)

    expect(store.shaFor(ROCK)).toBeUndefined()
    store.publish(ROCK, SHA_A)
    expect(store.shaFor(ROCK)).toBe(SHA_A)
    expect(listener).toHaveBeenCalledTimes(1)

    store.publish(ROCK, SHA_A)
    expect(listener).toHaveBeenCalledTimes(1)

    store.publish(ROCK, SHA_B)
    expect(store.shaFor(ROCK)).toBe(SHA_B)
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it("keeps entries independent", () => {
    const store = createPublishStore()
    store.publish(ROCK, SHA_A)
    store.publish(IRIS, SHA_B)
    expect(store.shaFor(ROCK)).toBe(SHA_A)
    expect(store.shaFor(IRIS)).toBe(SHA_B)
  })

  it("stops notifying after unsubscribe", () => {
    const store = createPublishStore()
    const listener = vi.fn()
    const unsubscribe = store.subscribe(listener)
    unsubscribe()
    store.publish(ROCK, SHA_A)
    expect(listener).not.toHaveBeenCalled()
    expect(store.shaFor(ROCK)).toBe(SHA_A)
  })

  it("clear() empties the journal once and notifies subscribers", () => {
    const store = createPublishStore()
    const listener = vi.fn()
    store.subscribe(listener)
    store.publish(ROCK, SHA_A)

    store.clear()
    expect(store.shaFor(ROCK)).toBeUndefined()
    expect(listener).toHaveBeenCalledTimes(2)

    store.clear()
    expect(listener).toHaveBeenCalledTimes(2)
  })
})
