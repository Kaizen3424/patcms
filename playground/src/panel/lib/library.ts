/**
 * Library helpers: summary rendering, sorting, and filtering for entry lists.
 * All pure — the screen just wires them to `entries.list()`.
 */

import type { EntrySummary, FolderCollectionDescriptor } from "patcms"
import { compareValues, mustacheLite } from "patcms"

/** The summary template when present, else the identifier field, else the slug. */
export function entryTitle(entry: EntrySummary, collection: FolderCollectionDescriptor): string {
  if (collection.summary !== undefined) {
    const rendered = mustacheLite(collection.summary, entry.value).trim()
    if (rendered.length > 0) return rendered
  }
  const identifier = collection.identifierField
  if (identifier !== undefined) {
    const value = entry.value[identifier]
    if (typeof value === "string" && value.length > 0) return value
  }
  return entry.slug
}

export function sortSummaries(
  summaries: readonly EntrySummary[],
  sortField: string | undefined,
  direction: "asc" | "desc",
): EntrySummary[] {
  const sorted = [...summaries].sort((left, right) => {
    if (sortField === undefined) {
      return compareStrings(entrySlug(left), entrySlug(right))
    }
    return compareValues(left.value[sortField], right.value[sortField])
  })
  return direction === "asc" ? sorted : sorted.reverse()
}

function entrySlug(entry: EntrySummary): string {
  return entry.slug
}

function compareStrings(left: string, right: string): number {
  return left.localeCompare(right)
}

export function filterSummaries(
  summaries: readonly EntrySummary[],
  query: string,
  collection: FolderCollectionDescriptor,
): EntrySummary[] {
  const needle = query.trim().toLowerCase()
  if (needle.length === 0) return [...summaries]
  return summaries.filter((entry) => {
    if (entry.slug.toLowerCase().includes(needle)) return true
    return entryTitle(entry, collection).toLowerCase().includes(needle)
  })
}

/** "1.2 MB" style formatting for media rows. */
export function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}
