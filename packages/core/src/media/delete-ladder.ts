/**
 * Delete ladder and tombstone storage — ADR-0007 §5 (INV-M03).
 *
 * Implements the referential integrity guard for media deletes and the
 * soft-delete tombstone lifecycle:
 *  - Rung 1: Entry Remove (clears field value, leaves media file untouched).
 *  - Rung 2: Media Library Delete (blocked if findReferences returns >= 1 usage).
 *  - Rung 3: Soft-delete move to _trash/ in a single atomic commit.
 *  - Restore: Moves from _trash/ back to original location with collision guard.
 */

import type { CommitChangeSet, TreeEntryTuple } from "../backend/types"
import type { AdminConfig } from "../config/types"
import { repoPathToPublicPath, resolveMediaFolders } from "./bijection"
import { findReferences, type SearchableEntry } from "./references"
import type { ReferenceLocation } from "./types"

export const TRASH_PREFIX = "_trash/"

export interface DeleteCheckResult {
  readonly allowed: boolean
  readonly references: readonly ReferenceLocation[]
}

/**
 * Checks whether a repository media asset can be deleted.
 * Deletion is strictly blocked if any active entry references this asset.
 */
export function canDeleteMedia(
  repoPath: string,
  entries: readonly SearchableEntry[],
  config: AdminConfig,
): DeleteCheckResult {
  const rootMedia = resolveMediaFolders(config)
  const publicPathResult = repoPathToPublicPath(repoPath, rootMedia)
  const targetPath = publicPathResult.ok ? publicPathResult.value : `/${repoPath}`

  const references = findReferences({ targetPath }, entries, config)
  return {
    allowed: references.length === 0,
    references,
  }
}

/**
 * Computes the tombstone destination path under _trash/.
 */
export function trashMediaPath(repoPath: string): string {
  const clean = repoPath.replace(/^\/+/, "")
  return `${TRASH_PREFIX}${clean}`
}

/**
 * Computes the restored repository path from a tombstone path.
 */
export function restoreMediaPath(trashPath: string): string {
  const clean = trashPath.replace(/^\/+/, "")
  if (clean.startsWith(TRASH_PREFIX)) {
    return clean.slice(TRASH_PREFIX.length)
  }
  return clean
}

/**
 * Creates single-commit change set to move a media asset to _trash/.
 */
export function createTrashChanges(repoPath: string, bytes: Uint8Array): CommitChangeSet {
  const destination = trashMediaPath(repoPath)
  return {
    adds: [{ path: destination, bytes }],
    deletes: [repoPath],
  }
}

export type RestoreChangesResult =
  | { readonly ok: true; readonly changes: CommitChangeSet; readonly destination: string }
  | { readonly ok: false; readonly reason: "collision"; readonly destination: string }

/**
 * Creates single-commit change set to restore a media asset from _trash/,
 * verifying that no active file occupies the destination path.
 */
export function createRestoreChanges(
  trashPath: string,
  bytes: Uint8Array,
  currentTreeEntries: readonly TreeEntryTuple[],
): RestoreChangesResult {
  const destination = restoreMediaPath(trashPath)
  const collides = currentTreeEntries.some((e) => e.path === destination)
  if (collides) {
    return { ok: false, reason: "collision", destination }
  }
  return {
    ok: true,
    destination,
    changes: {
      adds: [{ path: destination, bytes }],
      deletes: [trashPath],
    },
  }
}
