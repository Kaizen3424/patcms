/**
 * Read-path economics — the claims the cache is allowed to make.
 *
 * Every assertion here is a REQUEST COUNT against the fake server: a repeat
 * listing must not re-download bodies, an open right after a listing must not
 * touch the network at all, refresh re-checks the ref only, and bursts stay
 * inside the documented read-concurrency cap.
 */
import { describe, expect, it } from "vitest"
import { z } from "zod"
import {
  buildSpecFromBytes,
  createHarness,
  type FakeGithubHarness,
} from "../../__tests__/support/fake-github-fetch"
import type { FetchLike } from "../../composition"
import { defineCollection, defineConfig } from "../../config"
import { number, slug, string } from "../../fields"
import { encodeBase64, encodeUtf8 } from "../../safety/encoding"
import { ClientCache } from "../cache"
import { createCMS } from "../create-cms"

const productsSchema = z.object({
  title: string({ label: "Title" }),
  price: number({ label: "Price" }),
  slug: slug({ label: "Slug" }),
})

const config = defineConfig({
  media: { folder: "public/images", publicFolder: "/images" },
  collections: [
    defineCollection({
      name: "products",
      label: "Products",
      folder: "src/content/products",
      identifierField: "title",
      schema: productsSchema,
    }),
  ],
})

const REPOSITORY = {
  owner: "fixture-owner",
  repo: "fixture-repo",
  branch: "fixture-branch",
  baseUrl: "https://unit.test",
} as const

function entryText(slug: string, price: number): string {
  return `${JSON.stringify({ title: slug, price }, null, 2)}\n`
}

async function setup(count = 3): Promise<FakeGithubHarness> {
  const files: Array<[string, Uint8Array]> = []
  for (let index = 0; index < count; index += 1) {
    files.push([
      `src/content/products/item-${index}.json`,
      new TextEncoder().encode(entryText(`Item ${index}`, index)),
    ])
  }
  const spec = await buildSpecFromBytes(files)
  return createHarness(spec)
}

function since(harness: FakeGithubHarness, from: number): string[] {
  return harness.server.log.slice(from).map((event) => `${event.method} ${event.path}`)
}

/** A foreign push: new blob → tree on the head → commit → FF ref update. */
async function pushForeign(harness: FakeGithubHarness, path: string, text: string): Promise<void> {
  const server = harness.server
  const head = server.ref(REPOSITORY.branch)
  if (head === undefined) throw new Error("fixture has no head")

  const blob = await server.handle({
    method: "POST",
    path: "/git/blobs",
    body: {
      content: encodeBase64(encodeUtf8(text)),
      encoding: "base64",
    },
  })
  const blobSha = (blob.json as { sha: string }).sha
  const commit = await server.handle({ method: "GET", path: `/git/commits/${head}` })
  const baseTree = (commit.json as { tree: { sha: string } }).tree.sha
  const tree = await server.handle({
    method: "POST",
    path: "/git/trees",
    body: {
      base_tree: baseTree,
      tree: [{ path, mode: "100644", type: "blob", sha: blobSha }],
    },
  })
  const treeSha = (tree.json as { sha: string }).sha
  const next = await server.handle({
    method: "POST",
    path: "/git/commits",
    body: { message: "foreign (test)", tree: treeSha, parents: [head] },
  })
  const nextSha = (next.json as { sha: string }).sha
  await server.handle({
    method: "PATCH",
    path: `/git/refs/heads/${REPOSITORY.branch}`,
    body: { sha: nextSha, force: false },
  })
}

