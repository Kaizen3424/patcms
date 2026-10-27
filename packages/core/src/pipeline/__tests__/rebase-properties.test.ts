/**
 * Rebase property tests P1–P11 (ADR-0004 appendix; spec §4 L0 tier).
 *
 * Each property maps 1:1 to the ADR list: disjoint-preserve · overlap-conflict
 * · idempotence · no-change identity · unknown-preserve · unknown-loss-warn ·
 * key-order preservation · list-permutation-dirty · defaults-never-inject ·
 * no-op skip · codepoint-exact equality.
 */

import fc from "fast-check"
import { describe, expect, it } from "vitest"
import type { JsonValue } from "../../safety/untrusted-json"
import { parseUntrustedJson } from "../../safety/untrusted-json"
import { jsonEqual } from "../../serialization/document"
import { fieldEquals } from "../field-equals"
import { computeDirtyPaths, diffPaths, type FieldPath } from "../field-paths"
import { rebase } from "../rebase"

type JsonObject = { [key: string]: JsonValue }

const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"])
// JS objects iterate integer-like keys FIRST (host semantics), so the key-order
// property excludes them — real CMS field names are never integer-like.
const INTEGER_LIKE_KEY = /^(?:0|[1-9][0-9]*)$/
const keyArb: fc.Arbitrary<string> = fc
  .string({ minLength: 1, maxLength: 6 })
  .filter((key) => !UNSAFE_KEYS.has(key) && !INTEGER_LIKE_KEY.test(key) && !key.includes("\u0000"))

const jsonValueArb: fc.Arbitrary<JsonValue> = fc.letrec((tie) => ({
  v: fc.oneof({ depthSize: "small" as const }, tie("primitive"), tie("array"), tie("object")),
  primitive: fc.oneof(
    fc.string({ maxLength: 8 }),
    fc.integer({ min: -1_000_000, max: 1_000_000 }),
    fc.boolean(),
    fc.constant(null),
  ),
  array: fc.array(tie("v") as fc.Arbitrary<JsonValue>, { maxLength: 3 }),
  object: fc.dictionary(keyArb, tie("v") as fc.Arbitrary<JsonValue>, { maxKeys: 3 }),
})).v as fc.Arbitrary<JsonValue>

const docArb: fc.Arbitrary<JsonObject> = fc.dictionary(keyArb, jsonValueArb, {
  minKeys: 2,
  maxKeys: 5,
})

/** Edit values are wrapper-tagged so collisions with base values are ~never. */
const oursEditValue = (v: JsonValue): JsonValue => ({ mycms: "ours", v })
const foreignEditValue = (v: JsonValue): JsonValue => ({ mycms: "foreign", v })

function rebaseOf(
  base: JsonObject,
  form: JsonObject,
  dirtyPaths: ReadonlySet<FieldPath>,
  newDoc: JsonObject,
): ReturnType<typeof rebase> {
  return rebase({
    formValue: form,
    dirtyPaths,
    oldBase: base,
    oldRaw: JSON.stringify(base),
    newBaseRaw: JSON.stringify(newDoc),
  })
}

function parseOk(raw: string): JsonValue {
  const parsed = parseUntrustedJson(raw)
  expect(parsed.ok).toBe(true)
  return parsed.ok ? parsed.value : ({} as JsonValue)
}

function pathKey(path: FieldPath): string {
  return JSON.stringify(path)
}

