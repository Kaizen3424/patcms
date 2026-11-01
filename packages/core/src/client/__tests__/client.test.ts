import { describe, expect, it } from "vitest"
import { z } from "zod"
import { buildSpecFromBytes, createHarness } from "../../__tests__/support/fake-github-fetch"
import { defineCollection, defineConfig } from "../../config"
import { image, number, slug, string } from "../../fields"
import { createCMS } from "../create-cms"
import { CMSError } from "../errors"

const productsSchema = z.object({
  title: string({ label: "Title" }),
  price: number({ label: "Price" }),
  image: image({ label: "Image", required: false }),
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

const IRIS = `{
  "title": "Iris",
  "price": 42,
  "image": "/images/hero.png",
  "legacy": { "kept": true }
}
`

async function setup() {
  const spec = await buildSpecFromBytes([
    ["src/content/products/iris.json", new TextEncoder().encode(IRIS)],
    ["public/images/hero.png", new Uint8Array([1, 2, 3, 4])],
  ])
  const harness = createHarness(spec)
  const cms = createCMS({
    config,
    repository: REPOSITORY,
    token: "ghp_fixture_token",
    fetch: harness.fetch,
  })
  return { harness, cms }
}

describe("createCMS — entries", () => {
  it("lists paths from the tree without reading blobs", async () => {
    const { harness, cms } = await setup()
    const stubs = await cms.entries.listPaths("products")

    expect(stubs).toHaveLength(1)
    expect(stubs[0]).toMatchObject({
      collection: "products",
      slug: "iris",
      path: "src/content/products/iris.json",
      title: "iris",
    })
    expect(harness.server.log.some((event) => event.path.includes("/git/blobs/"))).toBe(false)
  })

  it("lists and reads parsed entries with the virtual slug", async () => {
    const { cms } = await setup()
    const [summary] = await cms.entries.list("products")

    expect(summary?.title).toBe("Iris")
    expect(summary?.value.price).toBe(42)
    expect(summary?.value.slug).toBe("iris")
    expect(summary?.issues.map((issue) => issue.code)).toEqual(["UNMODELED_KEY"])

    const entry = await cms.entries.get("products", "iris")
    expect(entry.raw).toBe(IRIS)
    expect(entry.untouched).toMatchObject({ "/legacy": { kept: true } })
  })

  it("saves an edit, preserves untouched keys, and never writes the virtual slug", async () => {
    const { cms } = await setup()
    const entry = await cms.entries.get("products", "iris")

    const result = await cms.entries.save(entry, { ...entry.value, price: 50 })
    expect(result.status).toBe("saved")
    if (result.status !== "saved") return

    expect(result.entry.value.price).toBe(50)
    expect(result.entry.value.slug).toBe("iris")
    expect(result.entry.raw).toContain('"legacy"')
    expect(result.entry.raw).not.toContain('"slug"')
    expect(result.commitSha).toMatch(/^[0-9a-f]{40}$/)
  })

  it("returns noop when the composed bytes did not change", async () => {
    const { cms } = await setup()
    const entry = await cms.entries.get("products", "iris")

    const result = await cms.entries.save(entry, entry.value)
    expect(result.status).toBe("noop")
  })

  it("returns a conflict value when the file moved underneath the editor", async () => {
    const { cms } = await setup()
    const stale = await cms.entries.get("products", "iris")

    const first = await cms.entries.save(stale, { ...stale.value, price: 50 })
    expect(first.status).toBe("saved")

    const second = await cms.entries.save(stale, { ...stale.value, price: 60 })
    expect(second.status).toBe("conflict")
    if (second.status !== "conflict") return
    expect(second.current.value.price).toBe(50)
    expect(second.local.price).toBe(60)
  })

  it("creates an entry from the identifier field and reports path collisions", async () => {
    const { cms } = await setup()
    const created = await cms.entries.create("products", { title: "New Thing", price: 10 })

    expect(created.status).toBe("saved")
    if (created.status !== "saved") return
    expect(created.entry.path).toBe("src/content/products/new-thing.json")
    expect(created.entry.slug).toBe("new-thing")
    expect(await cms.entries.listPaths("products")).toHaveLength(2)

    const again = await cms.entries.create("products", { title: "New Thing", price: 11 })
    expect(again.status).toBe("conflict")
  })

  it("deletes an entry and treats a repeat delete as noop", async () => {
    const { cms } = await setup()
    const entry = await cms.entries.get("products", "iris")

    const deleted = await cms.entries.delete(entry)
    expect(deleted.status).toBe("deleted")
    expect(await cms.entries.listPaths("products")).toHaveLength(0)

    const again = await cms.entries.delete(entry)
    expect(again.status).toBe("noop")
  })

  it("validates without writing", async () => {
    const { cms } = await setup()
    const entry = await cms.entries.get("products", "iris")

    const invalid = await cms.entries.validate(entry, { title: "Iris", price: "not a number" })
    expect(invalid.ok).toBe(false)
    if (!invalid.ok) expect(invalid.issues.length).toBeGreaterThan(0)

    const valid = await cms.entries.validate(entry, { title: "Iris", price: 42 })
    expect(valid.ok).toBe(true)
  })

  it("refuses to save invalid values with a typed error", async () => {
    const { cms } = await setup()
    const entry = await cms.entries.get("products", "iris")

    await expect(cms.entries.save(entry, { price: 42 })).rejects.toMatchObject({
      code: "VALIDATION",
    })
  })

  it("throws AUTH_REQUIRED before any request when no token is present", async () => {
    const spec = await buildSpecFromBytes([])
    const harness = createHarness(spec)
    const cms = createCMS({ config, repository: REPOSITORY, fetch: harness.fetch })

    await expect(cms.entries.listPaths("products")).rejects.toBeInstanceOf(CMSError)
    await expect(cms.entries.listPaths("products")).rejects.toMatchObject({
      code: "AUTH_REQUIRED",
    })
    expect(harness.server.log).toHaveLength(0)
  })
})

describe("createCMS — media and drafts", () => {
  it("lists, reads, uploads, and protects referenced media", async () => {
    const { cms } = await setup()

    const files = await cms.media.list()
    expect(files.map((file) => file.publicPath)).toEqual(["/images/hero.png"])

    const blob = await cms.media.get("/images/hero.png")
    expect([...blob.bytes]).toEqual([1, 2, 3, 4])
    expect(blob.type).toBe("image/png")

    const uploaded = await cms.media.upload({
      name: "logo.png",
      bytes: new Uint8Array([9, 9, 9]),
    })
    expect(uploaded.publicPath).toBe("/images/logo.png")

    const blocked = await cms.media.delete("/images/hero.png")
    expect(blocked.status).toBe("referenced")
    if (blocked.status === "referenced") expect(blocked.references).toHaveLength(1)

    const removed = await cms.media.delete("/images/logo.png")
    expect(removed.status).toBe("deleted")
  })

  it("refuses SVG unless explicitly allowed", async () => {
    const { cms } = await setup()
    await expect(
      cms.media.upload({ name: "icon.svg", bytes: new Uint8Array([1]) }),
    ).rejects.toMatchObject({ code: "VALIDATION" })
  })

  it("round-trips drafts in the memory store", async () => {
    const { cms } = await setup()
    const entry = await cms.entries.get("products", "iris")

    await cms.drafts.save(entry, { ...entry.value, price: 99 })
    const draft = await cms.drafts.get(entry)
    expect(draft?.value.price).toBe(99)
    expect(draft?.baseSha).toBe(entry.sha)

    expect(await cms.drafts.list("products")).toHaveLength(1)
    await cms.drafts.delete(entry)
    expect(await cms.drafts.get(entry)).toBeUndefined()
  })
})
