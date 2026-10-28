import { describe, expect, it } from "vitest"
import { z } from "zod"
import { divider } from "../../fields/divider"
import { hidden, list, number, relation, select, slug, string, text } from "../../fields/factories"
import {
  ConfigValidationError,
  collectionDivider,
  defineCollection,
  defineConfig,
  defineFiles,
  parseAdminConfig,
  toAdminConfig,
} from "../index"

const productsSchema = z.object({
  title: string({ label: "Product name" }),
  price: number({ label: "Price", int: true, min: 0 }),
  category: select({
    label: "Category",
    options: ["Table Lamps", "Pendant Lights", "Custom"],
    defaultValue: "Table Lamps",
  }),
  description: text({ label: "Description" }),
  images: list({
    label: "Photos",
    min: 1,
    max: 3,
    summary: "{{fields.alt}}",
    fields: {
      image: string({ label: "Photo" }),
      alt: string({ label: "Alt" }),
      objectPosition: hidden({ label: "Crop focus", defaultValue: "center" }),
    },
  }),
  slug: slug({ label: "Slug" }),
})

const products = defineCollection({
  name: "products",
  label: "Products",
  labelSingular: "Product",
  folder: "src/content/products",
  identifierField: "title",
  summary: "{{title}} · € {{price}}",
  previewPath: "/product/{{slug}}",
  sortableFields: ["title", "price"],
  thumbnail: "images.0.image",
  viewGroups: [{ name: "table", label: "Table Lamps", field: "category", pattern: "Table Lamps" }],
  schema: productsSchema,
  decorations: [divider({ before: "title", label: "Basics" })],
})

const collectionsPage = defineFiles({
  name: "pages",
  label: "Pages",
  files: [
    {
      name: "home",
      label: "Home",
      file: "src/content/home.json",
      schema: z.object({
        title: string({ label: "Title" }),
        featured: relation({
          label: "Featured",
          collection: "products",
          displayFields: ["title"],
        }),
      }),
    },
  ],
})

const config = defineConfig({
  site: { name: "ING & YVE", url: "https://example.com" },
  media: { folder: "public/images", publicFolder: "/images" },
  collections: [products, collectionDivider(), collectionsPage],
})

