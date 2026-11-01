import type { EntrySummary, FolderCollectionDescriptor } from "patcms"
import { describe, expect, it } from "vitest"
import { entryTitle, filterSummaries, formatBytes, sortSummaries } from "../lib/library"

const collection = {
  kind: "folder",
  name: "products",
  label: "Products",
  folder: "src/content/products",
  format: "json",
  identifierField: "title",
  summary: "{{title}} ({{material}})",
  sortableFields: ["title", "price"],
  fields: [],
} as FolderCollectionDescriptor

function summary(slug: string, value: Record<string, unknown>): EntrySummary {
  return {
    collection: "products",
    slug,
    path: `src/content/products/${slug}.json`,
    sha: "a".repeat(40),
    title: String(value.title ?? slug),
    value,
    issues: [],
  }
}

const lamp = summary("lamp", { title: "Table Lamp", material: "Oak", price: 30 })
const pendant = summary("pendant", { title: "Pendant", material: "Brass", price: 10 })
const vase = summary("vase", { title: "Vase", material: "Clay", price: 20 })
const entries = [lamp, pendant, vase]

describe("entryTitle", () => {
  it("renders the summary template", () => {
    expect(entryTitle(lamp, collection)).toBe("Table Lamp (Oak)")
  })

  it("falls back to the identifier field, then the slug", () => {
    const bare = { ...collection, summary: undefined }
    expect(entryTitle(lamp, bare)).toBe("Table Lamp")
    const noIdentifier = { ...bare, identifierField: undefined }
    expect(entryTitle(lamp, noIdentifier)).toBe("lamp")
  })
})

describe("sortSummaries", () => {
  it("sorts numerically on a declared field and respects direction", () => {
    const asc = sortSummaries(entries, "price", "asc")
    expect(asc.map((entry) => entry.value.price)).toEqual([10, 20, 30])
    const desc = sortSummaries(entries, "price", "desc")
    expect(desc.map((entry) => entry.value.price)).toEqual([30, 20, 10])
  })

  it("falls back to the slug", () => {
    expect(
      sortSummaries([...entries].reverse(), undefined, "asc").map((entry) => entry.slug),
    ).toEqual(["lamp", "pendant", "vase"])
  })
})

describe("filterSummaries", () => {
  it("matches slug or rendered title, case-insensitively", () => {
    expect(filterSummaries(entries, "PEND", collection).map((entry) => entry.slug)).toEqual([
      "pendant",
    ])
    expect(filterSummaries(entries, "brass", collection).map((entry) => entry.slug)).toEqual([
      "pendant",
    ])
    expect(filterSummaries(entries, "  ", collection)).toHaveLength(3)
  })
})

describe("formatBytes", () => {
  it("formats the sizes a media row shows", () => {
    expect(formatBytes(512)).toBe("512 B")
    expect(formatBytes(2048)).toBe("2.0 KB")
    expect(formatBytes(3 * 1024 * 1024)).toBe("3.0 MB")
  })
})
