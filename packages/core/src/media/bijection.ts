/**
 * Media path bijection — ADR-0007 §5 (INV-M01).
 *
 * Implements the bijective mapping between web-facing public media paths
 * (e.g. `/images/products/ring.jpg`) and repository-relative storage paths
 * (e.g. `public/images/products/ring.jpg`), honoring root media configurations
 * and per-collection overrides.
 *
 * All conversions run through safePath() on both read and write: traversals,
 * backslashes, encoded separators, and prefix escapes are strictly rejected.
 */

import type { AdminConfig } from "../config/types"
import type { SafePathResult } from "../safety/safe-path"
import { safePath } from "../safety/safe-path"
import type { MediaFolders } from "./types"

/**
 * Resolves the active MediaFolders configuration for an operation.
 * Returns collection-specific media if configured; falls back to root config.media.
 */
export function resolveMediaFolders(config: AdminConfig, collectionName?: string): MediaFolders {
  if (collectionName !== undefined) {
    const match = config.collections.find(
      (collection) => collection.kind !== "divider" && collection.name === collectionName,
    )
    if (match !== undefined && match.kind !== "divider" && match.media !== undefined) {
      return match.media
    }
  }
  return config.media
}

/**
 * Converts a web-facing public media path into a repository-relative file path.
 *
 * Example:
 *   publicPath: "/images/products/ring.jpg"
 *   media: { folder: "public/images", publicFolder: "/images" }
 *   -> "public/images/products/ring.jpg"
 */
export function publicPathToRepoPath(publicPath: string, media: MediaFolders): SafePathResult {
  const checked = safePath(publicPath, { absolute: true, prefix: media.publicFolder })
  if (!checked.ok) return checked

  const prefix = media.publicFolder.endsWith("/") ? media.publicFolder : `${media.publicFolder}/`

  let subpath = ""
  if (checked.value === media.publicFolder) {
    subpath = ""
  } else if (checked.value.startsWith(prefix)) {
    subpath = checked.value.slice(prefix.length)
  } else {
    return {
      ok: false,
      code: "PREFIX_MISMATCH",
      detail: `path ${checked.value} does not sit under publicFolder ${media.publicFolder}`,
    }
  }

  const repoFolder = media.folder.endsWith("/") ? media.folder.slice(0, -1) : media.folder

  const repoPath = subpath.length > 0 ? `${repoFolder}/${subpath}` : repoFolder
  return safePath(repoPath, { prefix: media.folder })
}

/**
 * Converts a repository-relative media path into a web-facing public URL path.
 *
 * Example:
 *   repoPath: "public/images/products/ring.jpg"
 *   media: { folder: "public/images", publicFolder: "/images" }
 *   -> "/images/products/ring.jpg"
 */
export function repoPathToPublicPath(repoPath: string, media: MediaFolders): SafePathResult {
  const checked = safePath(repoPath, { prefix: media.folder })
  if (!checked.ok) return checked

  const prefix = media.folder.endsWith("/") ? media.folder : `${media.folder}/`

  let subpath = ""
  if (checked.value === media.folder) {
    subpath = ""
  } else if (checked.value.startsWith(prefix)) {
    subpath = checked.value.slice(prefix.length)
  } else {
    return {
      ok: false,
      code: "PREFIX_MISMATCH",
      detail: `path ${checked.value} does not sit under folder ${media.folder}`,
    }
  }

  const publicFolder = media.publicFolder.endsWith("/")
    ? media.publicFolder.slice(0, -1)
    : media.publicFolder

  const publicPath = subpath.length > 0 ? `${publicFolder}/${subpath}` : publicFolder
  return safePath(publicPath, { absolute: true, prefix: media.publicFolder })
}
