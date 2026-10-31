/**
 * Test suite for the findReferences referential integrity engine (P4.2).
 *
 * Verifies cross-collection reference detection against real yve content shapes:
 *  - single-file relation reference (`home.studyProduct` -> `the-rock-no-1`)
 *  - multi-relation reference list (`collections.featuredProducts` -> `["the-rock-no-1", "karst-no-2"]`)
 *  - shared media paths (e.g. `/images/site/ing-yve-collections.jpg` in `craft.json` and `bespoke.json`)
 *  - companion alt text extraction from gallery items
 */

import { describe, expect, it } from "vitest"
import type { AdminConfig } from "../../config/types"
import type { SearchableEntry } from "../index"
import { findReferences } from "../index"

const MOCK_CONFIG: AdminConfig = {
  schemaVersion: 1,
  media: { folder: "public/images", publicFolder: "/images" },
  collections: [
    {
      name: "products",
      label: "Products",
      kind: "folder",
      folder: "src/content/products",
      format: "json",
      media: { folder: "public/images/products", publicFolder: "/images/products" },
      fields: [],
    },
    {
      name: "collections",
      label: "Collections",
      kind: "folder",
      folder: "src/content/collections",
      format: "json",
      fields: [],
    },
    {
      name: "settings",
      label: "Settings",
      kind: "files",
      files: [{ name: "home", label: "Home", file: "src/content/home.json", fields: [] }],
    },
  ],
}

const FIXTURE_ENTRIES: readonly SearchableEntry[] = [
  {
    collection: "settings",
    slug: "home",
    title: "Home Page",
    value: {
      title: "Light, shaped by hand",
      image: "/images/site/ing-yve-hero.jpg",
      imageAlt: "Hero banner of the gallery",
      studyProduct: "the-rock-no-1",
    },
  },
  {
    collection: "collections",
    slug: "light-natural",
    title: "Light Natural Collection",
    value: {
      title: "Light Natural",
      image: "/images/collections/light-natural.jpg",
      featuredProducts: ["the-rock-no-1", "karst-no-2"],
    },
  },
  {
    collection: "collections",
    slug: "ode-to-iris",
    title: "Ode to Iris Collection",
    value: {
      title: "Ode to Iris",
      image: "/images/collections/ode-to-iris.jpg",
      featuredProducts: ["the-rock-pendant", "iris-no-7"],
    },
  },
  {
    collection: "pages",
    slug: "craft",
    title: "Craft",
    value: {
      title: "Craft & Material",
      image: "/images/site/ing-yve-craft.jpg",
      ceramicImage: "/images/site/ing-yve-collections.jpg",
    },
  },
  {
    collection: "pages",
    slug: "bespoke",
    title: "Bespoke",
    value: {
      title: "Bespoke Commissions",
      image: "/images/site/ing-yve-collections.jpg",
    },
  },
  {
    collection: "products",
    slug: "the-rock-pendant",
    title: "The Rock Pendant",
    value: {
      title: "The Rock Pendant",
      gallery: [
        {
          image: "/images/products/the-rock-pendant-1.jpg",
          alt: "The Rock Pendant lamp illuminated in studio",
        },
        {
          image: "/images/products/the-rock-pendant-2.jpg",
          alt: "Close-up detail of alabaster stone",
        },
      ],
    },
  },
]

describe("findReferences engine (P4.2, ADR-0007 §5)", () => {
  it("finds single-file relation references (home.studyProduct)", () => {
    const refs = findReferences(
      { targetRelation: { collection: "products", slug: "the-rock-no-1" } },
      FIXTURE_ENTRIES,
      MOCK_CONFIG,
    )

    const homeRef = refs.find((r) => r.slug === "home")
    expect(homeRef).toBeDefined()
    expect(homeRef?.collection).toBe("settings")
    expect(homeRef?.fieldPath).toBe("studyProduct")
  })

  it("finds multi-relation list references (collections.featuredProducts)", () => {
    const refsTheRock = findReferences(
      { targetRelation: { collection: "products", slug: "the-rock-no-1" } },
      FIXTURE_ENTRIES,
      MOCK_CONFIG,
    )

    const lightNaturalRef = refsTheRock.find((r) => r.slug === "light-natural")
    expect(lightNaturalRef).toBeDefined()
    expect(lightNaturalRef?.fieldPath).toBe("featuredProducts.0")

    const refsKarst = findReferences(
      { targetRelation: { collection: "products", slug: "karst-no-2" } },
      FIXTURE_ENTRIES,
      MOCK_CONFIG,
    )
    expect(refsKarst).toHaveLength(1)
    expect(refsKarst[0]?.slug).toBe("light-natural")
    expect(refsKarst[0]?.fieldPath).toBe("featuredProducts.1")
  })

  it("finds shared media paths across multiple documents (craft.json and bespoke.json)", () => {
    const refs = findReferences(
      { targetPath: "/images/site/ing-yve-collections.jpg" },
      FIXTURE_ENTRIES,
      MOCK_CONFIG,
    )

    expect(refs).toHaveLength(2)

    const craftMatch = refs.find((r) => r.slug === "craft")
    expect(craftMatch).toBeDefined()
    expect(craftMatch?.fieldPath).toBe("ceramicImage")

    const bespokeMatch = refs.find((r) => r.slug === "bespoke")
    expect(bespokeMatch).toBeDefined()
    expect(bespokeMatch?.fieldPath).toBe("image")
  })

  it("matches when queried by repo-relative path", () => {
    const refs = findReferences(
      { targetPath: "public/images/site/ing-yve-collections.jpg" },
      FIXTURE_ENTRIES,
      MOCK_CONFIG,
    )

    expect(refs).toHaveLength(2)
  })

  it("extracts companion alt text from nested gallery objects", () => {
    const refs = findReferences(
      { targetPath: "/images/products/the-rock-pendant-1.jpg" },
      FIXTURE_ENTRIES,
      MOCK_CONFIG,
    )

    expect(refs).toHaveLength(1)
    expect(refs[0]?.collection).toBe("products")
    expect(refs[0]?.slug).toBe("the-rock-pendant")
    expect(refs[0]?.fieldPath).toBe("gallery.0.image")
    expect(refs[0]?.altText).toBe("The Rock Pendant lamp illuminated in studio")
  })

  it("extracts top-level companion imageAlt when present", () => {
    const refs = findReferences(
      { targetPath: "/images/site/ing-yve-hero.jpg" },
      FIXTURE_ENTRIES,
      MOCK_CONFIG,
    )

    expect(refs).toHaveLength(1)
    expect(refs[0]?.slug).toBe("home")
    expect(refs[0]?.altText).toBe("Hero banner of the gallery")
  })

  it("returns empty array when target is unreferenced", () => {
    const refs = findReferences(
      { targetPath: "/images/products/orphan-image.jpg" },
      FIXTURE_ENTRIES,
      MOCK_CONFIG,
    )
    expect(refs).toEqual([])
  })
})
