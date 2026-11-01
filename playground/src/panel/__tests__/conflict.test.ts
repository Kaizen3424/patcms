import type { FieldDescriptor } from "patcms"
import { describe, expect, it } from "vitest"
import { defaultPicks, mergePickedFields, pairConflictFields } from "../lib/conflict"

const fields: readonly FieldDescriptor[] = [
  { type: "string", name: "title", label: "Title", required: true },
  { type: "string", name: "material", label: "Material", required: false },
]

describe("pairConflictFields", () => {
  it("pairs current and local per declared field and flags equality", () => {
    const rows = pairConflictFields(
      { title: "Iris", material: "Wool" },
      { title: "Iris", material: "Leather" },
      fields,
    )
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ name: "title", equal: true, current: "Iris", mine: "Iris" })
    expect(rows[1]).toMatchObject({
      name: "material",
      equal: false,
      current: "Wool",
      mine: "Leather",
    })
  })

  it("skips dividers, hidden fields, and the virtual slug", () => {
    const rows = pairConflictFields({ slug: "iris", secret: "x" }, { slug: "iris", secret: "y" }, [
      { type: "slug", name: "slug", label: "Slug", required: false },
      { type: "hidden", name: "secret", label: "Secret", required: false },
      ...fields,
    ])
    expect(rows.map((row) => row.name)).toEqual(["title", "material"])
  })

  it("renders complex values as canonical JSON", () => {
    const rows = pairConflictFields(
      { title: "Iris", material: ["Wool", "Linen"] },
      { title: "Iris", material: ["Wool"] },
      fields,
    )
    expect(rows[1]?.current).toBe(JSON.stringify(["Wool", "Linen"]))
    expect(rows[1]?.mine).toBe(JSON.stringify(["Wool"]))
  })
})

describe("mergePickedFields", () => {
  const current = { value: { title: "Iris (theirs)", material: "Wool", extra: "kept" } }

  it("composes the chosen fields on top of the current value", () => {
    const merged = mergePickedFields(
      current,
      { title: "Iris (mine)", material: "Leather" },
      fields,
      { title: "current", material: "mine" },
    )
    expect(merged).toEqual({ title: "Iris (theirs)", material: "Leather", extra: "kept" })
  })

  it("keeps current values when no pick says otherwise", () => {
    const merged = mergePickedFields(current, { title: "x" }, fields, {})
    expect(merged).toEqual(current.value)
  })
})

describe("defaultPicks", () => {
  it("keeps mine for differing fields and current for equal ones", () => {
    const rows = pairConflictFields(
      { title: "Iris", material: "Wool" },
      { title: "Iris", material: "Leather" },
      fields,
    )
    expect(defaultPicks(rows)).toEqual({ title: "current", material: "mine" })
  })
})
