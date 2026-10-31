/**
 * Media budget math — ADR-0007 §6.
 *
 * Computes repository media economy metrics from recursive git tree entries
 * in O(N) time with zero network requests.
 *
 * Thresholds (ADR-0007 §6):
 *  - Repository media total >= 800MB (838,860,800 bytes): warning surfaced.
 *  - Repository media count >= 2,500 files: warning surfaced.
 *  - Single-file upload > 90MiB (94,371,840 bytes): client hard rejection.
 */

import type { TreeEntryTuple } from "../backend/types"
import type { MediaBudget, MediaFolders } from "./types"

export const WARNING_THRESHOLD_BYTES = 800 * 1024 * 1024 // 838,860,800 bytes (~800MB)
export const WARNING_THRESHOLD_COUNT = 2_500
export const CLIENT_BLOCK_BYTES = 90 * 1024 * 1024 // 94,371,840 bytes (90MiB)

/**
 * Calculates total media bytes and file counts from recursive tree entries.
 * Evaluates entries against configured repository media folders.
 */
export function calculateMediaBudget(
  treeEntries: readonly TreeEntryTuple[],
  media: MediaFolders | readonly MediaFolders[],
): MediaBudget {
  const folders = Array.isArray(media) ? media : [media]
  const prefixes = folders.map((item) =>
    item.folder.endsWith("/") ? item.folder : `${item.folder}/`,
  )

  let totalBytes = 0
  let count = 0

  for (const entry of treeEntries) {
    if (entry.type !== "blob") continue
    const matchesMedia = prefixes.some(
      (prefix) => entry.path === prefix.slice(0, -1) || entry.path.startsWith(prefix),
    )
    if (matchesMedia) {
      count += 1
      totalBytes += entry.size ?? 0
    }
  }

  const sizeWarn = totalBytes >= WARNING_THRESHOLD_BYTES
  const countWarn = count >= WARNING_THRESHOLD_COUNT
  const warning = sizeWarn || countWarn
  const warningReason =
    sizeWarn && countWarn ? "both" : sizeWarn ? "size" : countWarn ? "count" : undefined

  return {
    totalBytes,
    count,
    warning,
    ...(warningReason !== undefined ? { warningReason } : {}),
    warningThresholdBytes: WARNING_THRESHOLD_BYTES,
    warningThresholdCount: WARNING_THRESHOLD_COUNT,
  }
}

/**
 * Asserts whether a single file exceeds the 90MiB client-side upload hard block.
 */
export function isUploadSizeBlocked(byteLength: number): boolean {
  return byteLength > CLIENT_BLOCK_BYTES
}
