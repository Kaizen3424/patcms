/**
 * Entry form model (P2.6) — the value-domain half of the editor. Pure, no
 * React, no transport, no second serializer.
 *
 * The held tree is the FULL value: modeled fields + unmodeled keys merged by
 * `composeEntryDocument()` with virtual `slug` fields stripped. That single
 * choice keeps three laws true at once:
 *  - `rebase()` never sees an untouched key as deleted (no silent data loss);
 *  - a stale `slug` key in the source file never shows as a phantom edit;
 *  - the bytes written are exactly `composeEntryDocument(...)` (one composer).
 *
 * Dirtiness is recomputed from the value domain on every edit
 * (`computeDirtyPaths`), never from the machine phase (ADR-0004 P2.6 pin).
 */
import type { FieldDescriptor, FieldPath, JsonDocument } from "patcms/advanced"
import { composeEntryDocument, computeDirtyPaths, parseJsonDocument } from "patcms/advanced"
import type { IndexedEntry } from "../runtime/entry-index"
import { replayLateKeystrokes } from "./freeze-model"

export interface EntryFormState {
  /** Full edited tree (untouched keys merged, virtual fields stripped). */
  readonly formValue: Readonly<Record<string, unknown>>
  /** The commit the form was loaded against — the CAS coordinate. */
  readonly baseSha: string
  /** Raw bytes of that commit (rebase's `oldRaw`). */
  readonly baseRaw: string
  /** Parsed `baseRaw` in the composed (slug-stripped) shape. */
  readonly baseValue: Readonly<Record<string, unknown>>
  /** Source document — keeps original bytes/newlines for unchanged saves. */
  readonly document: JsonDocument
  readonly dirtyPaths: readonly FieldPath[]
}

export type EntryFormInit =
  | { readonly ok: true; readonly form: EntryFormState }
  | { readonly ok: false; readonly reason: "unreadable" }

/**
 * Seeds the form from an indexed entry. Unreadable source JSON is refused:
 * editing it would mean re-printing bytes we never parsed (INV-S01).
 */
export function createEntryForm(entry: IndexedEntry, baseSha: string): EntryFormInit {
  const parsed = parseJsonDocument(entry.rawText)
  if (!parsed.ok) return { ok: false, reason: "unreadable" }

  const composed = composeEntryDocument({
    fields: entry.fields,
    value: entry.value,
    untouched: entry.untouched,
    document: parsed.document,
  })
  const baseValue = asRecord(composed.value)
  return {
    ok: true,
    form: {
      formValue: baseValue,
      baseSha,
      baseRaw: entry.rawText,
      baseValue,
      document: parsed.document,
      dirtyPaths: [],
    },
  }
}

/** One keystroke: immutable set (`undefined` removes the key). */
export function withFieldValue(form: EntryFormState, name: string, value: unknown): EntryFormState {
  const next: Record<string, unknown> = { ...form.formValue }
  if (value === undefined) {
    delete next[name]
  } else {
    // defineProperty keeps a hostile key from touching the prototype chain.
    Object.defineProperty(next, name, {
      value,
      enumerable: true,
      configurable: true,
      writable: true,
    })
  }
  return {
    ...form,
    formValue: next,
    dirtyPaths: computeDirtyPaths(next, form.baseValue),
  }
}

/** True when the local tree differs from the base — the bar's only dirty input. */
export function isFormDirty(form: EntryFormState): boolean {
  return form.dirtyPaths.length > 0
}

/** The bytes this save would write (single composer; no admin-side serialization). */
export function composeFormBytes(form: EntryFormState, fields: readonly FieldDescriptor[]): string {
  return composeEntryDocument({
    fields,
    value: form.formValue,
    // The held tree already carries the untouched keys; merging is idempotent.
    untouched: {},
    document: form.document,
  }).raw
}

/**
 * Post-publish base refresh (ADR-0004 P2.6 pin): the new coordinate is the
 * commit the ref was OBSERVED carrying (`verdict.commitSha`) and the bytes we
 * composed — never a re-read. Edits typed during the save survive and are
 * re-diffed against the new base, so no keystroke is discarded.
 */
export function withPublishedBase(
  form: EntryFormState,
  input: { readonly commitSha: string; readonly raw: string },
): EntryFormState {
  const parsed = parseJsonDocument(input.raw)
  // Our own composed bytes are canonical and parse by construction; the
  // fallback keeps the old document rather than inventing one.
  const document = parsed.ok ? parsed.document : form.document
  const baseValue = asRecord(parsed.ok ? parsed.document.value : form.baseValue)
  return {
    ...form,
    baseSha: input.commitSha,
    baseRaw: input.raw,
    baseValue,
    document,
    dirtyPaths: computeDirtyPaths(form.formValue, baseValue),
  }
}

/**
 * Adopts a reconciled base (P2.9 — ADR-0004 auto-merge base adoption).
 * The base is updated to <commitSha, reconciledRaw>. Keystrokes typed while
 * the save ran (the difference between the live form and the submit snapshot)
 * are replayed onto the reconciled base tree.
 */
export function withReconciledBase(
  form: EntryFormState,
  input: {
    readonly commitSha: string
    readonly raw: string
    readonly submitSnapshot: Readonly<Record<string, unknown>>
  },
): EntryFormState {
  const parsed = parseJsonDocument(input.raw)
  const document = parsed.ok ? parsed.document : form.document
  const reconciledBaseValue = asRecord(parsed.ok ? parsed.document.value : form.baseValue)
  const newFormValue = replayLateKeystrokes({
    baseMineTree: input.submitSnapshot,
    liveFormTree: form.formValue,
    reconciledTree: reconciledBaseValue,
  })
  return {
    ...form,
    baseSha: input.commitSha,
    baseRaw: input.raw,
    baseValue: reconciledBaseValue,
    formValue: newFormValue,
    document,
    dirtyPaths: computeDirtyPaths(newFormValue, reconciledBaseValue),
  }
}

/** "Start over from the latest version": drop the local tree, keep the base. */
export function withLatestVersion(form: EntryFormState): EntryFormState {
  return { ...form, formValue: form.baseValue, dirtyPaths: [] }
}

/** Replaces the edited tree (boot restore / merged replay bytes). */
export function withFieldTree(
  form: EntryFormState,
  tree: Readonly<Record<string, unknown>>,
): EntryFormState {
  return { ...form, formValue: tree, dirtyPaths: computeDirtyPaths(tree, form.baseValue) }
}

/**
 * Rebinds the base (boot replay's FRESH head, lease steal, manual refresh).
 * The local tree is preserved and re-diffed, so nothing typed is lost.
 */
export function withBase(
  form: EntryFormState,
  input: { readonly baseSha: string; readonly baseRaw: string },
): EntryFormState {
  const parsed = parseJsonDocument(input.baseRaw)
  if (!parsed.ok) return form
  return {
    ...form,
    baseSha: input.baseSha,
    baseRaw: input.baseRaw,
    baseValue: asRecord(parsed.document.value),
    document: parsed.document,
    dirtyPaths: computeDirtyPaths(form.formValue, parsed.document.value),
  }
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Readonly<Record<string, unknown>>
  }
  return {}
}
