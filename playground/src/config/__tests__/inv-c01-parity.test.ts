/// <reference types="node" />
import type {
  DividerFieldDescriptor,
  FieldDescriptor,
  FolderCollectionDescriptor,
  ListFieldDescriptor,
  NumberFieldDescriptor,
  RelationFieldDescriptor,
  SelectFieldDescriptor,
} from "@mycms/core"
import { describe, expect, it } from "vitest"
import { yveAdminConfig } from "../yve"

function isNamedField(f: FieldDescriptor): f is Exclude<FieldDescriptor, DividerFieldDescriptor> {
  return f.type !== "divider"
}

/**
 * INV-C01 — Parity golden: frozen field-by-field diff between config-package
 * and plans/phase-7-publish.md appendix A. Drift changes break BOTH sides.
 */
describe("INV-C01 · Parity golden against the Phase 7 appendix", () => {
  const collectionsByName = new Map(
    yveAdminConfig.collections.filter((c) => c.kind !== "divider").map((c) => [c.name, c]),
  )

  it("declares all required collections and files from inventory", () => {
    expect(collectionsByName.has("products")).toBe(true)
    expect(collectionsByName.has("collections")).toBe(true)
    expect(collectionsByName.has("pages")).toBe(true)
    expect(collectionsByName.has("settings")).toBe(true)

    const pages = collectionsByName.get("pages")
    expect(pages?.kind).toBe("files")
    if (pages?.kind === "files") {
      const pageNames = pages.files.map((f) => f.name)
      expect(pageNames).toContain("home")
      expect(pageNames).toContain("collections-page")
      expect(pageNames).toContain("craft")
      expect(pageNames).toContain("about")
      expect(pageNames).toContain("bespoke")
    }

    const settings = collectionsByName.get("settings")
    expect(settings?.kind).toBe("files")
    if (settings?.kind === "files") {
      const fileNames = settings.files.map((f) => f.name)
      expect(fileNames).toContain("contact-details")
    }
  })

  it("products: has 1:1 field parity with inventory", () => {
    const products = collectionsByName.get("products") as FolderCollectionDescriptor
    expect(products).toBeDefined()
    expect(products.create).toBe(true)
    expect(products.folder).toBe("src/content/products")
    expect(products.summary).toBe("{{title}} · € {{price}}")

    const fieldMap = new Map(products.fields.filter(isNamedField).map((f) => [f.name, f]))

    // Required fields
    expect(fieldMap.get("title")?.type).toBe("string")
    expect(fieldMap.get("title")?.required).toBe(true)

    // Price
    const price = fieldMap.get("price")
    expect(price?.type).toBe("number")
    expect((price as NumberFieldDescriptor)?.int).toBe(true)
    expect((price as NumberFieldDescriptor)?.min).toBe(0)

    // Category select options
    const category = fieldMap.get("category") as SelectFieldDescriptor
    expect(category?.type).toBe("select")
    expect(category?.options.map((o) => o.value)).toEqual([
      "Table Lamps",
      "Pendant Lights",
      "Custom",
    ])

    // Images list min 1 max 3
    const images = fieldMap.get("images") as ListFieldDescriptor
    expect(images?.type).toBe("list")
    expect(images?.min).toBe(1)
    expect(images?.max).toBe(3)
    expect(images?.summary).toBe("{{fields.alt}}")

    // Options ("choice tabs") nested list-of-lists
    const options = fieldMap.get("options") as ListFieldDescriptor
    expect(options?.type).toBe("list")
    expect(options?.min).toBe(1)
    expect(options?.summary).toBe("{{fields.name}}")
    const optionFields = new Map(options.fields.filter(isNamedField).map((f) => [f.name, f]))
    expect(optionFields.get("name")?.type).toBe("string")

    const valuesList = optionFields.get("values") as ListFieldDescriptor
    expect(valuesList?.type).toBe("list")
    expect(valuesList?.min).toBe(1)
    expect(valuesList?.summary).toBe("{{fields.label}}")
    const valueItemFields = new Map(valuesList.fields.filter(isNamedField).map((f) => [f.name, f]))
    expect(valueItemFields.get("label")?.type).toBe("string")

    // Swatch within values: enum options Gold->accent, Neutral->muted, Deep blue->secondary
    const swatch = valueItemFields.get("swatch") as SelectFieldDescriptor
    expect(swatch?.type).toBe("select")
    expect(swatch?.defaultValue).toBe("accent")
    expect(swatch?.options.map((o) => o.value)).toEqual(["accent", "muted", "secondary"])

    // Specs list
    const specs = fieldMap.get("specs") as ListFieldDescriptor
    expect(specs?.type).toBe("list")
    expect(specs?.summary).toBe("{{fields.label}}: {{fields.value}}")

    // Accordions list
    const accordions = fieldMap.get("accordions") as ListFieldDescriptor
    expect(accordions?.type).toBe("list")
    expect(accordions?.summary).toBe("{{fields.title}}")

    // Hidden defaults
    expect(fieldMap.get("kicker")?.type).toBe("hidden")
    expect(fieldMap.get("materialFilter")?.type).toBe("hidden")
    expect(fieldMap.get("seo")?.type).toBe("hidden")
  })

  it("collections: has 1:1 field parity with inventory", () => {
    const collections = collectionsByName.get("collections") as FolderCollectionDescriptor
    expect(collections).toBeDefined()
    expect(collections.create).toBe(true)
    expect(collections.folder).toBe("src/content/collections")

    const fieldMap = new Map(collections.fields.filter(isNamedField).map((f) => [f.name, f]))
    expect(fieldMap.get("title")?.type).toBe("string")
    expect(fieldMap.get("number")?.type).toBe("string")
    expect(fieldMap.get("image")?.type).toBe("image")
    expect(fieldMap.get("featuredProducts")?.type).toBe("relation")
    expect((fieldMap.get("featuredProducts") as RelationFieldDescriptor)?.multiple).toBe(true)
  })

  it("craft: features list is exactly 4 items", () => {
    const pages = collectionsByName.get("pages")
    expect(pages?.kind).toBe("files")
    if (pages?.kind !== "files") return

    const craft = pages.files.find((f) => f.name === "craft")
    expect(craft).toBeDefined()
    const fieldMap = new Map(craft?.fields.filter(isNamedField).map((f) => [f.name, f]))

    const features = fieldMap.get("features") as ListFieldDescriptor
    expect(features?.type).toBe("list")
    expect(features?.min).toBe(4)
    expect(features?.max).toBe(4)
  })

  it("bespoke: diameters and finishes are lists min 1", () => {
    const pages = collectionsByName.get("pages")
    expect(pages?.kind).toBe("files")
    if (pages?.kind !== "files") return

    const bespoke = pages.files.find((f) => f.name === "bespoke")
    expect(bespoke).toBeDefined()
    const fieldMap = new Map(bespoke?.fields.filter(isNamedField).map((f) => [f.name, f]))

    const diameters = fieldMap.get("diameters") as ListFieldDescriptor
    expect(diameters?.type).toBe("list")
    expect(diameters?.min).toBe(1)

    const finishes = fieldMap.get("finishes") as ListFieldDescriptor
    expect(finishes?.type).toBe("list")
    expect(finishes?.min).toBe(1)
  })
})
