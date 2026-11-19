/**
 * The browser adapter's logic — key shape, bulk reads, pruning, bounds — with
 * the idb-keyval calls replaced by a Map. No IndexedDB shim or new dependency.
 */
import { describe, expect, it, vi } from "vitest"

const backing = vi.hoisted(() => new Map<string, unknown>())

vi.mock("idb-keyval", () => ({
  get: async (key: string) => backing.get(key),
  set: async (key: string, value: unknown) => {
    backing.set(key, value)
  },
  getMany: async (keys: string[]) => keys.map((key) => backing.get(key)),
  keys: async () => [...backing.keys()],
  delMany: async (keys: string[]) => {
    for (const key of keys) backing.delete(key)
  },
  entries: async () => [...backing.entries()],
  clear: async () => {
    backing.clear()
  },
}))

import { clearIdbContentStore, createIdbContentStore } from "../idb-content-store"

const key = (path: string, sha: string) => ({ path, sha })

describe("createIdbContentStore", () => {
  it("stores raw text under path + sha and reads it back in bulk", async () => {
    backing.clear()
    const store = createIdbContentStore()
    await store.put(key("src/content/posts/a.json", "sha-a"), '{"title":"A"}')
    await store.put(key("src/content/posts/b.json", "sha-b"), '{"title":"B"}')

    expect([...backing.keys()]).toEqual([
      "src/content/posts/a.json\u0000sha-a",
      "src/content/posts/b.json\u0000sha-b",
    ])
    expect(await store.get(key("src/content/posts/a.json", "sha-a"))).toBe('{"title":"A"}')
    const bulk = await store.getMany?.([
      key("src/content/posts/a.json", "sha-a"),
      key("src/content/posts/b.json", "missing-sha"),
    ])
    expect([...(bulk?.entries() ?? [])]).toEqual([
      ["src/content/posts/a.json\u0000sha-a", '{"title":"A"}'],
    ])
  })

  it("prune drops records no longer reachable from the branch", async () => {
    backing.clear()
    const store = createIdbContentStore()
    await store.put(key("src/content/posts/a.json", "sha-a"), "old")
    await store.put(key("src/content/posts/a.json", "sha-new"), "new")

    await store.prune([key("src/content/posts/a.json", "sha-new")])
    expect([...backing.keys()]).toEqual(["src/content/posts/a.json\u0000sha-new"])
  })

  it("evicts the oldest records once the caps are passed", async () => {
    backing.clear()
    const store = createIdbContentStore({ maxEntries: 2 })
    await store.put(key("a", "1"), "a")
    await store.put(key("b", "2"), "b")
    await store.put(key("c", "3"), "c")

    expect(backing.size).toBe(2)
    expect(backing.has("b\u00002")).toBe(true)
    expect(backing.has("c\u00003")).toBe(true)
  })

  it("clear empties the content store", async () => {
    backing.clear()
    const store = createIdbContentStore()
    await store.put(key("a", "1"), "a")
    await store.put(key("b", "2"), "b")

    await store.clear()
    expect(backing.size).toBe(0)
    await store.put(key("c", "3"), "c")
    await clearIdbContentStore()
    expect(backing.size).toBe(0)
  })
})
