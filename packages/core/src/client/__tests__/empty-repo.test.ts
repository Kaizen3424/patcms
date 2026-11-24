import { describe, expect, it } from "vitest"
import { z } from "zod"
import {
  buildEmptyRepoSpec,
  buildSpecFromBytes,
  createHarness,
} from "../../__tests__/support/fake-github-fetch"
import { defineCollection, defineConfig } from "../../config"
import { number, string } from "../../fields"
import { createCMS } from "../create-cms"
import { CMSError } from "../errors"

/**
 * End-to-end empty-repository behavior (ADR-0011): a freshly created repo
 * (zero commits — GitHub answers branch reads HTTP 409 "Git Repository is
 * empty") reads as "no content", the FIRST save bootstraps the root commit
 * and branch, and every later save is an ordinary fast-forward.
 */

const productsSchema = z.object({
  title: string({ label: "Title" }),
  price: number({ label: "Price" }),
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

const REPO = {
  owner: "fixture-owner",
  repo: "fixture-repo",
  branch: "fixture-branch",
  baseUrl: "https://unit.test",
} as const

function cmsOnEmpty() {
  const harness = createHarness(buildEmptyRepoSpec(REPO.branch))
  const cms = createCMS({
    config,
    repository: REPO,
    token: "ghp_fixture_token",
    fetch: harness.fetch,
  })
  return { harness, cms }
}

/** The logged mutation body of a request the test proves was logged. */
function bodyOf(event: { readonly body?: unknown } | undefined): Record<string, unknown> {
  if (event?.body === undefined) throw new Error("expected the request body to be logged")
  return event.body as Record<string, unknown>
}

describe("createCMS — reads on a zero-commit repository (ADR-0011)", () => {
  it("listPaths returns [] — exactly like a collection with no files", async () => {
    const { harness, cms } = cmsOnEmpty()
    await expect(cms.entries.listPaths("products")).resolves.toEqual([])
    // Reads never attempt a write.
    expect(
      harness.server.log.some((event) => event.method === "POST" || event.method === "PATCH"),
    ).toBe(false)
  })

  it("get behaves like a missing entry (NOT_FOUND), never UNKNOWN", async () => {
    const { cms } = cmsOnEmpty()
    const error = (await cms.entries.get("products", "iris").then(
      () => new Error("expected a rejection"),
      (caught: unknown) => caught,
    )) as unknown
    expect(error).toBeInstanceOf(CMSError)
    expect((error as CMSError).code).toBe("NOT_FOUND")
    expect((error as CMSError).code).not.toBe("UNKNOWN")
  })
})

describe("createCMS — the first save bootstraps the repository (ADR-0011)", () => {
  it("creates an entry with a root commit and a ref CREATE, then reads back", async () => {
    const { harness, cms } = cmsOnEmpty()
    const created = await cms.entries.create("products", { title: "Iris", price: 42 })
    expect(created.status).toBe("saved")
    if (created.status !== "saved") return
    expect(created.entry.path).toBe("src/content/products/iris.json")

    const refOps = harness.server.log.filter((event) => event.path.startsWith("/git/refs"))
    expect(refOps).toHaveLength(1)
    expect(refOps[0]).toMatchObject({ method: "POST", path: "/git/refs", status: 201 })

    const root = harness.server.log.find(
      (event) => event.method === "POST" && event.path === "/git/commits",
    )
    expect(bodyOf(root).parents).toBeUndefined()

    const entry = await cms.entries.get("products", "iris")
    expect(entry.value.price).toBe(42)
    const paths = await cms.entries.listPaths("products")
    expect(paths.map((stub) => stub.slug)).toEqual(["iris"])
  })

  it("the SECOND save fast-forwards with a ref PATCH, like any other save", async () => {
    const { harness, cms } = cmsOnEmpty()
    const created = await cms.entries.create("products", { title: "Iris", price: 42 })
    if (created.status !== "saved") throw new Error("bootstrap create did not save")

    const entry = await cms.entries.get("products", "iris")
    const edited = await cms.entries.save(entry, { ...entry.value, price: 50 })
    expect(edited.status).toBe("saved")
    if (edited.status !== "saved") return
    expect(edited.entry.value.price).toBe(50)

    const refOps = harness.server.log
      .filter((event) => event.path.startsWith("/git/refs"))
      .map((event) => event.method)
    expect(refOps).toEqual(["POST", "PATCH"])
    const patch = harness.server.log.find(
      (event) => event.method === "PATCH" && event.path.startsWith("/git/refs"),
    )
    expect(patch?.path).toBe(`/git/refs/heads/${REPO.branch}`)
    expect(bodyOf(patch).force).toBe(false)
  })
})

describe("createCMS — saving to a missing branch on a NON-empty repository (ADR-0011)", () => {
  it("fails with a branch-named NOT_FOUND, not a generic 422-class error", async () => {
    const spec = await buildSpecFromBytes([
      ["src/content/products/iris.json", new TextEncoder().encode('{"title":"Iris","price":1}')],
    ])
    const harness = createHarness(spec)
    const cms = createCMS({
      config,
      repository: { ...REPO, branch: "no-such-branch" },
      token: "ghp_fixture_token",
      fetch: harness.fetch,
    })

    const error = (await cms.entries.create("products", { title: "Iris", price: 42 }).then(
      () => new Error("expected a rejection"),
      (caught: unknown) => caught,
    )) as unknown
    expect(error).toBeInstanceOf(CMSError)
    expect((error as CMSError).code).toBe("NOT_FOUND")
    expect((error as CMSError).message).toContain("GitHub branch not found: no-such-branch")
    // Nothing was written to the DEFAULT branch either.
    expect(
      harness.server.log.some((event) => event.method === "POST" || event.method === "PATCH"),
    ).toBe(false)
  })
})
