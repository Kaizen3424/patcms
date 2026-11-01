import { describe, expect, it } from "vitest"
import { deriveSlug, slugify } from "../slug"

describe("virtual slug", () => {
  it("derives the slug from the filename only", () => {
    expect(deriveSlug("src/content/products/iris-no-7.json")).toBe("iris-no-7")
    expect(deriveSlug("src/content/products/iris-no-7.JSON")).toBe("iris-no-7")
    expect(deriveSlug("iris-no-7.json")).toBe("iris-no-7")
  })

  it("refuses non-json and empty names", () => {
    expect(deriveSlug("src/content/products/iris-no-7.md")).toBeNull()
    expect(deriveSlug("src/content/products/.json")).toBeNull()
    expect(deriveSlug("src/content/products/")).toBeNull()
  })
})

describe("slugify", () => {
  it("is lowercase and filename-safe", () => {
    expect(slugify("Iris No. 7 — The French Collection")).toBe("iris-no-7-the-french-collection")
    expect(slugify("  Padding  pad ")).toBe("padding-pad")
  })

  it("ASCII-folds accents and collapses runs of punctuation", () => {
    expect(slugify("Crème brûlée & Café racer")).toBe("creme-brulee-cafe-racer")
    expect(slugify("hello...world!!")).toBe("hello-world")
  })

  it("falls back to 'entry' when folding leaves nothing", () => {
    expect(slugify("你好世界")).toBe("entry")
    expect(slugify("---")).toBe("entry")
    expect(slugify("日本語")).toBe("entry")
  })
})
