/**
 * History and restore — history is read, never rewritten.
 *
 * A restore must land the historical file byte-for-byte as a NEW commit, must
 * refuse a version that no longer validates, and must never clobber a file
 * that changed after the host loaded it.
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
import { encodeBase64, encodeUtf8 } from "../../safety/encoding"
import { createCMS } from "../create-cms"
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

async function setup(count = 2): Promise<FakeGithubHarness> {
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

function writesSince(harness: FakeGithubHarness, from: number): string[] {
  return since(harness, from).filter(
    (request) =>
      request.startsWith("POST /git/blobs") ||
      request.startsWith("POST /git/trees") ||
      request.startsWith("POST /git/commits") ||
      request.startsWith("PATCH /git/refs/"),
  )
}

/** A foreign push: new blob → tree on the head → commit → FF ref update. */
async function pushForeign(
  harness: FakeGithubHarness,
  path: string,
  text: string,
): Promise<string> {
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
  return nextSha
}

/** Two saves on item-0 ⇒ head, v2, v1, seed (newest first). */
async function versioned(
  harness: FakeGithubHarness,
): Promise<{ cms: ReturnType<typeof createCMS>; path: string }> {
  const cms = createCMS({ config, repository: REPOSITORY, token: "t", fetch: harness.fetch })
  const path = "src/content/products/item-0.json"
  let entry = await cms.entries.get("products", "item-0")
  const first = await cms.entries.save(entry, { ...entry.value, price: 11 })
  if (first.status === "conflict") throw new Error("unexpected conflict")
  entry = first.entry
  const second = await cms.entries.save(entry, { ...entry.value, price: 12 })
  if (second.status === "conflict") throw new Error("unexpected conflict")
  return { cms, path }
}

describe("entries.history", () => {
  it("lists only commits that touched the entry, newest first, in one request", async () => {
    const harness = await setup()
    const { cms } = await versioned(harness)
    const entry = await cms.entries.get("products", "item-0")

    const before = harness.server.log.length
    const revisions = await cms.entries.history(entry)
    const requests = since(harness, before)

    expect(revisions).toHaveLength(3)
    expect(revisions.map((revision) => revision.message)).toEqual([
      "chore(cms): save 1 file(s)",
      "chore(cms): save 1 file(s)",
      "seed",
    ])
    expect(requests).toHaveLength(1)
    expect(requests[0]).toBe("GET /commits")
    expect(revisions[0]?.commitSha).toBe(harness.server.ref(REPOSITORY.branch))
    expect(revisions[1]?.authoredAt).toBeDefined()
    expect(revisions[1]?.authorName).toBe("fixture-author")
  })

  it("pages with a cursor without repeating the cursor row", async () => {
    const harness = await setup()
    const { cms } = await versioned(harness)
    const entry = await cms.entries.get("products", "item-0")

    const first = await cms.entries.history(entry, { limit: 2 })
    expect(first).toHaveLength(2)
    const cursor = first[1]?.commitSha
    expect(cursor).toBeDefined()

    const second = await cms.entries.history(entry, { limit: 2, before: cursor })
    expect(second).toHaveLength(1)
    expect(second.map((revision) => revision.commitSha)).not.toContain(cursor)
    expect(second[0]?.message).toBe("seed")
  })

  it("works from a listPaths stub and after the entry is gone", async () => {
    const harness = await setup()
    const { cms } = await versioned(harness)
    const stub = (await cms.entries.listPaths("products")).find(
      (candidate) => candidate.slug === "item-0",
    )
    if (stub === undefined) throw new Error("stub missing")

    const entry = await cms.entries.get("products", "item-0")
    const removed = await cms.entries.delete(entry)
    expect(removed.status).toBe("deleted")

    const revisions = await cms.entries.history(stub)
    expect(revisions).toHaveLength(4)
    expect(revisions[0]?.message).toBe("chore(cms): save 1 file(s)")
  })
})

