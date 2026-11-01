/**
 * New-entry default folding — ported from the reference admin
 * (`editor/template-clone.ts`) so a host building its own panel does not have
 * to reimplement it.
 *
 * Law: `parseEntry` NEVER injects defaults (they are metadata); only a brand
 * new entry materialises them. A list that is `required`, or that already has
 * items, is padded to its `min` with renderable starter items; an optional list
 * with no value stays absent so optional validation still passes.
 */
import type { FieldDescriptor, ListFieldDescriptor } from "./types"

/** Populates defaults leaf-first into `target` (mutated in place). */
export function foldFieldDefaults(
  fields: readonly FieldDescriptor[],
  target: Record<string, unknown>,
): void {
  for (const field of fields) {
    if (field.type === "divider" || field.type === "slug") continue

    if (field.type === "list") {
      const listField = field as ListFieldDescriptor
      const existing = target[field.name]
      if (!field.required && existing === undefined) continue

      const items = Array.isArray(existing) ? existing : []
      const min = listField.min ?? (field.required ? 1 : 0)
      while (items.length < min) items.push(createDefaultListItem(listField))
      target[field.name] = items
      continue
    }

    if (field.type === "object") {
      const existing = target[field.name]
      const child =
        typeof existing === "object" && existing !== null && !Array.isArray(existing)
          ? (existing as Record<string, unknown>)
          : {}
      foldFieldDefaults(field.fields, child)
      target[field.name] = child
      continue
    }

    if (target[field.name] === undefined && "defaultValue" in field) {
      const defaultValue = (field as { defaultValue?: unknown }).defaultValue
      if (defaultValue !== undefined) target[field.name] = defaultValue
    }
  }
}

/** Creates the initial value for a blank entry in a folder collection. */
export function createBlankEntryValue(fields: readonly FieldDescriptor[]): Record<string, unknown> {
  const value: Record<string, unknown> = {}
  foldFieldDefaults(fields, value)
  return value
}

function createDefaultListItem(listField: ListFieldDescriptor): unknown {
  if (listField.itemMode === "scalar") {
    const child = listField.fields[0]
    return child !== undefined && "defaultValue" in child
      ? (child as { defaultValue?: unknown }).defaultValue
      : ""
  }

  const item: Record<string, unknown> = {}
  for (const child of listField.fields) {
    if (child.type === "divider" || child.type === "slug") continue
    if ("defaultValue" in child && child.defaultValue !== undefined) {
      item[child.name] = child.defaultValue
    } else if (child.type === "list") {
      const childMin = child.min ?? (child.required ? 1 : 0)
      if (child.required && childMin > 0) {
        const subItems: unknown[] = []
        for (let index = 0; index < childMin; index += 1) {
          subItems.push(createDefaultListItem(child))
        }
        item[child.name] = subItems
      } else {
        item[child.name] = []
      }
    } else if (child.type === "object") {
      const nested: Record<string, unknown> = {}
      foldFieldDefaults(child.fields, nested)
      item[child.name] = nested
    } else if (child.type === "number") {
      item[child.name] = 0
    } else if (child.type === "boolean") {
      item[child.name] = false
    } else {
      item[child.name] = ""
    }
  }
  return item
}