describe("config DSL → AdminConfig", () => {
  it("projects JSON-safe descriptors with nested fields", () => {
    const admin = toAdminConfig(config)
    expect(admin.schemaVersion).toBe(1)
    expect(admin.collections).toHaveLength(3)
    expect(admin.collections[1]).toEqual({ kind: "divider" })

    const folder = admin.collections[0]
    expect(folder).toMatchObject({
      kind: "folder",
      name: "products",
      folder: "src/content/products",
      identifierField: "title",
      fields: [
        { type: "divider", label: "Basics" },
        { name: "title", type: "string", required: true, label: "Product name" },
        { name: "price", type: "number", int: true, min: 0, required: true },
        { name: "category", type: "select", defaultValue: "Table Lamps" },
        { name: "description", type: "text", required: true },
        { name: "images", type: "list", itemMode: "object", min: 1, max: 3 },
        { name: "slug", type: "slug", required: false },
      ],
    })
    if (folder === undefined || folder.kind !== "folder") throw new Error("missing folder")
    const images = folder.fields.find((field) => "name" in field && field.name === "images")
    expect(images).toMatchObject({ type: "list", itemMode: "object" })
    if (images === undefined || images.type !== "list") throw new Error("missing images")
    expect(images.fields.map((field) => ("name" in field ? field.name : field.type))).toEqual([
      "image",
      "alt",
      "objectPosition",
    ])

    const files = admin.collections[2]
    expect(files).toMatchObject({ kind: "files", name: "pages" })
    if (files === undefined || files.kind !== "files") throw new Error("missing files")
    expect(files.files[0]?.fields).toMatchObject([
      { name: "title", type: "string" },
      { name: "featured", type: "relation", collection: "products" },
    ])
  })

  it("is JSON-safe (no schemas/functions survive)", () => {
    const admin = toAdminConfig(config)
    expect(JSON.parse(JSON.stringify(admin))).toEqual(admin)
  })

  it("projects optional deploy.contexts additively (P2.8)", () => {
    const media = { folder: "public/images", publicFolder: "/images" }
    const withDeploy = defineConfig({
      media,
      collections: [products],
      deploy: { contexts: ["Cloudflare Pages", "Vercel"] },
    })
    expect(toAdminConfig(withDeploy).deploy).toEqual({
      contexts: ["Cloudflare Pages", "Vercel"],
    })
    expect(toAdminConfig(config).deploy).toBeUndefined()

    // Empty means "fallback off", not an invalid document.
    expect(
      toAdminConfig(defineConfig({ media, collections: [products], deploy: { contexts: [] } }))
        .deploy,
    ).toEqual({ contexts: [] })
  })

  it("rejects duplicate/blank status contexts and unknown deploy keys", () => {
    const media = { folder: "public/images", publicFolder: "/images" }
    expect(() =>
      defineConfig({
        media,
        collections: [products],
        deploy: { contexts: ["pages", "pages"] },
      }),
    ).toThrow(/duplicate context/)
    expect(() =>
      defineConfig({ media, collections: [products], deploy: { contexts: [" "] } }),
    ).toThrow(/blank/)

    const raw = JSON.parse(JSON.stringify(toAdminConfig(config)))
    raw.deploy = { contexts: ["pages", "pages"] }
    expect(() => parseAdminConfig(raw)).toThrow(/duplicate context/)

    const blank = JSON.parse(JSON.stringify(toAdminConfig(config)))
    blank.deploy = { contexts: [" "] }
    expect(() => parseAdminConfig(blank)).toThrow(ConfigValidationError)

    const unknown = JSON.parse(JSON.stringify(toAdminConfig(config)))
    unknown.deploy = { contexts: ["pages"], extra: true }
    expect(() => parseAdminConfig(unknown)).toThrow(ConfigValidationError)
  })

  it("strictly rejects unknown descriptor keys", () => {
    const admin = JSON.parse(JSON.stringify(toAdminConfig(config)))
    admin.collections[0].fields[1].wat = true
    expect(() => parseAdminConfig(admin)).toThrow(ConfigValidationError)
  })

  it("rejects unknown field types and missing relation targets", () => {
    const admin = JSON.parse(JSON.stringify(toAdminConfig(config)))
    admin.collections[0].fields[1].type = "richtext"
    expect(() => parseAdminConfig(admin)).toThrow(/richtext|Invalid/)

    const admin2 = JSON.parse(JSON.stringify(toAdminConfig(config)))
    admin2.collections[2].files[0].fields[1].collection = "missing"
    try {
      parseAdminConfig(admin2)
      throw new Error("expected parse failure")
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigValidationError)
      expect((error as ConfigValidationError).issues[0]?.message).toContain("unknown relation")
    }
  })

  it("rejects duplicate field/collection names and unsafe paths", () => {
    expect(() =>
      defineConfig({
        media: { folder: "../images", publicFolder: "/images" },
        collections: [],
      }),
    ).toThrow(/media/)

    expect(() =>
      defineConfig({
        media: { folder: "public/images", publicFolder: "/images" },
        collections: [products, products],
      }),
    ).toThrow(/duplicate collection/)

    expect(() =>
      defineCollection({
        name: "bad",
        label: "Bad",
        folder: "src/content/bad",
        schema: z.object({ title: string({ label: "Title" }) }),
        decorations: [divider({ before: "missing" })],
      }),
    ).toThrow(/divider before unknown/)
  })

  it("requires fields.* metadata on every key", () => {
    expect(() =>
      defineCollection({
        name: "bad",
        label: "Bad",
        folder: "src/content/bad",
        schema: z.object({ raw: z.string() }),
      }),
    ).toThrow(/metadata/)
  })
})
