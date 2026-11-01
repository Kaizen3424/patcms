import type { AdminConfig, FolderCollectionDescriptor } from "patcms/advanced"
import { describe, expect, it } from "vitest"
import type { IndexedEntry } from "../../runtime/entry-index"
import { searchIndex, splitByMatch } from "../search-index"

const mockCollection: FolderCollectionDescriptor = {
  kind: "folder",
  name: "products",
  label: "Products",
  folder: "content/products",
  format: "json",
  fields: [
    { name: "title", type: "string", label: "Title", required: true },
    { name: "price", type: "number", label: "Price", required: true },
    { name: "description", type: "text", label: "Description", required: false },
    {
      name: "materials",
      type: "list",
      label: "Materials",
      required: false,
      itemMode: "object",
      fields: [{ name: "item", type: "string", label: "Material", required: true }],
    },
  ],
}

const mockConfig: AdminConfig = {
  schemaVersion: 1,
  media: { publicFolder: "/images", folder: "public/images" },
  collections: [mockCollection],
}

function makeMockEntry(slug: string, title: string, value: Record<string, unknown>): IndexedEntry {
  return {
    collectionName: "products",
    collection: mockCollection,
    path: `content/products/${slug}.json`,
    slug,
    title,
    fields: mockCollection.fields,
    media: mockConfig.media,
    raw: value,
    value,
    issues: [],
    untouched: {},
    rawText: JSON.stringify(value),
    blobSha: "sha123",
  }
}

describe("splitByMatch", () => {
  it("splits text cleanly into matching and non-matching parts", () => {
    const parts = splitByMatch("Solid Gold Ring with Diamond", "gold")
    expect(parts).toEqual([
      { text: "Solid ", isMatch: false },
      { text: "Gold", isMatch: true },
      { text: " Ring with Diamond", isMatch: false },
    ])
  })

  it("handles empty or non-matching query", () => {
    expect(splitByMatch("Hello World", "")).toEqual([{ text: "Hello World", isMatch: false }])
    expect(splitByMatch("Hello World", "Silver")).toEqual([{ text: "Hello World", isMatch: false }])
  })

  it("handles repeated occurrences of query", () => {
    const parts = splitByMatch("Gold and more gold", "gold")
    expect(parts).toEqual([
      { text: "Gold", isMatch: true },
      { text: " and more ", isMatch: false },
      { text: "gold", isMatch: true },
    ])
  })
})

describe("searchIndex", () => {
  const entries: IndexedEntry[] = [
    makeMockEntry("iris-no-3", "Iris No. 3 Ring", {
      title: "Iris No. 3 Ring",
      price: 1450,
      description: "Fine 18k yellow gold with solitaire cut.",
      materials: ["Yellow Gold", "Diamond"],
      photo: { image: "/images/iris-3.jpg", alt: "Top view of gold ring" },
    }),
    makeMockEntry("the-rock", "The Rock Pendant", {
      title: "The Rock Pendant",
      price: 2200,
      description: "Carved raw crystal setting in white gold.",
      materials: ["White Gold", "Quartz"],
      photo: { image: "/images/rock.jpg", alt: "Pendant on model" },
    }),
  ]

  it("returns empty array for empty or whitespace query", () => {
    expect(searchIndex("", entries, mockConfig)).toEqual([])
    expect(searchIndex("   ", entries, mockConfig)).toEqual([])
  })

  it("matches by title", () => {
    const results = searchIndex("Iris", entries, mockConfig)
    expect(results).toHaveLength(1)
    expect(results[0]?.collectionLabel).toBe("Products")
    expect(results[0]?.results).toHaveLength(1)
    expect(results[0]?.results[0]?.slug).toBe("iris-no-3")
    expect(results[0]?.results[0]?.matchedField).toBe("Title")
  })

  it("matches by whole euro price number", () => {
    const results = searchIndex("1450", entries, mockConfig)
    expect(results).toHaveLength(1)
    expect(results[0]?.results[0]?.slug).toBe("iris-no-3")
    expect(results[0]?.results[0]?.matchedField).toBe("Price")
  })

  it("matches by material in array", () => {
    const results = searchIndex("Quartz", entries, mockConfig)
    expect(results).toHaveLength(1)
    expect(results[0]?.results[0]?.slug).toBe("the-rock")
    expect(results[0]?.results[0]?.matchedField).toBe("Material")
  })

  it("matches by photo alt description", () => {
    const results = searchIndex("model", entries, mockConfig)
    expect(results).toHaveLength(1)
    expect(results[0]?.results[0]?.slug).toBe("the-rock")
    expect(results[0]?.results[0]?.matchedField).toBe("Photo description")
  })

  it("matches multiple tokens across fields (AND logic)", () => {
    const results = searchIndex("Iris 1450 Diamond", entries, mockConfig)
    expect(results).toHaveLength(1)
    expect(results[0]?.results[0]?.slug).toBe("iris-no-3")
  })

  it("returns empty results when query does not match any entry", () => {
    const results = searchIndex("Emerald Platinum", entries, mockConfig)
    expect(results).toEqual([])
  })
})
