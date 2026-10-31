import { describe, expect, it } from "vitest"
import type { FieldDescriptor } from "../types"
import type { RelationServices } from "../validate"
import { mergeUntouched, validateEntryForSave } from "../validate"

function relation(name: string, options: { multiple?: boolean } = {}): FieldDescriptor {
  return {
    name,
    type: "relation",
    label: name,
    required: false,
    collection: "products",
    displayFields: ["title"],
    ...(options.multiple === true ? { multiple: true } : {}),
  }
}

function options(fields: readonly FieldDescriptor[], raw: unknown, services?: RelationServices) {
  return {
    fields,
    raw,
    filePath: "src/content/products/x.json",
    ...(services === undefined ? {} : { services }),
  }
}

describe("validateEntryForSave relation checks + strict gate", () => {
  it("blocks on parse errors but lets warnings through", async () => {
    const fields: FieldDescriptor[] = [
      { name: "title", type: "string", label: "Title", required: true },
    ]
    const bad = await validateEntryForSave(options(fields, { extra: 1 }))
    expect(bad.ok).toBe(false)
    if (!bad.ok) {
      expect(bad.issues.map((issue) => issue.code)).toEqual(["MISSING_REQUIRED", "UNMODELED_KEY"])
    }

    const good = await validateEntryForSave(options(fields, { title: "ok", extra: 1 }))
    expect(good.ok).toBe(true)
    if (good.ok) expect(good.untouched).toEqual({ "/extra": 1 })
  })

  it("flags missing single and multiple relations", async () => {
    const fields = [relation("single"), relation("many", { multiple: true })]
    const result = await validateEntryForSave(
      options(
        fields,
        { single: "missing", many: ["ok", "gone"] },
        {
          hasEntry: (collection, value) => collection === "products" && value === "ok",
        },
      ),
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.issues.map((issue) => issue.path)).toEqual(["single", "many[1]"])
    expect(result.issues.map((issue) => issue.code)).toEqual([
      "RELATION_UNKNOWN",
      "RELATION_UNKNOWN",
    ])
  })

  it("checks relations inside objects and object-list items", async () => {
    const fields: FieldDescriptor[] = [
      {
        name: "nested",
        type: "object",
        label: "Nested",
        required: false,
        fields: [relation("featured")],
      },
      {
        name: "items",
        type: "list",
        label: "Items",
        required: false,
        itemMode: "object",
        fields: [relation("product")],
      },
    ]
    const seen: string[] = []
    const result = await validateEntryForSave(
      options(
        fields,
        { nested: { featured: "a" }, items: [{ product: "b" }, { product: "c" }] },
        {
          hasEntry: (_collection, value) => {
            seen.push(value)
            return value === "a"
          },
        },
      ),
    )
    expect(seen).toEqual(["a", "b", "c"])
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.issues.map((issue) => issue.path)).toEqual([
      "items[0].product",
      "items[1].product",
    ])
  })

  it("checks scalar-list relations", async () => {
    const fields: FieldDescriptor[] = [
      {
        name: "related",
        type: "list",
        label: "Related",
        required: false,
        itemMode: "scalar",
        fields: [relation("product")],
      },
    ]
    const result = await validateEntryForSave(
      options(fields, { related: ["a", "b"] }, { hasEntry: (_c, value) => value === "a" }),
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.issues[0]?.path).toBe("related[1]")
    expect(result.issues[0]?.code).toBe("RELATION_UNKNOWN")
  })

  it("turns a throwing relation service into a check-failed error", async () => {
    const fields = [relation("single"), relation("many", { multiple: true })]
    const result = await validateEntryForSave(
      options(
        fields,
        { single: "x", many: ["y"] },
        {
          hasEntry: () => {
            throw new Error("index offline")
          },
        },
      ),
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.issues.map((issue) => issue.code)).toEqual([
      "RELATION_CHECK_FAILED",
      "RELATION_CHECK_FAILED",
    ])
  })

  it("skips relation checks when no service is injected", async () => {
    const result = await validateEntryForSave(options([relation("single")], { single: "anything" }))
    expect(result.ok).toBe(true)
  })
})