// ---------------------------------------------------------------------------
// P1 — disjoint-preserve: non-overlapping dirty paths auto-merge.
// ---------------------------------------------------------------------------
describe("P1 — disjoint-preserve", () => {
  it("foreign and our edits on different keys both land, remote keeps the new raw", () => {
    fc.assert(
      fc.property(
        docArb,
        jsonValueArb,
        jsonValueArb,
        fc.constantFrom("set", "delete") as fc.Arbitrary<"set" | "delete">,
        fc.constantFrom("set", "delete") as fc.Arbitrary<"set" | "delete">,
        (base, ourRaw, foreignRaw, ourOp, foreignOp) => {
          const keys = Object.keys(base)
          const [keyA, keyB] = keys
          if (keyA === undefined || keyB === undefined) return
          fc.pre(!fieldEquals(foreignEditValue(foreignRaw), base[keyB]))
          const form: JsonObject = { ...base }
          if (ourOp === "set") form[keyA] = oursEditValue(ourRaw)
          else delete form[keyA]
          const newDoc: JsonObject = { ...base }
          if (foreignOp === "set") newDoc[keyB] = foreignEditValue(foreignRaw)
          else delete newDoc[keyB]
          const dirty = new Set([[keyA] as FieldPath])

          const result = rebaseOf(base, form, dirty, newDoc)
          expect(result.ok).toBe(true)
          if (!result.ok) return
          expect(result.conflicts).toEqual([])
          // The adopted foreign changes are announced (auto-merge + announcement)
          // at exactly the foreign diff granularity.
          expect(result.warnings.map(pathKey).sort()).toEqual(
            diffPaths(newDoc, base).map(pathKey).sort(),
          )

          const merged = parseOk(result.mergedRaw) as JsonObject
          expect(Object.hasOwn(merged, keyA)).toBe(ourOp === "set")
          if (ourOp === "set") {
            expect(jsonEqual(merged[keyA], form[keyA])).toBe(true)
          }
          expect(jsonEqual(merged[keyB], newDoc[keyB])).toBe(true)
          // Every untouched key survives verbatim from the new base.
          for (const key of keys.slice(2)) {
            expect(jsonEqual(merged[key], base[key])).toBe(true)
          }
        },
      ),
      { numRuns: 200 },
    )
  })

  it("nested disjoint edits (object recusal) land per-path", () => {
    const base: JsonObject = {
      contact: { email: "a@x", city: "y", zip: "1" },
      title: "t",
    }
    const form: JsonObject = {
      contact: { email: "b@x", city: "y", zip: "1" },
      title: "t",
    }
    const newDoc: JsonObject = {
      contact: { email: "a@x", city: "FOREIGN", zip: "1" },
      title: "t",
    }
    const result = rebaseOf(base, form, new Set([["contact", "email"]]), newDoc)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.conflicts).toEqual([])
    const merged = parseOk(result.mergedRaw) as JsonObject
    const contact = merged.contact as JsonObject
    expect(contact.email).toBe("b@x")
    expect(contact.city).toBe("FOREIGN")
    expect(contact.zip).toBe("1")
  })
})

// ---------------------------------------------------------------------------
// P2 — overlap-conflict (never silent win).
// ---------------------------------------------------------------------------
describe("P2 — overlap-conflict", () => {
  it("the same field edited on both sides conflicts and keeps the REMOTE bytes", () => {
    fc.assert(
      fc.property(docArb, jsonValueArb, jsonValueArb, (base, ourRaw, foreignRaw) => {
        const key = Object.keys(base)[0]
        if (key === undefined) return
        const ourValue = oursEditValue(ourRaw)
        const foreignValue = foreignEditValue(foreignRaw)
        fc.pre(!fieldEquals(ourValue, base[key]))
        fc.pre(!fieldEquals(foreignValue, base[key]))
        const form: JsonObject = { ...base, [key]: ourValue }
        const newDoc: JsonObject = { ...base, [key]: foreignValue }

        const result = rebaseOf(base, form, new Set([[key]]), newDoc)
        expect(result.ok).toBe(true)
        if (!result.ok) return
        expect(result.conflicts.map(pathKey)).toEqual([JSON.stringify([key])])
        // Never a silent win: the merged field carries the REMOTE value.
        const merged = parseOk(result.mergedRaw) as JsonObject
        expect(jsonEqual(merged[key], foreignValue)).toBe(true)
      }),
      { numRuns: 200 },
    )
  })

  it("sibling edits inside one object merge without conflict", () => {
    const base: JsonObject = { card: { alt: "old", title: "t" } }
    const form: JsonObject = { card: { alt: "ours", title: "t" } }
    const newDoc: JsonObject = { card: { alt: "old", title: "foreign" } }
    const result = rebaseOf(base, form, new Set([["card", "alt"]]), newDoc)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.conflicts).toEqual([])
    const merged = parseOk(result.mergedRaw) as JsonObject
    expect((merged.card as JsonObject).alt).toBe("ours")
    expect((merged.card as JsonObject).title).toBe("foreign")
  })

  it("our whole-node edit vs a foreign change inside it conflicts at OUR path", () => {
    const base: JsonObject = { card: { alt: "old", title: "t" } }
    const form: JsonObject = { card: { alt: "ours", title: "ours too" } }
    const newDoc: JsonObject = { card: { alt: "old", title: "foreign" } }
    const result = rebaseOf(base, form, new Set([["card"]]), newDoc)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.conflicts.map(pathKey)).toEqual([JSON.stringify(["card"])])
    const merged = parseOk(result.mergedRaw) as JsonObject
    expect(jsonEqual(merged.card, newDoc.card)).toBe(true)
  })

  it("convergent edits (same value both sides) stay silent and verbatim", () => {
    const base: JsonObject = { price: 100 }
    const form: JsonObject = { price: 150 }
    const newDoc: JsonObject = { price: 150 }
    const raw = JSON.stringify(newDoc)
    const result = rebaseOf(base, form, new Set([["price"]]), newDoc)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.conflicts).toEqual([])
    expect(result.warnings).toEqual([])
    expect(result.mergedRaw).toBe(raw) // byte-identical: no splice, no reprint
  })
})

