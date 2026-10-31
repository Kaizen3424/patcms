import { describe, expect, it } from "vitest"
import { mustacheLite, readPath } from "../mustache"

describe("INV-T01 mustache-lite renders values as text", () => {
  it("resolves nested fields and list indexes", () => {
    const values = { fields: { title: "Iris No. 7", people: [{ name: "Ada" }] } }
    expect(mustacheLite("{{ fields.title }}", values)).toBe("Iris No. 7")
    expect(mustacheLite("{{fields.people[0].name}}", values)).toBe("Ada")
  })

  it("renders missing values as empty and never leaks prototype keys", () => {
    expect(mustacheLite("{{missing}}", {})).toBe("")
    expect(readPath({}, "constructor")).toBeUndefined()
    expect(readPath({}, "__proto__")).toBeUndefined()
    expect(mustacheLite("{{ constructor }}", {})).toBe("")
  })

  it("does not render objects/arrays as [object Object]", () => {
    expect(mustacheLite("{{a}}", { a: { b: 1 } })).toBe("")
    expect(mustacheLite("{{a}}", { a: [1, 2] })).toBe("")
  })
})

describe("INV-T01 golden XSS payloads", () => {
  const payloads = [
    '<img src=x onerror="alert(1)">',
    "<script>alert('xss')</script>",
    "javascript:alert(1)",
    '"><svg/onload=alert(1)>',
    "{{constructor.constructor('alert(1)')()}}",
    "&lt;already-escaped&gt;",
  ]

  for (const payload of payloads) {
    it(`keeps payload byte-exact for summaries/preview/alt/group: ${payload.slice(0, 12)}`, () => {
      const values = {
        fields: {
          title: payload,
          preview_path: payload,
          alt: payload,
          group: payload,
        },
      }
      for (const template of [
        "{{fields.title}}",
        "{{fields.preview_path}}",
        "{{fields.alt}}",
        "{{fields.group}}",
        "{{fields.label}}: {{fields.value}}",
      ]) {
        const itemValues = {
          fields: {
            ...values.fields,
            label: payload,
            value: payload,
            swatch: payload,
          },
        }
        const output = mustacheLite(template, itemValues)
        expect(output).toContain(payload)
      }
    })
  }

  it("leaves unknown tokens untouched only when syntax is invalid", () => {
    expect(mustacheLite("{{not valid!}}", {})).toBe("{{not valid!}}")
    expect(mustacheLite("text {{fields.title", { fields: { title: "x" } })).toBe(
      "text {{fields.title",
    )
  })
})