describe("mergeUntouched (explicit JSON-Pointer composition, no merges)", () => {
  it("re-attaches nested untouched keys without mutating the input", () => {
    const value = { images: [{ alt: "x" }], title: "kept" }
    const merged = mergeUntouched(value, {
      "/images/0/devCaption": { text: "hello", tags: ["a"] },
      "/extra": 1,
      "/a~1b": { "c~d": true },
    })
    expect(merged).toEqual({
      images: [{ alt: "x", devCaption: { text: "hello", tags: ["a"] } }],
      title: "kept",
      extra: 1,
      "a/b": { "c~d": true },
    })
    expect(value).toEqual({ images: [{ alt: "x" }], title: "kept" })
  })

  it("creates intermediate arrays and objects as needed", () => {
    const merged = mergeUntouched(
      {},
      {
        "/list/0/name": "first",
        "/map/child/value": 2,
        "/list/1": "second",
      },
    )
    expect(merged).toEqual({
      list: [{ name: "first" }, "second"],
      map: { child: { value: 2 } },
    })
  })

  it("refuses dangerous pointer tokens and malformed pointers", () => {
    const merged = mergeUntouched(
      { safe: true, keep: { nested: true } },
      {
        "no-leading-slash": 1,
        "/__proto__/polluted": true,
        "/constructor/prototype/x": 1,
        "/keep/__proto__": 2,
        "/keep/constructor": 3,
      },
    )
    expect(merged).toEqual({ safe: true, keep: { nested: true } })
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })

  it("returns an empty object when the parsed value is not a record", () => {
    expect(mergeUntouched({}, { "/x": 1 })).toEqual({ x: 1 })
    expect(mergeUntouched([] as unknown as Record<string, unknown>, { "/x": 1 })).toEqual({})
    expect(mergeUntouched(null as unknown as Record<string, unknown>, {})).toEqual({})
  })

  it("drops unknown object values that JSON cannot represent", () => {
    const merged = mergeUntouched({}, { "/fn": (() => undefined) as never })
    expect(Object.hasOwn(merged, "fn")).toBe(true)
    expect(merged.fn).toBeUndefined()
  })

  it("backfills missing hidden defaults on save (repair-on-save ADR-0003 P3 addendum)", async () => {
    const fields: FieldDescriptor[] = [
      { name: "title", type: "string", label: "Title", required: true },
      {
        name: "materialFilter",
        type: "hidden",
        label: "Material filter",
        required: false,
        defaultValue: "Ceramics",
      },
      {
        name: "images",
        type: "list",
        label: "Images",
        required: false,
        itemMode: "object",
        fields: [
          { name: "image", type: "string", label: "Image", required: true },
          {
            name: "objectPosition",
            type: "hidden",
            label: "Crop focus",
            required: false,
            defaultValue: "center",
          },
        ],
      },
    ]

    const raw = {
      title: "Iris No. 7",
      images: [{ image: "/images/products/iris-1.jpg" }],
    }

    const result = await validateEntryForSave(options(fields, raw))
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error("expected validation ok")

    expect(result.value.materialFilter).toBe("Ceramics")
    const images = result.value.images as Array<Record<string, unknown>>
    expect(images[0]?.objectPosition).toBe("center")
  })

  it("does not overwrite existing hidden values during repair-on-save", async () => {
    const fields: FieldDescriptor[] = [
      {
        name: "materialFilter",
        type: "hidden",
        label: "Material filter",
        required: false,
        defaultValue: "Ceramics",
      },
    ]

    const result = await validateEntryForSave(options(fields, { materialFilter: "Custom Glass" }))
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error("expected validation ok")
    expect(result.value.materialFilter).toBe("Custom Glass")
  })
})
