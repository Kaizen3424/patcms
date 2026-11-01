import { describe, expect, it } from "vitest"
import { createMemoryDiscardStore } from "../idb-discard-store"

describe("DiscardStore", () => {
  it("records discarded values with preview", async () => {
    const store = createMemoryDiscardStore()
    const record = await store.record({
      draftKey: "entry-1",
      entryPath: "src/content/products/chair.json",
      fieldPath: "title",
      discardedValue: "Old Chair Title",
      formattedPreview: "Old Chair Title",
    })

    expect(record.id).toBeTruthy()
    expect(record.discardedAt).toBeTruthy()
    expect(record.formattedPreview).toBe("Old Chair Title")

    const list = await store.list("entry-1")
    expect(list.length).toBe(1)
    expect(list[0]?.fieldPath).toBe("title")
  })

  it("evicts records older than maxAge", async () => {
    const store = createMemoryDiscardStore({ maxAgeMs: 5000 })
    await store.record({
      draftKey: "entry-1",
      entryPath: "src/content/products/chair.json",
      fieldPath: "title",
      discardedValue: "Old",
      formattedPreview: "Old",
    })

    const initial = await store.list()
    expect(initial.length).toBe(1)

    // Evict after 10 seconds
    const evicted = await store.evictStale(0) // maxAge = 0 means everything is stale
    expect(evicted).toBe(1)

    const remaining = await store.list()
    expect(remaining.length).toBe(0)
  })

  it("enforces maxRecords cap", async () => {
    const store = createMemoryDiscardStore({ maxRecords: 3 })
    for (let i = 0; i < 5; i++) {
      await store.record({
        draftKey: "entry-1",
        entryPath: "src/content/products/chair.json",
        fieldPath: `field_${i}`,
        discardedValue: `val_${i}`,
        formattedPreview: `val_${i}`,
      })
    }

    const list = await store.list()
    expect(list.length).toBeLessThanOrEqual(3)
  })
})