// ---------------------------------------------------------------------------
// P3 — idempotence: a second rebase against its own output is a fixed point.
// ---------------------------------------------------------------------------
describe("P3 — idempotence", () => {
  it("re-running with the same dirty set against the merged raw reproduces the result", () => {
    fc.assert(
      fc.property(
        docArb,
        jsonValueArb,
        jsonValueArb,
        fc.boolean(),
        (base, ourRaw, foreignRaw, conflict) => {
          const keys = Object.keys(base)
          const [keyA, keyB] = keys
          if (keyA === undefined || keyB === undefined) return
          const ourValue = oursEditValue(ourRaw)
          const foreignValue = foreignEditValue(foreignRaw)
          fc.pre(!fieldEquals(ourValue, base[keyA]))
          const form: JsonObject = { ...base, [keyA]: ourValue }
          let newDoc: JsonObject
          let dirty: ReadonlySet<FieldPath>
          if (conflict) {
            fc.pre(!fieldEquals(foreignValue, base[keyA]))
            newDoc = { ...base, [keyA]: foreignValue }
            dirty = new Set([[keyA]])
          } else {
            fc.pre(!fieldEquals(foreignValue, base[keyB]))
            newDoc = { ...base, [keyB]: foreignValue }
            dirty = new Set([[keyA]])
          }

          const first = rebaseOf(base, form, dirty, newDoc)
          expect(first.ok).toBe(true)
          if (!first.ok) return
          const second = rebase({
            formValue: form,
            dirtyPaths: dirty,
            oldBase: base,
            oldRaw: JSON.stringify(base),
            newBaseRaw: first.mergedRaw,
          })
          expect(second.ok).toBe(true)
          if (!second.ok) return
          expect(second.mergedRaw).toBe(first.mergedRaw)
          expect(second.conflicts.map(pathKey)).toEqual(first.conflicts.map(pathKey))
          expect(second.warnings.map(pathKey)).toEqual(first.warnings.map(pathKey))
        },
      ),
      { numRuns: 200 },
    )
  })
})

// ---------------------------------------------------------------------------
// P4 — no-change identity (no re-serialization).
// ---------------------------------------------------------------------------
describe("P4 — no-change identity", () => {
  it("an empty dirty set returns the new base bytes byte-identical", () => {
    const base: JsonObject = { title: "t", price: 5 }
    const raw = JSON.stringify(base) // deliberately non-canonical (compact)
    const result = rebase({
      formValue: base,
      dirtyPaths: new Set(),
      oldBase: base,
      oldRaw: JSON.stringify(base, null, 2),
      newBaseRaw: raw,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.mergedRaw).toBe(raw)
  })

  it("a dirty path whose form value already matches the new base splices nothing", () => {
    const base: JsonObject = { title: "t" }
    const form: JsonObject = { title: "foreign-agreed" }
    const newDoc: JsonObject = { title: "foreign-agreed" }
    const raw = JSON.stringify(newDoc)
    const result = rebaseOf(base, form, new Set([["title"]]), newDoc)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.mergedRaw).toBe(raw)
  })
})

