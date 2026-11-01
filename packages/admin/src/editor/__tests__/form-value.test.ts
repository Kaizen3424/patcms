import type { FieldDescriptor } from "patcms/advanced"
import { canonicalJson } from "patcms/advanced"
import { describe, expect, it } from "vitest"
import type { IndexedEntry } from "../../runtime/entry-index"
import {
  composeFormBytes,
  createEntryForm,
  isFormDirty,
  withBase,
  withFieldTree,
  withFieldValue,
  withLatestVersion,
  withPublishedBase,
  withReconciledBase,
} from "../form-value"

/**
 * Form-model laws (P2.6):
 *  - the held tree is FULL (untouched merged) and virtual fields stripped;
 *  - dirtiness is value-domain and re-derived on every edit;
 *  - the only bytes we ever write come from `composeEntryDocument`;
 *  - the post-publish base is the observed commit, never a re-read.
 */

const FIELDS: readonly FieldDescriptor[] = [
  { name: "title", label: "Title", required: true, type: "string" },
  { name: "slug", label: "Web address", required: false, type: "slug" },
  { name: "price", label: "Price", required: false, type: "number" },
]

const BASE_RAW = `{
  "title": "The Rock Pendant",
  "price": 120,
  "legacy": {
    "kept": true
  }
}
`

const BASE_SHA = "a".repeat(40)

function entry(rawText = BASE_RAW): IndexedEntry {
  return {
    collectionName: "products",
    collection: {
      kind: "folder",
      name: "products",
      label: "Products",
      folder: "src/content/products",
      format: "json",
      fields: FIELDS,
    },
    path: "src/content/products/rock.json",
    slug: "rock",
    title: "The Rock Pendant",
    fields: FIELDS,
    media: { folder: "public/images", publicFolder: "/images" },
    raw: { title: "The Rock Pendant", price: 120, legacy: { kept: true } },
    // parseEntry injects the virtual slug into the modeled value.
    value: { title: "The Rock Pendant", slug: "rock", price: 120 },
    issues: [],
    untouched: { "/legacy": { kept: true } },
    rawText,
    blobSha: "b".repeat(40),
  }
}

function form(): ReturnType<typeof createEntryForm> & { ok: true } {
  const created = createEntryForm(entry(), BASE_SHA)
  if (!created.ok) throw new Error("fixture must parse")
  return created as ReturnType<typeof createEntryForm> & { ok: true }
}

