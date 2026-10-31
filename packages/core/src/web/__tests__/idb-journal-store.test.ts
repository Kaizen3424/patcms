import { describe, expect, it } from "vitest"
import { createMemoryJournalStore } from "../idb-journal-store"

describe("JournalStore (memory reference model)", () => {
  it("appends and lists records in reverse chronological order", async () => {
    const store = createMemoryJournalStore()

    await store.append({
      commitSha: "sha11111111",
      entryId: "products/iris-1",
      collectionName: "products",
      entryTitle: "Iris No. 1",
      path: "content/products/iris-1.json",
      publishedAt: "2026-10-31T10:00:00Z",
      author: "Founder",
      publicUrl: "https://example.com/product/iris-1",
    })

    await store.append({
      commitSha: "sha22222222",
      entryId: "products/iris-2",
      collectionName: "products",
      entryTitle: "Iris No. 2",
      path: "content/products/iris-2.json",
      publishedAt: "2026-10-31T11:00:00Z",
      author: "Founder",
    })

    const list = await store.list()
    expect(list).toHaveLength(2)
    expect(list[0]?.entryTitle).toBe("Iris No. 2")
    expect(list[1]?.entryTitle).toBe("Iris No. 1")
    expect(list[0]?.id).toContain("sha2222")
  })

  it("evicts oldest records when capacity is reached", async () => {
    const store = createMemoryJournalStore(2)

    await store.append({
      commitSha: "sha1",
      entryId: "e1",
      collectionName: "products",
      entryTitle: "Entry 1",
      path: "p1",
      publishedAt: "2026-10-31T10:00:00Z",
      author: "Founder",
    })

    await store.append({
      commitSha: "sha2",
      entryId: "e2",
      collectionName: "products",
      entryTitle: "Entry 2",
      path: "p2",
      publishedAt: "2026-10-31T11:00:00Z",
      author: "Founder",
    })

    await store.append({
      commitSha: "sha3",
      entryId: "e3",
      collectionName: "products",
      entryTitle: "Entry 3",
      path: "p3",
      publishedAt: "2026-10-31T12:00:00Z",
      author: "Founder",
    })

    const list = await store.list()
    expect(list).toHaveLength(2)
    expect(list[0]?.entryTitle).toBe("Entry 3")
    expect(list[1]?.entryTitle).toBe("Entry 2")
  })

  it("notifies subscribers on append and clear", async () => {
    const store = createMemoryJournalStore()
    let notifyCount = 0
    const unsubscribe = store.subscribe(() => {
      notifyCount++
    })

    await store.append({
      commitSha: "sha1",
      entryId: "e1",
      collectionName: "products",
      entryTitle: "Entry 1",
      path: "p1",
      publishedAt: "2026-10-31T10:00:00Z",
      author: "Founder",
    })

    expect(notifyCount).toBe(1)

    await store.clear()
    expect(notifyCount).toBe(2)

    unsubscribe()
    await store.append({
      commitSha: "sha2",
      entryId: "e2",
      collectionName: "products",
      entryTitle: "Entry 2",
      path: "p2",
      publishedAt: "2026-10-31T11:00:00Z",
      author: "Founder",
    })
    expect(notifyCount).toBe(2)
  })
})
