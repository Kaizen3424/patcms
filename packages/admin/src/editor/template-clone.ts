import type {
  FieldDescriptor,
  FolderCollectionDescriptor,
  ListFieldDescriptor,
} from "patcms/advanced"
import type { IndexedEntry } from "../runtime/entry-index"

/**
 * Clones an existing entry as a template for a new entry.
 *
 * Laws (P3.7 & ADR-0003 P3 Addendum):
 *  - Strips identity: title and slug are cleared.
 *  - Retains all structure: choice-tabs, specs, accordions, categories.
 *  - Shares media by reference: no asset duplication.
 *  - Leaf-first default fold: materializes defaults for any declared field missing from source.
 *  - Prefills required lists: ensures lists with `min >= 1` have valid starter items.
 */
export function cloneEntryAsTemplate(
  sourceEntry: IndexedEntry,
  collection: FolderCollectionDescriptor,
): Record<string, unknown> {
  const cloned = structuredClone(sourceEntry.value) as Record<string, unknown>

  // Identity strip
  delete cloned.title
  delete cloned.slug

  // Fold defaults and ensure min list items
  foldFieldDefaults(collection.fields, cloned)

  return cloned
}

/**
 * Creates initial form values for a blank entry in a collection.
 */
export function createNewBlankEntry(
  collection: FolderCollectionDescriptor,
): Record<string, unknown> {
  const value: Record<string, unknown> = {}
  foldFieldDefaults(collection.fields, value)
  return value
}

/**
 * Walks collection fields leaf-first to populate default values and ensure
 * required lists (min >= 1) are pre-populated with valid default items.
 */
export function foldFieldDefaults(
  fields: readonly FieldDescriptor[],
  target: Record<string, unknown>,
): void {
  for (const field of fields) {
    if (field.type === "divider" || field.type === "slug") continue

    if (field.type === "list") {
      const listDesc = field as ListFieldDescriptor
      const existing = target[field.name]
      // Only pad if it is a required list or if items are already present
      if (!field.required && existing === undefined) {
        continue
      }
      const items = Array.isArray(existing) ? existing : []
      const min = listDesc.min ?? (field.required ? 1 : 0)

      // If array is shorter than required min, pad with default items
      while (items.length < min) {
        items.push(createDefaultListItem(listDesc))
      }
      target[field.name] = items
      continue
    }

    if (field.type === "object") {
      const existing = target[field.name]
      const childObj =
        typeof existing === "object" && existing !== null && !Array.isArray(existing)
          ? (existing as Record<string, unknown>)
          : {}
      foldFieldDefaults(field.fields, childObj)
      target[field.name] = childObj
      continue
    }

    // Scalar fields
    if (
      "name" in field &&
      target[field.name] === undefined &&
      "defaultValue" in field &&
      field.defaultValue !== undefined
    ) {
      target[field.name] = field.defaultValue
    }
  }
}

function createDefaultListItem(listDesc: ListFieldDescriptor): unknown {
  if (listDesc.itemMode === "scalar") {
    const child = listDesc.fields[0]
    return child && "defaultValue" in child ? child.defaultValue : ""
  }
  const item: Record<string, unknown> = {}
  for (const child of listDesc.fields) {
    if (child.type === "divider" || child.type === "slug") continue
    if ("defaultValue" in child && child.defaultValue !== undefined) {
      item[child.name] = child.defaultValue
    } else if (child.type === "list") {
      const childMin = child.min ?? (child.required ? 1 : 0)
      if (child.required && childMin > 0) {
        const subItems: unknown[] = []
        for (let i = 0; i < childMin; i++) {
          subItems.push(createDefaultListItem(child))
        }
        item[child.name] = subItems
      } else {
        item[child.name] = []
      }
    } else if (child.type === "object") {
      const childObj: Record<string, unknown> = {}
      foldFieldDefaults(child.fields, childObj)
      item[child.name] = childObj
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

/**
 * Creates a synthetic `IndexedEntry` representing a new uncommitted entry.
 */
export function createSyntheticNewIndexedEntry(
  collection: FolderCollectionDescriptor,
  slug: string,
  initialValue: Record<string, unknown> = {},
): IndexedEntry {
  const ext =
    (collection.format as string) === "yaml" || (collection.format as string) === "yml"
      ? "yml"
      : "json"
  const folder = collection.folder.replace(/\/+$/, "")
  const path = `${folder}/${slug}.${ext}`

  return {
    collectionName: collection.name,
    collection,
    path,
    slug,
    title: typeof initialValue.title === "string" ? initialValue.title : "",
    fields: collection.fields,
    media: collection.media ?? { folder: "public/images", publicFolder: "/images" },
    raw: initialValue,
    value: initialValue,
    issues: [],
    untouched: {},
    rawText: JSON.stringify(initialValue, null, 2),
    blobSha: "",
  }
}