describe("entry form model", () => {
  it("seeds the FULL tree: untouched keys merged, virtual slug stripped, clean", () => {
    const { form: state } = form()
    expect(state.formValue).toEqual({
      title: "The Rock Pendant",
      price: 120,
      legacy: { kept: true },
    })
    expect(state.formValue).not.toHaveProperty("slug")
    expect(state.dirtyPaths).toEqual([])
    expect(isFormDirty(state)).toBe(false)
    expect(composeFormBytes(state, FIELDS)).toBe(BASE_RAW)
  })

  it("a keystroke dirties exactly that path and the save bytes carry the edit", () => {
    const { form: state } = form()
    const edited = withFieldValue(state, "title", "The Rock Pendant II")
    expect(edited.dirtyPaths).toEqual([["title"]])
    expect(JSON.parse(composeFormBytes(edited, FIELDS))).toEqual({
      title: "The Rock Pendant II",
      price: 120,
      legacy: { kept: true },
    })
  })

  it("undoing back to the base clears the dirty set and keeps original bytes", () => {
    const { form: state } = form()
    const edited = withFieldValue(state, "title", "Changed")
    const undone = withFieldValue(edited, "title", "The Rock Pendant")
    expect(undone.dirtyPaths).toEqual([])
    expect(composeFormBytes(undone, FIELDS)).toBe(BASE_RAW)
  })

  it("clearing a value removes the key instead of writing null", () => {
    const { form: state } = form()
    const cleared = withFieldValue(state, "price", undefined)
    expect(cleared.dirtyPaths).toEqual([["price"]])
    const bytes = composeFormBytes(cleared, FIELDS)
    expect(bytes).not.toContain("price")
    expect(JSON.parse(bytes)).toEqual({ title: "The Rock Pendant", legacy: { kept: true } })
  })

  it("refuses an entry whose source bytes never parsed (no re-printing)", () => {
    const created = createEntryForm(entry("{ not json"), BASE_SHA)
    expect(created.ok).toBe(false)
    if (!created.ok) expect(created.reason).toBe("unreadable")
  })

  it("post-publish base is the observed commit; edits made during the save stay dirty", () => {
    const { form: state } = form()
    // Save composed v2, and the founder typed "III" while it committed.
    const composed = composeFormBytes(withFieldValue(state, "title", "v2"), FIELDS)
    const duringSave = withFieldValue(withFieldValue(state, "title", "v2"), "title", "v2 III")

    const rebased = withPublishedBase(duringSave, { commitSha: "c".repeat(40), raw: composed })
    expect(rebased.baseSha).toBe("c".repeat(40))
    expect(rebased.baseRaw).toBe(composed)
    expect(rebased.baseValue).toEqual({ title: "v2", price: 120, legacy: { kept: true } })
    expect(rebased.dirtyPaths).toEqual([["title"]])
  })

  it("a no-edit publish leaves the form clean against the new bytes", () => {
    const { form: state } = form()
    const composed = composeFormBytes(state, FIELDS)
    const rebased = withPublishedBase(state, { commitSha: "c".repeat(40), raw: composed })
    expect(rebased.dirtyPaths).toEqual([])
    expect(rebased.formValue).toEqual(rebased.baseValue)
  })

  it("start over drops the local tree but keeps the base", () => {
    const { form: state } = form()
    const edited = withFieldValue(state, "title", "Changed")
    const reset = withLatestVersion(edited)
    expect(reset.formValue).toEqual(state.formValue)
    expect(reset.dirtyPaths).toEqual([])
  })

  it("rebinding the base keeps the local tree and re-diffs it", () => {
    const { form: state } = form()
    const edited = withFieldValue(state, "title", "Mine")
    const freshRaw = canonicalJson({
      title: "Theirs",
      price: 120,
      legacy: { kept: true },
    } as never)
    const rebased = withBase(edited, { baseSha: "d".repeat(40), baseRaw: freshRaw })
    expect(rebased.baseSha).toBe("d".repeat(40))
    expect(rebased.formValue.title).toBe("Mine")
    expect(rebased.dirtyPaths).toEqual([["title"]])
  })

  it("a restored tree is re-diffed against the base it lands on", () => {
    const { form: state } = form()
    const restored = withFieldTree(state, { title: "The Rock Pendant", price: 120 })
    expect(restored.dirtyPaths).toEqual([["legacy"]])
  })

  it("withReconciledBase adopts reconciled bytes and replays late keystrokes", () => {
    const { form: state } = form()
    const submitSnapshot = { ...state.formValue, title: "Our Edit" }

    // Suppose partner edited price to 999 and that landed via auto-merge
    const reconciledRaw = canonicalJson({
      title: "Our Edit",
      price: 999,
      legacy: { kept: true },
    } as never)

    // And while the save was in-flight, founder made another keystroke on title
    const liveForm = withFieldValue(
      { ...state, formValue: submitSnapshot },
      "title",
      "Our Edit with late typing",
    )

    const next = withReconciledBase(liveForm, {
      commitSha: "e".repeat(40),
      raw: reconciledRaw,
      submitSnapshot,
    })

    expect(next.baseSha).toBe("e".repeat(40))
    expect(next.baseValue.price).toBe(999)
    // Partner's price was adopted into formValue
    expect(next.formValue.price).toBe(999)
    // Late keystroke survived
    expect(next.formValue.title).toBe("Our Edit with late typing")
    // Only the late edit is dirty against the new reconciled base
    expect(next.dirtyPaths).toEqual([["title"]])
  })

  it("a hostile field name becomes an own property, never a prototype write", () => {
    const { form: state } = form()
    const dirty = withFieldValue(state, "__proto__", "x")
    expect(Object.getPrototypeOf(dirty.formValue)).toBe(Object.prototype)
    expect(Object.hasOwn(dirty.formValue, "__proto__")).toBe(true)
    expect(({} as Record<string, unknown>).x).toBeUndefined()
  })
})