describe("entries.atRevision", () => {
  it("reads the historical value without writing anything", async () => {
    const harness = await setup()
    const { cms, path } = await versioned(harness)
    const entry = await cms.entries.get("products", "item-0")
    const revisions = await cms.entries.history(entry)
    const previous = revisions[1]
    if (previous === undefined) throw new Error("history is too short")

    const before = harness.server.log.length
    const headBefore = harness.server.ref(REPOSITORY.branch)
    const old = await cms.entries.atRevision(entry, previous.commitSha)

    expect(old.value.price).toBe(11)
    expect(old.path).toBe(path)
    expect(writesSince(harness, before)).toEqual([])
    // A historical read must not move head nor the live entry.
    expect(harness.server.ref(REPOSITORY.branch)).toBe(headBefore)
    expect((await cms.entries.get("products", "item-0")).value.price).toBe(12)
  })

  it("reports a path that did not exist at that revision", async () => {
    const harness = await setup()
    const cms = createCMS({ config, repository: REPOSITORY, token: "t", fetch: harness.fetch })
    const entry = await cms.entries.get("products", "item-0")

    const revisions = await cms.entries.history(entry)
    const oldest = revisions[revisions.length - 1]
    if (oldest === undefined) throw new Error("history is empty")

    await expect(
      cms.entries.atRevision(
        { ...entry, path: "src/content/products/item-9.json" },
        oldest.commitSha,
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" })
  })
})

describe("entries.restore", () => {
  it("writes the historical bytes as a NEW commit (never rewrites history)", async () => {
    const harness = await setup()
    const { cms } = await versioned(harness)
    const entry = await cms.entries.get("products", "item-0")
    const revisions = await cms.entries.history(entry)
    const previous = revisions[1]
    if (previous === undefined) throw new Error("history is too short")
    const old = await cms.entries.atRevision(entry, previous.commitSha)
    const headBefore = harness.server.ref(REPOSITORY.branch)

    const before = harness.server.log.length
    const result = await cms.entries.restore(entry, previous.commitSha)

    expect(result.status).toBe("restored")
    if (result.status !== "restored") return
    expect(result.entry.value.price).toBe(11)
    expect(result.entry.raw).toBe(old.raw)
    expect(result.commitSha).not.toBe(previous.commitSha)
    expect(harness.server.ref(REPOSITORY.branch)).toBe(result.commitSha)
    expect(harness.server.ref(REPOSITORY.branch)).not.toBe(headBefore)
    const writes = writesSince(harness, before)
    expect(writes.filter((request) => request === "POST /git/commits")).toHaveLength(1)
    expect(writes.filter((request) => request.startsWith("PATCH /git/refs/"))).toHaveLength(1)
    expect((await cms.entries.get("products", "item-0")).raw).toBe(old.raw)
  })

  it("is a noop when the file already has those exact bytes", async () => {
    const harness = await setup()
    const { cms } = await versioned(harness)
    const entry = await cms.entries.get("products", "item-0")
    const revisions = await cms.entries.history(entry)
    const current = revisions[0]
    if (current === undefined) throw new Error("history is empty")

    const before = harness.server.log.length
    const result = await cms.entries.restore(entry, current.commitSha)

    expect(result.status).toBe("noop")
    expect(writesSince(harness, before)).toEqual([])
  })

  it("returns a conflict when the file changed after the entry was loaded", async () => {
    const harness = await setup()
    const { cms } = await versioned(harness)
    const entry = await cms.entries.get("products", "item-0")
    const revisions = await cms.entries.history(entry)
    const previous = revisions[1]
    if (previous === undefined) throw new Error("history is too short")

    await pushForeign(harness, "src/content/products/item-0.json", entryText("Item 0", 99))
    const before = harness.server.log.length
    const result = await cms.entries.restore(entry, previous.commitSha)

    expect(result.status).toBe("conflict")
    if (result.status !== "conflict") return
    expect(result.current.value.price).toBe(99)
    expect(writesSince(harness, before)).toEqual([])
  })

  it("re-creates a deleted entry from a listPaths stub (an add)", async () => {
    const harness = await setup()
    const { cms } = await versioned(harness)
    const entry = await cms.entries.get("products", "item-0")
    const stub = (await cms.entries.listPaths("products")).find(
      (candidate) => candidate.slug === "item-0",
    )
    if (stub === undefined) throw new Error("stub missing")
    const revisions = await cms.entries.history(stub)
    const version = revisions[1]
    if (version === undefined) throw new Error("history is too short")

    const removed = await cms.entries.delete(entry)
    expect(removed.status).toBe("deleted")

    const before = harness.server.log.length
    const result = await cms.entries.restore(stub, version.commitSha)
    expect(result.status).toBe("restored")
    if (result.status !== "restored") return
    const restored = await cms.entries.get("products", "item-0")
    expect(restored.value.price).toBe(11)
    // An add never sends a base sha; the file is gone, so the ref update creates it.
    expect(since(harness, before)).toContain("POST /git/blobs")
  })

  it("refuses a historical version that no longer validates, writing nothing", async () => {
    const harness = await setup()
    const cms = createCMS({ config, repository: REPOSITORY, token: "t", fetch: harness.fetch })
    const broken = await pushForeign(
      harness,
      "src/content/products/item-0.json",
      `${JSON.stringify({ title: "Item 0", price: "not-a-number" }, null, 2)}\n`,
    )
    // Move the file back to a valid state; the broken commit is now history.
    await pushForeign(harness, "src/content/products/item-0.json", entryText("Item 0", 5))
    const current = await cms.entries.get("products", "item-0")

    const before = harness.server.log.length
    await expect(cms.entries.restore(current, broken)).rejects.toMatchObject({
      code: "VALIDATION",
    })
    expect(writesSince(harness, before)).toEqual([])
  })

  it("emits entries:restore once with the new commit", async () => {
    const harness = await setup()
    const { cms } = await versioned(harness)
    const entry = await cms.entries.get("products", "item-0")
    const revisions = await cms.entries.history(entry)
    const previous = revisions[1]
    if (previous === undefined) throw new Error("history is too short")

    const events: Array<CMSEventMap["entries:restore"]> = []
    cms.events.on("entries:restore", (payload) => events.push(payload))
    const result = await cms.entries.restore(entry, previous.commitSha)
    expect(result.status).toBe("restored")
    if (result.status !== "restored") return

    expect(events).toEqual([
      {
        path: entry.path,
        revision: previous.commitSha,
        status: "restored",
        commitSha: result.commitSha,
      },
    ])
  })
})
