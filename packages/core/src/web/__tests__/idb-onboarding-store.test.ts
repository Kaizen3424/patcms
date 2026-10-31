import { describe, expect, it } from "vitest"
import { createMemoryOnboardingStore } from "../idb-onboarding-store"

describe("OnboardingStore", () => {
  it("initializes with default values", async () => {
    const store = createMemoryOnboardingStore()
    const state = await store.get()
    expect(state).toEqual({
      pactDismissed: false,
      tourCompleted: false,
      firstPublishCompleted: false,
    })
  })

  it("updates individual fields and notifies listeners", async () => {
    const store = createMemoryOnboardingStore()
    let notified = 0
    const unsub = store.subscribe(() => {
      notified += 1
    })

    const updated = await store.update({ pactDismissed: true })
    expect(updated.pactDismissed).toBe(true)
    expect(updated.tourCompleted).toBe(false)
    expect(notified).toBe(1)

    const state = await store.get()
    expect(state.pactDismissed).toBe(true)

    unsub()
    await store.update({ tourCompleted: true })
    expect(notified).toBe(1)
  })

  it("resets back to initial state", async () => {
    const store = createMemoryOnboardingStore({
      pactDismissed: true,
      tourCompleted: true,
      firstPublishCompleted: true,
    })
    await store.reset()
    const state = await store.get()
    expect(state).toEqual({
      pactDismissed: false,
      tourCompleted: false,
      firstPublishCompleted: false,
    })
  })
})