// ---------------------------------------------------------------------------
// P5 — unknown-preserve: keys the form does not model survive from the new raw.
// ---------------------------------------------------------------------------
describe("P5 — unknown-preserve", () => {
  it("unmodeled keys are preserved from the NEW raw, never dropped by the form", () => {
    const base: JsonObject = { modeled: "x", legacy_extra: { keep: true }, other: "z" }
    // The editor's form is a modeled PROJECTION: `legacy_extra` is absent —
    // but the dirty set only carries user-touched paths (never the projection gap).
    const form: JsonObject = { modeled: "ours" }
    const newDoc: JsonObject = { modeled: "x", legacy_extra: { keep: true }, other: "foreign" }
    const result = rebaseOf(base, form, new Set([["modeled"]]), newDoc)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.conflicts).toEqual([])
    const merged = parseOk(result.mergedRaw) as JsonObject
    expect(jsonEqual(merged.legacy_extra, newDoc.legacy_extra)).toBe(true)
    expect(merged.other).toBe("foreign")
    expect(merged.modeled).toBe("ours")
  })

  it("a foreign DELETION of an unmodeled key stays deleted (old unknowns never resurrect)", () => {
    const base: JsonObject = { modeled: "x", legacy_extra: "y" }
    const form: JsonObject = { modeled: "ours", legacy_extra: "y" }
    const newDoc: JsonObject = { modeled: "x" }
    const result = rebaseOf(base, form, new Set([["modeled"]]), newDoc)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const merged = parseOk(result.mergedRaw) as JsonObject
    expect(Object.hasOwn(merged, "legacy_extra")).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// P6 — unknown-loss-warn: losing an old-only key warns, never silently.
// ---------------------------------------------------------------------------
describe("P6 — unknown-loss-warn", () => {
  it("a foreign deletion of an unmodeled key announces itself in warnings", () => {
    const base: JsonObject = { modeled: "x", legacy_extra: "y" }
    const form: JsonObject = { modeled: "ours", legacy_extra: "y" }
    const newDoc: JsonObject = { modeled: "x" }
    const result = rebaseOf(base, form, new Set([["modeled"]]), newDoc)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.warnings.map(pathKey)).toEqual([JSON.stringify(["legacy_extra"])])
  })

  it("a foreign value change on an unmodeled key is adopted and announced", () => {
    const base: JsonObject = { modeled: "x", legacy_extra: "y" }
    const form: JsonObject = { modeled: "ours", legacy_extra: "y" }
    const newDoc: JsonObject = { modeled: "x", legacy_extra: "foreign-changed" }
    const result = rebaseOf(base, form, new Set([["modeled"]]), newDoc)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.warnings.map(pathKey)).toEqual([JSON.stringify(["legacy_extra"])])
    const merged = parseOk(result.mergedRaw) as JsonObject
    expect(merged.legacy_extra).toBe("foreign-changed")
    expect(merged.modeled).toBe("ours")
  })
})

// ---------------------------------------------------------------------------
// P7 — key-order preservation (the merge substrate is the new raw).
// ---------------------------------------------------------------------------
describe("P7 — key-order preservation", () => {
  it("merged key order equals the new base order; splices keep their position", () => {
    fc.assert(
      fc.property(docArb, jsonValueArb, (base, ourRaw) => {
        const keys = Object.keys(base)
        if (keys.length < 2) return
        // A "foreign commit" that only REORDERS keys (value-identical).
        const rotated = [...keys.slice(1), keys[0] as string]
        const newDoc: JsonObject = {}
        for (const key of rotated) newDoc[key] = base[key] as JsonValue
        const target = keys[0] as string
        const form: JsonObject = { ...base, [target]: oursEditValue(ourRaw) }
        fc.pre(!fieldEquals(form[target], base[target]))

        const result = rebaseOf(base, form, new Set([[target]]), newDoc)
        expect(result.ok).toBe(true)
        if (!result.ok) return
        const merged = parseOk(result.mergedRaw) as JsonObject
        expect(Object.keys(merged)).toEqual(rotated)
        expect(jsonEqual(merged[target], form[target])).toBe(true)
      }),
      { numRuns: 200 },
    )
  })

  it("a user-introduced key is appended after the new base keys", () => {
    const base: JsonObject = { a: 1, b: 2 }
    const form: JsonObject = { a: 1, b: 2, brand_new: "ours" }
    const newDoc: JsonObject = { a: 1, b: 2 }
    const result = rebaseOf(base, form, new Set([["brand_new"]]), newDoc)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const merged = parseOk(result.mergedRaw) as JsonObject
    expect(Object.keys(merged)).toEqual(["a", "b", "brand_new"])
    expect(merged.brand_new).toBe("ours")
  })
})

// ---------------------------------------------------------------------------
// P8 — list-permutation-dirty (order significant, merge stays coherent).
// ---------------------------------------------------------------------------
describe("P8 — list-permutation-dirty", () => {
  it("reordering marks the list dirty and the merge adopts the form order", () => {
    const base: JsonObject = { features: [1, 2, 3] }
    const form: JsonObject = { features: [2, 3, 1] }
    // Equal length ⇒ per-index granularity: every index changed.
    expect(computeDirtyPaths(form, base).map(pathKey)).toEqual([
      JSON.stringify(["features", 0]),
      JSON.stringify(["features", 1]),
      JSON.stringify(["features", 2]),
    ])
    const newDoc: JsonObject = { features: [1, 2, 3] }
    const result = rebaseOf(base, form, new Set(computeDirtyPaths(form, base)), newDoc)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.conflicts).toEqual([])
    const merged = parseOk(result.mergedRaw) as JsonObject
    expect(merged.features).toEqual([2, 3, 1])
  })

  it("a length change marks the whole list as one unit", () => {
    const base: JsonObject = { features: [1, 2, 3] }
    const form: JsonObject = { features: [1, 2] }
    expect(computeDirtyPaths(form, base).map(pathKey)).toEqual([JSON.stringify(["features"])])
    const result = rebaseOf(base, form, new Set([["features"]]), base)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const merged = parseOk(result.mergedRaw) as JsonObject
    expect(merged.features).toEqual([1, 2])
  })

  it("foreign item change at another index merges positionally without conflict", () => {
    const base: JsonObject = { features: [1, 2, 3] }
    const form: JsonObject = { features: [1, 99, 3] }
    const newDoc: JsonObject = { features: [42, 2, 3] }
    const result = rebaseOf(base, form, new Set([["features", 1]]), newDoc)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.conflicts).toEqual([])
    const merged = parseOk(result.mergedRaw) as JsonObject
    expect(merged.features).toEqual([42, 99, 3])
  })
})

