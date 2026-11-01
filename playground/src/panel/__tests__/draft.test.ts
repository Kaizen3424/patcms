import type { Draft, Entry } from "patcms"
import { describe, expect, it } from "vitest"
import { evaluateDraft } from "../lib/draft"

const entry = {
  sha: "a".repeat(40),
} as Pick<Entry, "sha">

function draft(baseSha: string): Draft {
  return {
    collection: "products",
    slug: "iris",
    path: "src/content/products/iris.json",
    savedAt: "2026-11-01T00:00:00.000Z",
    baseSha,
    baseRaw: "{}",
    value: {},
  }
}

describe("evaluateDraft", () => {
  it("is undefined without a draft", () => {
    expect(evaluateDraft(entry, undefined)).toBeUndefined()
  })

  it("calls a draft current when its base sha is still the head", () => {
    expect(evaluateDraft(entry, draft(entry.sha))).toMatchObject({ freshness: "current" })
  })

  it("calls a draft stale when the branch moved underneath it", () => {
    expect(evaluateDraft(entry, draft("b".repeat(40)))).toMatchObject({ freshness: "stale" })
  })
})
