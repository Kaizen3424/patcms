/**
 * On-device cache economics. A fresh client over the same store must open a
 * collection without downloading bodies; only bytes whose SHA moved may cross
 * the network, and the device copy is wiped on sign-out.
 */
import { describe, expect, it } from "vitest"
import { z } from "zod"
import {
  buildSpecFromBytes,
  createHarness,
  type FakeGithubHarness,
} from "../../__tests__/support/fake-github-fetch"
import { defineCollection, defineConfig } from "../../config"
import { number, slug, string } from "../../fields"
import type { ContentStore, ContentStoreKey } from "../content-store"
import { contentStoreKey } from "../content-store"
import { createCMS } from "../create-cms"

const config = defineConfig({
  media: { folder: "public/images", publicFolder: "/images" },
  collections: [
    defineCollection({
      name: "products",
      label: "Products",
      folder: "src/content/products",
      identifierField: "title",
      schema: z.object({
        title: string({ label: "Title" }),
        price: number({ label: "Price" }),
        slug: slug({ label: "Slug" }),
      }),
    }),
  ],
})

const REPOSITORY = {
  owner: "fixture-owner",
  repo: "fixture-repo",
  branch: "fixture-branch",
  baseUrl: "https://unit.test",
} as const

function entryText(price: number): string {
  return `${JSON.stringify({ title: "Item 1", price }, null, 2)}\n`
}

function files(priceOfItem1 = 1): Array<[string, Uint8Array]> {
  return [0, 1, 2].map((index) => [
    `src/content/products/item-${index}.json`,
    new TextEncoder().encode(
      index === 1
        ? entryText(priceOfItem1)
        : `${JSON.stringify({ title: `Item ${index}`, price: index }, null, 2)}\n`,
    ),
  ])
}

class MemoryContentStore implements ContentStore {
  readonly data = new Map<string, string>()
  bulkReads = 0
  prunes = 0
  failReads = false

  async get(key: ContentStoreKey): Promise<string | undefined> {
    if (this.failReads) throw new Error("device store blocked")
    return this.data.get(contentStoreKey(key))
  }

  async put(key: ContentStoreKey, text: string): Promise<void> {
    this.data.set(contentStoreKey(key), text)
  }

  async getMany(asked: readonly ContentStoreKey[]): Promise<ReadonlyMap<string, string>> {
    this.bulkReads += 1
    const hits = new Map<string, string>()
    for (const key of asked) {
      const text = this.data.get(contentStoreKey(key))
      if (text !== undefined) hits.set(contentStoreKey(key), text)
    }
    return hits
  }

  async prune(live: readonly ContentStoreKey[]): Promise<void> {
    this.prunes += 1
    const reachable = new Set(live.map(contentStoreKey))
    for (const key of this.data.keys()) {
      if (!reachable.has(key)) this.data.delete(key)
    }
  }

  async clear(): Promise<void> {
    this.data.clear()
  }
}

async function session(
  store: ContentStore,
  price = 1,
): Promise<{
  cms: ReturnType<typeof createCMS>
  harness: FakeGithubHarness
}> {
  const harness = createHarness(await buildSpecFromBytes(files(price)))
  const cms = createCMS({
    config,
    repository: REPOSITORY,
    token: "t",
    fetch: harness.fetch,
    contentStore: store,
  })
  return { cms, harness }
}

function blobRequests(harness: FakeGithubHarness, from: number): string[] {
  return harness.server.log
    .slice(from)
    .filter((event) => event.method === "GET" && event.path.startsWith("/git/blobs/"))
    .map((event) => event.path)
}

describe("on-device content cache", () => {
  it("a cold session downloads each body once and fills the store", async () => {
    const store = new MemoryContentStore()
    const { cms, harness } = await session(store)

    expect(await cms.entries.list("products")).toHaveLength(3)
    expect(blobRequests(harness, 0)).toHaveLength(3)
    expect(store.data.size).toBe(3)
  })

  it("a new session opens the whole collection with zero body downloads", async () => {
    const store = new MemoryContentStore()
    const first = await session(store)
    await first.cms.entries.list("products")

    const second = await session(store)
    const before = second.harness.server.log.length
    const listed = await second.cms.entries.list("products")

    expect(listed.map((entry) => entry.value.price)).toEqual([0, 1, 2])
    expect(blobRequests(second.harness, before)).toEqual([])
    expect(store.bulkReads).toBe(2)
  })

  it("opening one entry on a cold session uses the device copy", async () => {
    const store = new MemoryContentStore()
    const first = await session(store)
    await first.cms.entries.list("products")

    const second = await session(store)
    const before = second.harness.server.log.length
    const entry = await second.cms.entries.get("products", "item-1")

    expect(entry.value.price).toBe(1)
    expect(blobRequests(second.harness, before)).toEqual([])
  })

  it("downloads only the moved body and prunes the old record", async () => {
    const store = new MemoryContentStore()
    const first = await session(store)
    await first.cms.entries.list("products")

    const second = await session(store, 99)
    const before = second.harness.server.log.length
    const listed = await second.cms.entries.list("products")

    expect(listed.find((entry) => entry.slug === "item-1")?.value.price).toBe(99)
    expect(blobRequests(second.harness, before)).toHaveLength(1)
    expect(store.data.size).toBe(3)
    expect(store.prunes).toBeGreaterThanOrEqual(1)
  })

  it("a save writes the new bytes to the device copy", async () => {
    const store = new MemoryContentStore()
    const first = await session(store)
    await first.cms.entries.list("products")
    const entry = await first.cms.entries.get("products", "item-1")
    const saved = await first.cms.entries.save(entry, { ...entry.value, price: 42 })
    expect(saved.status).toBe("saved")
    expect([...store.data.values()].some((text) => text.includes('"price": 42'))).toBe(true)

    const next = await session(store, 42)
    const before = next.harness.server.log.length
    await next.cms.entries.list("products")
    expect(blobRequests(next.harness, before)).toEqual([])
  })

  it("sign-out wipes the device copy, destroy leaves it", async () => {
    const store = new MemoryContentStore()
    const { cms } = await session(store)
    await cms.entries.list("products")
    cms.destroy()
    expect(store.data.size).toBe(3)

    await cms.auth.signOut()
    expect(store.data.size).toBe(0)
  })

  it("clearCache wipes both the memory and the device cache", async () => {
    const store = new MemoryContentStore()
    const { cms, harness } = await session(store)
    await cms.entries.list("products")
    await cms.clearCache()

    expect(store.data.size).toBe(0)
    const before = harness.server.log.length
    expect(await cms.entries.list("products")).toHaveLength(3)
    expect(blobRequests(harness, before)).toHaveLength(3)
    expect(store.data.size).toBe(3)
  })

  it("a blocked device store falls back to the network", async () => {
    const store = new MemoryContentStore()
    store.failReads = true
    const { cms, harness } = await session(store)

    expect(await cms.entries.list("products")).toHaveLength(3)
    expect(blobRequests(harness, 0)).toHaveLength(3)
  })
})