// ---------------------------------------------------------------------------
// P9 — defaults-never-inject (rebase is schema-blind).
// ---------------------------------------------------------------------------
describe("P9 — defaults-never-inject", () => {
  it("the merged doc never gains keys beyond the new base plus dirty introductions", () => {
    const base: JsonObject = { a: 1, b: 2 }
    const form: JsonObject = { a: 9 } // modeled projection missing `b`
    const newDoc: JsonObject = { a: 1, b: 2 }
    const result = rebaseOf(base, form, new Set([["a"]]), newDoc)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const merged = parseOk(result.mergedRaw) as JsonObject
    expect(Object.keys(merged).sort()).toEqual(["a", "b"])
    expect(merged.a).toBe(9)
  })

  it("a user deletion removes the key without any phantom re-creation", () => {
    const base: JsonObject = { a: 1, b: 2 }
    const form: JsonObject = { a: 9 } // user deleted `b`
    const newDoc: JsonObject = { a: 1, b: 2 }
    const result = rebaseOf(base, form, new Set([["a"], ["b"]]), newDoc)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const merged = parseOk(result.mergedRaw) as JsonObject
    expect(Object.keys(merged)).toEqual(["a"])
  })
})

// ---------------------------------------------------------------------------
// P10 — no-op skip.
// ---------------------------------------------------------------------------
describe("P10 — no-op skip", () => {
  it("a form equal to its base against a changed-format remote stays verbatim", () => {
    fc.assert(
      fc.property(docArb, (base) => {
        const compact = JSON.stringify(base)
        const pretty = `${JSON.stringify(base, null, 4)}\n`
        for (const newBaseRaw of [compact, pretty]) {
          const result = rebase({
            formValue: base,
            dirtyPaths: new Set(),
            oldBase: base,
            oldRaw: JSON.stringify(base),
            newBaseRaw,
          })
          expect(result.ok).toBe(true)
          if (!result.ok) return
          expect(result.mergedRaw).toBe(newBaseRaw)
          expect(result.conflicts).toEqual([])
          expect(result.warnings).toEqual([])
        }
      }),
      { numRuns: 200 },
    )
  })
})

