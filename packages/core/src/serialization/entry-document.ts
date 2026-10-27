/**
 * The ONE save-path document composer (ADR-0004 "P2.6 editor integration pins";
 * INV-S01/S03).
 *
 * The editor holds a MODELED value (`parseEntry().value`, which includes the
 * virtual `slug`) plus the `untouched` map for unmodeled keys. Bytes must be
 * composed from BOTH: a modeled-only tree would make every unmodeled key look
 * deleted to `rebase()` (silent data loss), and a tree that still carries
 * `slug` would write the virtual key into the file.
 *
 * Composition law: merge untouched pointers verbatim → drop every declared
 * `slug` field (virtual, derived from the filename, never persisted) →
 * `serializeDocument()` so an unchanged document keeps its original bytes.
 */
import type { FieldDescriptor } from "../fields/types"
import { mergeUntouched } from "../fields/validate"
import type { JsonValue } from "../safety/untrusted-json"
import type { JsonDocument } from "./document"
import { serializeDocument } from "./document"

export interface ComposeEntryDocumentInput {
  readonly fields: readonly FieldDescriptor[]
  /** Modeled value (`parseEntry`/`validateEntryForSave` output). */
  readonly value: Readonly<Record<string, unknown>>
  /** Unmodeled keys, JSON-Pointer keyed (`parseEntry().untouched`). */
  readonly untouched: Readonly<Record<string, JsonValue>>
  /** The document the form was loaded from (`parseJsonDocument(baseRaw)`). */
  readonly document: JsonDocument
}

export interface ComposedEntryDocument {
  readonly raw: string
  readonly value: JsonValue
}

export function composeEntryDocument(input: ComposeEntryDocumentInput): ComposedEntryDocument {
  const merged = mergeUntouched(input.value, input.untouched)
  stripVirtualFields(input.fields, merged)
  return {
    raw: serializeDocument(input.document, merged as JsonValue),
    value: merged as JsonValue,
  }
}

/**
 * Removes virtual (`slug`) fields in place from our own clone. Recurses into
 * object fields and list-of-object items; scalar lists and dividers are inert.
 * Mutation is safe: `mergeUntouched` returns a fresh deep clone.
 */
function stripVirtualFields(
  fields: readonly FieldDescriptor[],
  value: Record<string, unknown>,
): void {
  for (const field of fields) {
    if (field.type === "divider") continue
    if (field.type === "slug") {
      delete value[field.name]
      continue
    }
    if (!Object.hasOwn(value, field.name)) continue
    if (field.type === "object") {
      const child = value[field.name]
      if (isRecord(child)) stripVirtualFields(field.fields, child)
      continue
    }
    if (field.type === "list" && field.itemMode === "object") {
      const child = value[field.name]
      if (!Array.isArray(child)) continue
      for (const item of child) {
        if (isRecord(item)) stripVirtualFields(field.fields, item)
      }
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
