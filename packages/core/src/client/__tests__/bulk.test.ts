/**
 * Bulk writes — the promise is ONE commit and all-or-nothing.
 *
 * Every assertion here is either a write count against the fake server or a
 * returned value: a stale row must leave the branch untouched, an unrelated
 * push is retried once, and a batch of list stubs never needs a per-row `get`.
 */
import { describe, expect, it } from "vitest"
import { z } from "zod"
import {
  buildSpecFromBytes,
  createHarness,
  type FakeGithubHarness,
  successfulRefUpdates,
} from "../../__tests__/support/fake-github-fetch"
import type { FetchLike } from "../../composition"
import { defineCollection, defineConfig } from "../../config"
import { number, slug, string } from "../../fields"
import { encodeBase64, encodeUtf8 } from "../../safety/encoding"
import { createCMS } from "../create-cms"
import { CMSError } from "../errors"
import type { CMSEventMap } from "../types"

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

function entryText(title: string, price: number): string {
  return `${JSON.stringify({ title, price }, null, 2)}\n`
}

async function setup(count = 4): Promise<FakeGithubHarness> {
  const files: Array<[string, Uint8Array]> = []
  for (let index = 0; index < count; index += 1) {
    files.push([
      `src/content/products/item-${index}.json`,
      new TextEncoder().encode(entryText(`Item ${index}`, index)),
    ])
  }
  return createHarness(await buildSpecFromBytes(files))
}

function since(harness: FakeGithubHarness, from: number): string[] {
  return harness.server.log.slice(from).map((event) => `${event.method} ${event.path}`)
}

/** Every request that could change the branch. */
function writesSince(harness: FakeGithubHarness, from: number): string[] {
  return since(harness, from).filter(
    (request) =>
      request.startsWith("POST /git/blobs") ||
      request.startsWith("POST /git/trees") ||
      request.startsWith("POST /git/commits") ||
      request.startsWith("PATCH /git/refs/"),
  )
}

function commitMessagesSince(harness: FakeGithubHarness, from: number): string[] {
  return harness.server.log
    .slice(from)
    .filter((event) => event.method === "POST" && event.path === "/git/commits")
    .map((event) => (event.body as { message?: string } | undefined)?.message ?? "")
}

