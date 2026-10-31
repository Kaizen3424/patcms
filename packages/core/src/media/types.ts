/**
 * Media system vocabulary and types — ADR-0007.
 *
 * Defines the contracts for path bijection, repository budget math, staged tiles,
 * and referential integrity queries. Zero DOM dependencies; Node-safe.
 */

import type { MediaFolders } from "../config/types"

export type { MediaFolders }

export interface MediaBudget {
  /** Total bytes of all blob entries situated under configured media folders. */
  readonly totalBytes: number
  /** Total count of blob entries situated under configured media folders. */
  readonly count: number
  /** True when totalBytes >= warningThresholdBytes or count >= warningThresholdCount. */
  readonly warning: boolean
  /** Specific cause for budget warning, if triggered. */
  readonly warningReason?: "size" | "count" | "both"
  /** 800MB warning threshold in bytes (838,860,800 bytes). */
  readonly warningThresholdBytes: number
  /** 2,500 image count warning threshold. */
  readonly warningThresholdCount: number
}

/** Staged media tile stored in DraftStore alongside entry drafts (ADR-0007 §1). */
export interface StagedMediaTileRecord {
  readonly tileId: string
  readonly repoPath: string
  readonly publicPath: string
  readonly originalFilename: string
  readonly sanitizedFilename: string
  readonly bytes: Uint8Array
  readonly mimeType: string
  readonly size: number
  readonly sha: string
  readonly status: "staged" | "uploading" | "failed" | "ready"
  readonly error?: string
}

/** Referential match found by the findReferences engine (ADR-0007 §5). */
export interface ReferenceLocation {
  readonly collection: string
  readonly slug: string
  readonly fieldPath: string // e.g. "images.0.image" or "featuredProducts.1"
  readonly title?: string
  readonly altText?: string // For companion alt-text prefill
}

export interface ReferenceQuery {
  readonly targetPath?: string // e.g. "/images/products/iris-no-1.jpg"
  readonly targetRelation?: { readonly collection: string; readonly slug: string }
}
