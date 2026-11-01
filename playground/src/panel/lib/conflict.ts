/**
 * Conflict resolution — the host side of the conflict-as-a-value contract.
 *
 * `entries.save` returns `{ status: "conflict", current, local }`; this module
 * pairs the two versions field by field so the UI can render both and let the
 * user choose. The merge itself is a plain host-side composition — the default
 * client never merges, and `rebase()` in `patcms/advanced` stays untouched.
 */

import type { Entry, EntryValue, FieldDescriptor, JsonValue } from "patcms"
import { canonicalJson } from "patcms"
import { formatValue } from "./value"

export type FieldPick = "mine" | "current"

export interface ConflictFieldRow {
  readonly name: string
  readonly label: string
  readonly current: string
  readonly mine: string
  /** True when both versions carry the same value — no decision needed. */
  readonly equal: boolean
}

export function pairConflictFields(
  current: EntryValue,
  local: EntryValue,
  fields: readonly FieldDescriptor[],
): ConflictFieldRow[] {
  const rows: ConflictFieldRow[] = []
  for (const field of fields) {
    if (field.type === "divider" || field.type === "hidden" || field.type === "slug") continue
    const mine = local[field.name]
    const theirs = current[field.name]
    rows.push({
      name: field.name,
      label: field.label,
      current: formatValue(theirs),
      mine: formatValue(mine),
      // Values come from parsed repository JSON, so the cast to JsonValue is
      // shape-true; canonicalJson is only used for equality and display here.
      equal:
        canonicalJson((theirs ?? null) as JsonValue) === canonicalJson((mine ?? null) as JsonValue),
    })
  }
  return rows
}

/** Composes the value the user chose, field by field, on top of `current`. */
export function mergePickedFields(
  current: Pick<Entry, "value">,
  local: EntryValue,
  fields: readonly FieldDescriptor[],
  picks: Readonly<Record<string, FieldPick>>,
): EntryValue {
  const merged: Record<string, unknown> = { ...current.value }
  for (const field of fields) {
    if (field.type === "divider") continue
    if (picks[field.name] === "mine" && field.name in local) {
      merged[field.name] = local[field.name]
    }
  }
  return merged
}

/** Default picks: keep whoever differs from the shared base; ties keep current. */
export function defaultPicks(rows: readonly ConflictFieldRow[]): Record<string, FieldPick> {
  const picks: Record<string, FieldPick> = {}
  for (const row of rows) picks[row.name] = row.equal ? "current" : "mine"
  return picks
}