/** A foreign push: new blob → tree on the head → commit → FF ref update. */
async function pushForeign(harness: FakeGithubHarness, path: string, text: string): Promise<void> {
  const server = harness.server
  const head = server.ref(REPOSITORY.branch)
  if (head === undefined) throw new Error("fixture has no head")

  const blob = await server.handle({
    method: "POST",
    path: "/git/blobs",
    body: { content: encodeBase64(encodeUtf8(text)), encoding: "base64" },
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

/** A foreign deletion: one tree entry with `sha: null` → commit → ref update. */
async function pushForeignDelete(harness: FakeGithubHarness, path: string): Promise<void> {
  const server = harness.server
  const head = server.ref(REPOSITORY.branch)
  if (head === undefined) throw new Error("fixture has no head")

  const commit = await server.handle({ method: "GET", path: `/git/commits/${head}` })
  const baseTree = (commit.json as { tree: { sha: string } }).tree.sha
  const tree = await server.handle({
    method: "POST",
    path: "/git/trees",
    body: { base_tree: baseTree, tree: [{ path, mode: "100644", type: "blob", sha: null }] },
  })
  const treeSha = (tree.json as { sha: string }).sha
  const next = await server.handle({
    method: "POST",
    path: "/git/commits",
    body: { message: "foreign delete (test)", tree: treeSha, parents: [head] },
  })
  const nextSha = (next.json as { sha: string }).sha
  await server.handle({
    method: "PATCH",
    path: `/git/refs/heads/${REPOSITORY.branch}`,
    body: { sha: nextSha, force: false },
  })
}

describe("entries.saveMany", () => {
  it("saves a batch of list stubs in one commit without per-row reads", async () => {
    const harness = await setup()
    const cms = createCMS({ config, repository: REPOSITORY, token: "t", fetch: harness.fetch })
    const entries = await cms.entries.list("products")

    const before = harness.server.log.length
    const result = await cms.entries.saveMany(
      entries.map((entry) => ({
        entry,
        value: { ...entry.value, price: Number(entry.value.price) + 10 },
      })),
    )

    expect(result.status).toBe("saved")
    if (result.status !== "saved") return
    expect(result.entries.map((entry) => entry.value.price)).toEqual([10, 11, 12, 13])

    const requests = since(harness, before)
    expect(requests.filter((request) => request.startsWith("GET /git/blobs/"))).toEqual([])
    expect(requests.filter((request) => request === "POST /git/commits")).toHaveLength(1)
    expect(successfulRefUpdates(harness.server)).toBe(1)
    expect(commitMessagesSince(harness, before)).toEqual(["chore(cms): save 4 file(s)"])

    const after = harness.server.log.length
    const listed = await cms.entries.list("products")
    expect(listed.map((entry) => entry.value.price)).toEqual([10, 11, 12, 13])
    expect(since(harness, after)).toEqual([])
  })

  it("writes nothing when one row is stale", async () => {
    const harness = await setup()
    const cms = createCMS({ config, repository: REPOSITORY, token: "t", fetch: harness.fetch })
    const entries = await cms.entries.list("products")
    await pushForeign(harness, "src/content/products/item-2.json", entryText("Item 2", 99))

    const before = harness.server.log.length
    const result = await cms.entries.saveMany(
      entries.map((entry) => ({ entry, value: { ...entry.value, price: 50 } })),
    )

    expect(result.status).toBe("conflict")
    if (result.status !== "conflict") return
    expect(result.conflicts).toHaveLength(1)
    expect(result.conflicts[0]?.path).toBe("src/content/products/item-2.json")
    expect(result.conflicts[0]?.current?.value.price).toBe(99)
    expect(result.conflicts[0]?.local?.price).toBe(50)
    expect(writesSince(harness, before)).toEqual([])
  })

  it("returns a stale row that somebody deleted without a current entry", async () => {
    const harness = await setup()
    const cms = createCMS({ config, repository: REPOSITORY, token: "t", fetch: harness.fetch })
    const entries = await cms.entries.list("products")
    await pushForeignDelete(harness, "src/content/products/item-3.json")

    const before = harness.server.log.length
    const result = await cms.entries.saveMany(
      entries.map((entry) => ({ entry, value: { ...entry.value, price: 50 } })),
    )

    expect(result.status).toBe("conflict")
    if (result.status !== "conflict") return
    expect(result.conflicts).toHaveLength(1)
    expect(result.conflicts[0]?.current).toBeUndefined()
    expect(result.conflicts[0]?.local?.price).toBe(50)
    expect(writesSince(harness, before)).toEqual([])
  })

  it("is a noop when no value actually changed", async () => {
    const harness = await setup()
    const cms = createCMS({ config, repository: REPOSITORY, token: "t", fetch: harness.fetch })
    const entries = await cms.entries.list("products")

    const before = harness.server.log.length
    const result = await cms.entries.saveMany(
      entries.map((entry) => ({ entry, value: entry.value })),
    )

    expect(result.status).toBe("noop")
    if (result.status !== "noop") return
    expect(result.entries).toHaveLength(4)
    expect(writesSince(harness, before)).toEqual([])
  })

  it("retries once when only unrelated paths moved during the save", async () => {
    const harness = await setup(3)
    let injected = false
    const fetch: FetchLike = async (url, init) => {
      const method = (init?.method ?? "GET").toUpperCase()
      if (!injected && method === "POST" && String(url).endsWith("/git/trees")) {
        injected = true
        await pushForeign(harness, "src/content/products/item-9.json", entryText("Item 9", 9))
      }
      return harness.fetch(url, init)
    }
    const cms = createCMS({ config, repository: REPOSITORY, token: "t", fetch })

    const entries = await cms.entries.list("products")
    const result = await cms.entries.saveMany(
      entries.map((entry) => ({
        entry,
        value: { ...entry.value, price: Number(entry.value.price) + 10 },
      })),
    )

    expect(injected).toBe(true)
    expect(result.status).toBe("saved")
    if (result.status !== "saved") return
    expect(result.entries.map((entry) => entry.value.price)).toEqual([10, 11, 12])
    expect(successfulRefUpdates(harness.server)).toBe(2) // the foreign push + the batch
    const listed = await cms.entries.list("products")
    expect(listed).toHaveLength(4)
    expect(listed.find((entry) => entry.slug === "item-9")?.value.price).toBe(9)
  })

  it("refuses an invalid row before any write and names the file", async () => {
    const harness = await setup()
    const cms = createCMS({ config, repository: REPOSITORY, token: "t", fetch: harness.fetch })
    const entries = await cms.entries.list("products")
    const first = entries[0]
    const target = entries[1]
    if (first === undefined || target === undefined) throw new Error("fixture is missing rows")

    const before = harness.server.log.length
    const error = await cms.entries
      .saveMany([
        { entry: first, value: { ...first.value, price: 10 } },
        { entry: target, value: { ...target.value, price: "not a number" } },
      ])
      .catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(CMSError)
    if (!(error instanceof CMSError)) return
    expect(error.code).toBe("VALIDATION")
    expect(error.message).toContain(target.path)
    expect(error.issues?.length).toBeGreaterThan(0)
    expect(writesSince(harness, before)).toEqual([])
  })

  it("refuses a batch that names the same file twice", async () => {
    const harness = await setup(2)
    const cms = createCMS({ config, repository: REPOSITORY, token: "t", fetch: harness.fetch })
    const entries = await cms.entries.list("products")
    const entry = entries[0]
    if (entry === undefined) throw new Error("fixture is empty")

    const error = await cms.entries
      .saveMany([
        { entry, value: entry.value },
        { entry, value: entry.value },
      ])
      .catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(CMSError)
    if (!(error instanceof CMSError)) return
    expect(error.code).toBe("VALIDATION")
    expect(error.message).toContain(entry.path)
  })
})

describe("entries.createMany", () => {
  it("creates every entry in one commit", async () => {
    const harness = await setup(1)
    const cms = createCMS({ config, repository: REPOSITORY, token: "t", fetch: harness.fetch })

    const before = harness.server.log.length
    const result = await cms.entries.createMany([
      { collection: "products", value: { title: "New A", price: 10 } },
      { collection: "products", value: { title: "New B", price: 11 }, slug: "custom-b" },
    ])

    expect(result.status).toBe("saved")
    if (result.status !== "saved") return
    expect(result.entries.map((entry) => entry.slug)).toEqual(["new-a", "custom-b"])
    expect(result.entries.map((entry) => entry.value.price)).toEqual([10, 11])
    expect(commitMessagesSince(harness, before)).toEqual(["chore(cms): save 2 file(s)"])
    expect(successfulRefUpdates(harness.server)).toBe(1)

    const listed = await cms.entries.list("products")
    expect(listed.map((entry) => entry.slug)).toEqual(["item-0", "new-a", "custom-b"])
  })

  it("returns a taken slug as a conflict and writes nothing", async () => {
    const harness = await setup(2)
    const cms = createCMS({ config, repository: REPOSITORY, token: "t", fetch: harness.fetch })

    const before = harness.server.log.length
    const result = await cms.entries.createMany([
      { collection: "products", value: { title: "Fresh", price: 10 } },
      { collection: "products", value: { title: "Taken", price: 11 }, slug: "item-1" },
    ])

    expect(result.status).toBe("conflict")
    if (result.status !== "conflict") return
    expect(result.conflicts).toHaveLength(1)
    expect(result.conflicts[0]?.path).toBe("src/content/products/item-1.json")
    expect(result.conflicts[0]?.current?.value.price).toBe(1)
    expect(result.conflicts[0]?.local?.title).toBe("Taken")
    expect(writesSince(harness, before)).toEqual([])
  })

  it("refuses two rows that resolve to the same slug", async () => {
    const harness = await setup(1)
    const cms = createCMS({ config, repository: REPOSITORY, token: "t", fetch: harness.fetch })

    const error = await cms.entries
      .createMany([
        { collection: "products", value: { title: "Same", price: 1 } },
        { collection: "products", value: { title: "Same", price: 2 } },
      ])
      .catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(CMSError)
    if (!(error instanceof CMSError)) return
    expect(error.code).toBe("VALIDATION")
  })

  it("refuses an invalid row before any write", async () => {
    const harness = await setup(1)
    const cms = createCMS({ config, repository: REPOSITORY, token: "t", fetch: harness.fetch })

    const before = harness.server.log.length
    const error = await cms.entries
      .createMany([
        { collection: "products", value: { title: "Good", price: 1 } },
        { collection: "products", value: { title: "Broken" } },
      ])
      .catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(CMSError)
    if (!(error instanceof CMSError)) return
    expect(error.code).toBe("VALIDATION")
    expect(writesSince(harness, before)).toEqual([])
  })
})

describe("entries.deleteMany", () => {
  it("deletes a batch of list stubs in one commit", async () => {
    const harness = await setup(4)
    const cms = createCMS({ config, repository: REPOSITORY, token: "t", fetch: harness.fetch })
    const entries = await cms.entries.list("products")
    const targets = entries.slice(0, 2)

    const before = harness.server.log.length
    const result = await cms.entries.deleteMany(targets)

    expect(result.status).toBe("deleted")
    expect(commitMessagesSince(harness, before)).toEqual(["chore(cms): save 2 file(s)"])
    expect(successfulRefUpdates(harness.server)).toBe(1)
    const listed = await cms.entries.list("products")
    expect(listed.map((entry) => entry.slug)).toEqual(["item-2", "item-3"])
  })

  it("writes nothing when one row changed on the branch", async () => {
    const harness = await setup(4)
    const cms = createCMS({ config, repository: REPOSITORY, token: "t", fetch: harness.fetch })
    const entries = await cms.entries.list("products")
    await pushForeign(harness, "src/content/products/item-1.json", entryText("Item 1", 99))

    const before = harness.server.log.length
    const result = await cms.entries.deleteMany(entries)

    expect(result.status).toBe("conflict")
    if (result.status !== "conflict") return
    expect(result.conflicts).toHaveLength(1)
    expect(result.conflicts[0]?.path).toBe("src/content/products/item-1.json")
    expect(result.conflicts[0]?.current?.value.price).toBe(99)
    expect(writesSince(harness, before)).toEqual([])
  })

  it("skips a row somebody already deleted", async () => {
    const harness = await setup(3)
    const cms = createCMS({ config, repository: REPOSITORY, token: "t", fetch: harness.fetch })
    const entries = await cms.entries.list("products")
    await pushForeignDelete(harness, "src/content/products/item-0.json")

    const result = await cms.entries.deleteMany(entries)
    expect(result.status).toBe("deleted")
    expect(await cms.entries.list("products")).toEqual([])
  })

  it("is a noop when the files are already gone", async () => {
    const harness = await setup(1)
    const cms = createCMS({ config, repository: REPOSITORY, token: "t", fetch: harness.fetch })
    const entries = await cms.entries.list("products")
    await cms.entries.deleteMany(entries)

    const before = harness.server.log.length
    const result = await cms.entries.deleteMany(entries)
    expect(result.status).toBe("noop")
    expect(writesSince(harness, before)).toEqual([])
  })
})

describe("bulk events", () => {
  it("emits one event per call with the batch outcome", async () => {
    const harness = await setup(2)
    const cms = createCMS({ config, repository: REPOSITORY, token: "t", fetch: harness.fetch })
    const seen: CMSEventMap["entries:bulk"][] = []
    const off = cms.events.on("entries:bulk", (payload) => seen.push(payload))
    const entries = await cms.entries.list("products")

    const result = await cms.entries.saveMany(
      entries.map((entry) => ({ entry, value: { ...entry.value, price: 7 } })),
    )
    off()

    expect(result.status).toBe("saved")
    expect(seen).toHaveLength(1)
    expect(seen[0]?.operation).toBe("save")
    expect(seen[0]?.status).toBe("saved")
    expect(seen[0]?.paths).toEqual(entries.map((entry) => entry.path))
    expect(seen[0]?.commitSha).toBe(result.status === "saved" ? result.commitSha : undefined)

    // Unsubscribed: a second batch adds nothing.
    await cms.entries.saveMany(
      entries.map((entry) => ({ entry, value: { ...entry.value, price: 8 } })),
    )
    expect(seen).toHaveLength(1)
  })
})