// ---------------------------------------------------------------------------
// P11 — codepoint-exact equality.
// ---------------------------------------------------------------------------
describe("P11 — codepoint-exact equality", () => {
  it("fieldEquals is string identity, never normalization", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 20 }), fc.string({ maxLength: 20 }), (left, right) => {
        expect(fieldEquals(left, right)).toBe(left === right)
      }),
      { numRuns: 300 },
    )
  })

  it("combining vs precomposed accents never blur together", () => {
    expect(fieldEquals("café", "cafe\u0301")).toBe(false)
    expect(fieldEquals("cafe\u0301x", "cafe\u0301x")).toBe(true)
  })

  it("the merge carries the form's exact codepoints into the raw output", () => {
    const base: JsonObject = { title: "cafe\u0301" } // decomposed
    const form: JsonObject = { title: "café" } // precomposed — the user's edit
    const newDoc: JsonObject = { title: "cafe\u0301" }
    const result = rebaseOf(base, form, new Set([["title"]]), newDoc)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const merged = parseOk(result.mergedRaw) as JsonObject
    expect(merged.title).toBe("café")
    expect((merged.title as string).charCodeAt(3)).toBe(0xe9)
  })

  it("astral-plane code points survive round-trip", () => {
    const base: JsonObject = { title: "x" }
    const form: JsonObject = { title: "\u{1d54f}" } // 𝕏 — surrogate pair
    const result = rebaseOf(base, form, new Set([["title"]]), base)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const merged = parseOk(result.mergedRaw) as JsonObject
    expect(merged.title).toBe("\u{1d54f}")
  })
})

// ---------------------------------------------------------------------------
// Guards — Result-shaped failures (never throws).
// ---------------------------------------------------------------------------
describe("rebase guards", () => {
  const base: JsonObject = { a: 1 }

  it("STALE_BASE: oldBase must be the parsed value of oldRaw", () => {
    const result = rebase({
      formValue: base,
      dirtyPaths: new Set([["a"]]),
      oldBase: { a: 2 },
      oldRaw: JSON.stringify(base),
      newBaseRaw: JSON.stringify(base),
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.issues[0]?.code).toBe("STALE_BASE")
  })

  it("ROOT_SHAPE: non-object documents are rejected, not crashed on", () => {
    const result = rebase({
      formValue: base,
      dirtyPaths: new Set([["a"]]),
      oldBase: base,
      oldRaw: "[1,2]",
      newBaseRaw: JSON.stringify(base),
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.issues[0]?.code).toBe("ROOT_SHAPE")
  })

  it("INVALID_JSON: unparseable remote raw is a Result failure", () => {
    const result = rebase({
      formValue: base,
      dirtyPaths: new Set([["a"]]),
      oldBase: base,
      oldRaw: JSON.stringify(base),
      newBaseRaw: "{nope",
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.issues[0]?.code).toBe("INVALID_JSON")
  })

  it("an empty dirty path is a shape error", () => {
    const result = rebase({
      formValue: base,
      dirtyPaths: new Set([[]]),
      oldBase: base,
      oldRaw: JSON.stringify(base),
      newBaseRaw: JSON.stringify(base),
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.issues[0]?.code).toBe("ROOT_SHAPE")
  })
})