describe("read reuse window", () => {
  it("serves a repeat listing with zero requests", async () => {
    const harness = await setup()
    const cms = createCMS({ config, repository: REPOSITORY, token: "t", fetch: harness.fetch })

    const first = await cms.entries.list("products")
    expect(first).toHaveLength(3)
    const before = harness.server.log.length

    const second = await cms.entries.list("products")
    expect(second.map((entry) => entry.title)).toEqual(first.map((entry) => entry.title))
    expect(since(harness, before)).toEqual([])
  })

  it("opens an entry listed a moment ago without a network call", async () => {
    const harness = await setup()
    const cms = createCMS({ config, repository: REPOSITORY, token: "t", fetch: harness.fetch })

    await cms.entries.list("products")
    const before = harness.server.log.length
    const entry = await cms.entries.get("products", "item-1")

    expect(entry.value.price).toBe(1)
    expect(since(harness, before)).toEqual([])
  })

  it("refresh re-checks the ref and keeps every cached body", async () => {
    const harness = await setup()
    const cms = createCMS({ config, repository: REPOSITORY, token: "t", fetch: harness.fetch })

    await cms.entries.list("products")
    const before = harness.server.log.length
    await cms.refresh()
    expect(since(harness, before)).toEqual([`GET /git/ref/heads/${REPOSITORY.branch}`])

    const afterRefresh = harness.server.log.length
    await cms.entries.list("products")
    expect(since(harness, afterRefresh)).toEqual([])
  })

  it("downloads only the entry whose bytes moved", async () => {
    const harness = await setup()
    const cms = createCMS({ config, repository: REPOSITORY, token: "t", fetch: harness.fetch })

    await cms.entries.list("products")
    await pushForeign(harness, "src/content/products/item-1.json", entryText("Item 1", 99))
    await cms.refresh()

    const before = harness.server.log.length
    const entries = await cms.entries.list("products")
    const requests = since(harness, before)

    expect(entries.find((entry) => entry.slug === "item-1")?.value.price).toBe(99)
    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatch(/^GET \/git\/blobs\//)
  })

  it("readReuseMs: 0 re-checks the head but still reuses blobs", async () => {
    const harness = await setup()
    const cms = createCMS({
      config,
      repository: REPOSITORY,
      token: "t",
      fetch: harness.fetch,
      readReuseMs: 0,
    })

    await cms.entries.list("products")
    const before = harness.server.log.length
    await cms.entries.list("products")
    const requests = since(harness, before)

    expect(requests).toContain(`GET /git/ref/heads/${REPOSITORY.branch}`)
    expect(requests.filter((request) => request.startsWith("GET /git/blobs/"))).toEqual([])
  })

  it("limits parallel body reads to the documented cap", async () => {
    const harness = await setup(12)
    let inFlight = 0
    let peak = 0
    const tracked: FetchLike = async (url, init) => {
      const isBlobRead =
        (init?.method ?? "GET").toUpperCase() === "GET" && /\/git\/blobs\//.test(url)
      if (!isBlobRead) return harness.fetch(url, init)
      inFlight += 1
      peak = Math.max(peak, inFlight)
      try {
        return await harness.fetch(url, init)
      } finally {
        inFlight -= 1
      }
    }
    const cms = createCMS({ config, repository: REPOSITORY, token: "t", fetch: tracked })

    await cms.entries.list("products")
    expect(peak).toBeGreaterThan(1)
    expect(peak).toBeLessThanOrEqual(5)
  })

  it("shows your own save to the next read without re-downloading anything", async () => {
    const harness = await setup()
    const cms = createCMS({ config, repository: REPOSITORY, token: "t", fetch: harness.fetch })

    await cms.entries.list("products")
    const entry = await cms.entries.get("products", "item-1")
    const result = await cms.entries.save(entry, { ...entry.value, price: 42 })
    expect(result.status).toBe("saved")

    const before = harness.server.log.length
    const listed = await cms.entries.list("products")
    expect(listed.find((item) => item.slug === "item-1")?.value.price).toBe(42)
    expect(since(harness, before)).toEqual([])
  })

  it("never overwrites a foreign edit made inside the reuse window", async () => {
    const harness = await setup()
    const cms = createCMS({ config, repository: REPOSITORY, token: "t", fetch: harness.fetch })

    const entry = await cms.entries.get("products", "item-1")
    await pushForeign(harness, "src/content/products/item-1.json", entryText("Item 1", 99))

    const before = harness.server.log.length
    const result = await cms.entries.save(entry, { ...entry.value, price: 5 })
    expect(result.status).toBe("conflict")
    expect(since(harness, before).some((request) => request.startsWith("PATCH"))).toBe(false)
    if (result.status !== "conflict") return
    expect(result.current.value.price).toBe(99)
  })
})

describe("ClientCache", () => {
  it("evicts blobs in insertion order once the entry cap is reached", () => {
    const cache = new ClientCache({ maxBlobEntries: 2 })
    cache.putBlob("a", new Uint8Array([1]))
    cache.putBlob("b", new Uint8Array([2]))
    cache.putBlob("c", new Uint8Array([3]))

    expect(cache.getBlob("a")).toBeUndefined()
    expect(cache.getBlob("b")).toEqual(new Uint8Array([2]))
    expect(cache.getBlob("c")).toEqual(new Uint8Array([3]))
  })

  it("refuses a single blob larger than the byte budget", () => {
    const cache = new ClientCache({ maxBlobBytes: 4 })
    cache.putBlob("big", new Uint8Array(5))
    cache.putBlob("small", new Uint8Array(4))

    expect(cache.getBlob("big")).toBeUndefined()
    expect(cache.getBlob("small")).toEqual(new Uint8Array(4))
  })
})
