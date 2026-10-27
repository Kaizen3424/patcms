import { describe, expect, it } from "vitest"
import type { FieldDescriptor } from "../../fields/types"
import { parseJsonDocument } from "../document"
import { composeEntryDocument } from "../entry-document"

const PRODUCT_FIELDS: readonly FieldDescriptor[] = [
  { name: "title", label: "Title", required: true, type: "string" },
  { name: "slug", label: "Web address", required: false, type: "slug" },
  { name: "price", label: "Price", required: false, type: "number" },
]

const BASE = `{
  "title": "The Rock Pendant",
  "price": 120,
  "legacy": { "kept": true }
}
`

function documentFrom(raw: string) {
  const parsed = parseJsonDocument(raw)
  if (!parsed.ok) throw new Error("fixture must parse")
  return parsed.document
}

describe("composeEntryDocument", () => {
  it("returns the original bytes when nothing changed (virtual slug excluded)", () => {
    const composed = composeEntryDocument({
      fields: PRODUCT_FIELDS,
      // parseEntry injects the virtual slug into the modeled value
      value: { title: "The Rock Pendant", slug: "the-rock-pendant", price: 120 },
      untouched: { "/legacy": { kept: true } },
      document: documentFrom(BASE),
    })

    expect(composed.raw).toBe(BASE)
    expect(composed.value).toEqual({
      title: "The Rock Pendant",
      price: 120,
      legacy: { kept: true },
    })
  })

  it("writes only the edited field and preserves untouched keys", () => {
    const composed = composeEntryDocument({
      fields: PRODUCT_FIELDS,
      value: { title: "The Rock Pendant II", slug: "the-rock-pendant", price: 120 },
      untouched: { "/legacy": { kept: true } },
      document: documentFrom(BASE),
    })

    expect(composed.raw).toBe(`{
  "title": "The Rock Pendant II",
  "price": 120,
  "legacy": {
    "kept": true
  }
}
`)
    expect(JSON.parse(composed.raw)).toEqual({
      title: "The Rock Pendant II",
      price: 120,
      legacy: { kept: true },
    })
  })

  it("never writes a slug key, even when the raw file carries a stale one", () => {
    const stale = `{"title":"A","slug":"a","price":1}\n`
    const composed = composeEntryDocument({
      fields: PRODUCT_FIELDS,
      value: { title: "A", slug: "a", price: 2 },
      untouched: {},
      document: documentFrom(stale),
    })

    expect(composed.raw).not.toContain('"slug"')
    expect(JSON.parse(composed.raw)).toEqual({ title: "A", price: 2 })
  })

  it("drops virtual slug fields inside list-of-object items", () => {
    const fields: readonly FieldDescriptor[] = [
      {
        name: "rows",
        label: "Rows",
        required: false,
        type: "list",
        itemMode: "object",
        fields: [
          { name: "label", label: "Label", required: false, type: "string" },
          { name: "slug", label: "Web address", required: false, type: "slug" },
        ],
      },
    ]
    const raw = `{"rows":[{"label":"A"}]}\n`
    const composed = composeEntryDocument({
      fields,
      value: { rows: [{ label: "A", slug: "a" }] },
      untouched: {},
      document: documentFrom(raw),
    })

    expect(composed.raw).toBe(raw)
    expect(composed.value).toEqual({ rows: [{ label: "A" }] })
  })

  it("keeps CRLF bytes for an unchanged document", () => {
    const crlf = '{\r\n  "title": "A",\r\n  "price": 1\r\n}\r\n'
    const composed = composeEntryDocument({
      fields: PRODUCT_FIELDS,
      value: { title: "A", slug: "a", price: 1 },
      untouched: {},
      document: documentFrom(crlf),
    })

    expect(composed.raw).toBe(crlf)
  })

  it("drops undefined keys instead of writing null", () => {
    const composed = composeEntryDocument({
      fields: PRODUCT_FIELDS,
      value: { title: "A", slug: "a", price: undefined as unknown as number },
      untouched: {},
      document: documentFrom('{"title":"A"}\n'),
    })

    expect(composed.raw).not.toContain("price")
    expect(JSON.parse(composed.raw)).toEqual({ title: "A" })
  })
})
