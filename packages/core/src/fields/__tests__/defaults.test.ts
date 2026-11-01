import { describe, expect, it } from "vitest"
import { createBlankEntryValue, foldFieldDefaults } from "../defaults"
import type { FieldDescriptor, ListFieldDescriptor } from "../types"

const field = <T extends FieldDescriptor>(descriptor: T): T => descriptor

const listField = (
  descriptor: Omit<ListFieldDescriptor, "type" | "itemMode"> & {
    readonly itemMode?: "object" | "scalar"
  },
): ListFieldDescriptor => ({
  type: "list",
  itemMode: descriptor.itemMode ?? "object",
  ...descriptor,
})

describe("foldFieldDefaults", () => {
  it("skips dividers and slug fields", () => {
    const value = createBlankEntryValue([
      { type: "divider", label: "Basics" },
      { type: "slug", name: "slug", label: "Slug", required: false },
      field({ type: "string", name: "title", label: "Title", required: false }),
    ])

    expect(value).toEqual({})
  })

  it("materialises declared defaults only when the key is absent", () => {
    const value = createBlankEntryValue([
      field({
        type: "hidden",
        name: "material",
        label: "Material",
        required: false,
        defaultValue: "Ceramics",
      }),
      field({
        type: "number",
        name: "stock",
        label: "Stock",
        required: false,
        defaultValue: 0,
      }),
      field({
        type: "boolean",
        name: "featured",
        label: "Featured",
        required: false,
        defaultValue: true,
      }),
    ])

    expect(value).toEqual({ material: "Ceramics", stock: 0, featured: true })
  })

  it("never overwrites a value already present", () => {
    const target: Record<string, unknown> = { title: "Iris", material: "Glass" }
    foldFieldDefaults(
      [
        field({ type: "string", name: "title", label: "Title", required: false }),
        field({
          type: "hidden",
          name: "material",
          label: "Material",
          required: false,
          defaultValue: "Ceramics",
        }),
      ],
      target,
    )

    expect(target).toEqual({ title: "Iris", material: "Glass" })
  })

  it("leaves a required scalar without a default undefined (validation reports it)", () => {
    const value = createBlankEntryValue([
      field({ type: "string", name: "title", label: "Title", required: true }),
    ])
    expect(value.title).toBeUndefined()
  })

  it("pads a required list with structurally valid starter items", () => {
    const value = createBlankEntryValue([
      listField({
        name: "images",
        label: "Images",
        required: true,
        fields: [
          field({ type: "string", name: "alt", label: "Alt", required: false }),
          field({ type: "number", name: "width", label: "Width", required: false }),
        ],
      }),
    ])

    expect(value.images).toEqual([{ alt: "", width: 0 }])
  })

  it("leaves an optional list with min absent until the author adds items", () => {
    const value = createBlankEntryValue([
      listField({
        name: "tags",
        label: "Tags",
        required: false,
        min: 2,
        itemMode: "scalar",
        fields: [field({ type: "string", name: "tag", label: "Tag", required: false })],
      }),
    ])

    expect(value).not.toHaveProperty("tags")
  })

  it("tops an existing list up to min", () => {
    const target: Record<string, unknown> = { tags: ["a"] }
    foldFieldDefaults(
      [
        listField({
          name: "tags",
          label: "Tags",
          required: false,
          min: 2,
          itemMode: "scalar",
          fields: [field({ type: "string", name: "tag", label: "Tag", required: false })],
        }),
      ],
      target,
    )
    expect(target.tags).toEqual(["a", ""])
  })

  it("omits an optional list with no existing value", () => {
    const value = createBlankEntryValue([
      listField({
        name: "tags",
        label: "Tags",
        required: false,
        itemMode: "scalar",
        fields: [field({ type: "string", name: "tag", label: "Tag", required: false })],
      }),
    ])
    expect(value).not.toHaveProperty("tags")
  })

  it("recurses into object fields", () => {
    const value = createBlankEntryValue([
      field({
        type: "object",
        name: "seo",
        label: "SEO",
        required: false,
        fields: [
          field({
            type: "string",
            name: "title",
            label: "Title",
            required: false,
            defaultValue: "Untitled",
          }),
          field({
            type: "hidden",
            name: "robots",
            label: "Robots",
            required: false,
            defaultValue: "index",
          }),
        ],
      }),
    ])

    expect(value.seo).toEqual({ title: "Untitled", robots: "index" })
  })

  it("fills a nested default into an existing object", () => {
    const target: Record<string, unknown> = { seo: { title: "Hello" } }
    foldFieldDefaults(
      [
        field({
          type: "object",
          name: "seo",
          label: "SEO",
          required: false,
          fields: [
            field({
              type: "hidden",
              name: "robots",
              label: "Robots",
              required: false,
              defaultValue: "index",
            }),
          ],
        }),
      ],
      target,
    )

    expect(target.seo).toEqual({ title: "Hello", robots: "index" })
  })

  it("builds a scalar list item from the child default", () => {
    const value = createBlankEntryValue([
      listField({
        name: "tags",
        label: "Tags",
        required: true,
        itemMode: "scalar",
        fields: [
          field({
            type: "select",
            name: "tag",
            label: "Tag",
            required: false,
            options: [{ label: "A", value: "a" }],
            defaultValue: "a",
          }),
        ],
      }),
    ])

    expect(value.tags).toEqual(["a"])
  })

  it("nests required sub-lists and objects inside a list item template", () => {
    const value = createBlankEntryValue([
      listField({
        name: "sections",
        label: "Sections",
        required: true,
        fields: [
          field({ type: "text", name: "body", label: "Body", required: false }),
          field({ type: "boolean", name: "visible", label: "Visible", required: false }),
          listField({
            name: "links",
            label: "Links",
            required: true,
            itemMode: "scalar",
            fields: [field({ type: "string", name: "href", label: "Href", required: false })],
          }),
          field({
            type: "object",
            name: "meta",
            label: "Meta",
            required: false,
            fields: [
              field({
                type: "hidden",
                name: "key",
                label: "Key",
                required: false,
                defaultValue: "k",
              }),
            ],
          }),
        ],
      }),
    ])

    expect(value.sections).toEqual([{ body: "", visible: false, links: [""], meta: { key: "k" } }])
  })

  it("leaves an optional sub-list empty inside a list item template", () => {
    const value = createBlankEntryValue([
      listField({
        name: "sections",
        label: "Sections",
        required: true,
        fields: [
          listField({
            name: "links",
            label: "Links",
            required: false,
            itemMode: "scalar",
            fields: [field({ type: "string", name: "href", label: "Href", required: false })],
          }),
        ],
      }),
    ])

    expect(value.sections).toEqual([{ links: [] }])
  })
})
