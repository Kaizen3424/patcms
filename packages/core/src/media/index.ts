/**
 * Media system — ADR-0007 (staged tiles, bijection, budget, referential integrity).
 */

export {
  publicPathToRepoPath,
  repoPathToPublicPath,
  resolveMediaFolders,
} from "./bijection"
export {
  CLIENT_BLOCK_BYTES,
  calculateMediaBudget,
  isUploadSizeBlocked,
  WARNING_THRESHOLD_BYTES,
  WARNING_THRESHOLD_COUNT,
} from "./budget"
export {
  canDeleteMedia,
  createRestoreChanges,
  createTrashChanges,
  type DeleteCheckResult,
  type RestoreChangesResult,
  restoreMediaPath,
  TRASH_PREFIX,
  trashMediaPath,
} from "./delete-ladder"
export type { SearchableEntry } from "./references"
export { findReferences } from "./references"
export type {
  MediaBudget,
  MediaFolders,
  ReferenceLocation,
  ReferenceQuery,
  StagedMediaTileRecord,
} from "./types"
