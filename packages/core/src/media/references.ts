/**
 * Referential integrity engine (`findReferences`) — ADR-0007 §5 (INV-M03).
 *
 * Recursively scans entry data structures (folder collections and single-file
 * documents) across the repository to locate all references to a media path
 * or relation slug.
 *
 * Pure function in `@mycms/core` with zero DOM dependencies.
 */

import type { AdminConfig } from "../config/types"
import { publicPathToRepoPath, repoPathToPublicPath } from "./bijection"
import type { ReferenceLocation, ReferenceQuery } from "./types"

export interface SearchableEntry {
  readonly collection: string
  readonly slug: string
  readonly title?: string
  readonly value: unknown
}

/**
 * Searches across entries for references to a given media asset path or relation.
 */
export function findReferences(
  query: ReferenceQuery,
  entries: readonly SearchableEntry[],
  config: AdminConfig,
): readonly ReferenceLocation[] {
  if (query.targetPath === undefined && query.targetRelation === undefined) {
    return []
  }

  const normalizedPaths = new Set<string>()
  if (query.targetPath !== undefined && query.targetPath.trim().length > 0) {
    const rawPath = query.targetPath.trim()
    normalizedPaths.add(rawPath)

    // Normalize public vs repo path representations across all media configurations
    const allMediaConfigs = [
      config.media,
      ...config.collections
        .filter((c) => c.kind !== "divider" && c.media !== undefined)
        .map((c) => (c as { media: typeof config.media }).media),
    ]

    for (const media of allMediaConfigs) {
      const asRepo = publicPathToRepoPath(rawPath, media)
      if (asRepo.ok) normalizedPaths.add(asRepo.value)

      const asPublic = repoPathToPublicPath(rawPath, media)
      if (asPublic.ok) normalizedPaths.add(asPublic.value)
    }
  }

  const results: ReferenceLocation[] = []

  for (const entry of entries) {
    if (typeof entry.value !== "object" || entry.value === null) continue

    walkValue(entry.value, "", undefined, (fieldPath, value, parentObj) => {
      // 1. Media path matching
      if (typeof value === "string" && normalizedPaths.has(value)) {
        let altText: string | undefined
        if (parentObj !== undefined && typeof parentObj === "object" && parentObj !== null) {
          const p = parentObj as Record<string, unknown>
          if (typeof p.alt === "string" && p.alt.length > 0) {
            altText = p.alt
          } else if (typeof p.imageAlt === "string" && p.imageAlt.length > 0) {
            altText = p.imageAlt
          }
        }

        results.push({
          collection: entry.collection,
          slug: entry.slug,
          fieldPath,
          ...(entry.title !== undefined ? { title: entry.title } : {}),
          ...(altText !== undefined ? { altText } : {}),
        })
        return
      }

      // 2. Relation slug matching
      if (query.targetRelation !== undefined && typeof value === "string") {
        if (value === query.targetRelation.slug) {
          // Verify that this field matches the collection or relation target
          results.push({
            collection: entry.collection,
            slug: entry.slug,
            fieldPath,
            ...(entry.title !== undefined ? { title: entry.title } : {}),
          })
        }
      }
    })
  }

  return results
}

function walkValue(
  value: unknown,
  currentPath: string,
  parentObj: unknown,
  visitor: (fieldPath: string, value: unknown, parentObj: unknown) => void,
): void {
  visitor(currentPath, value, parentObj)

  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const childPath = currentPath.length === 0 ? String(index) : `${currentPath}.${index}`
      walkValue(value[index], childPath, parentObj, visitor)
    }
    return
  }

  if (typeof value === "object" && value !== null) {
    for (const [key, child] of Object.entries(value)) {
      const childPath = currentPath.length === 0 ? key : `${currentPath}.${key}`
      walkValue(child, childPath, value, visitor)
    }
  }
}
