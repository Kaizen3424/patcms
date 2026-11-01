/**
 * `patcms/advanced` — the low-level surface.
 *
 * Use this when `createCMS()` is not enough: drive the save driver and conflict
 * engine directly, swap the backend, or reuse the git object/SHA helpers.
 *
 * Everything here is Node-safe. Browser-only adapters live in `patcms/web`.
 */

export * from "./auth"
export * from "./backend/errors"
export * from "./backend/git-sha"
export * from "./backend/github/probe"
export * from "./backend/guards"
export * from "./backend/types"
export * from "./backend/write-errors"
export * from "./backends/github"
export * from "./cache"
export * from "./composition"
export * from "./config"
export * from "./drafts"
export * from "./drafts/memory-store"
export * from "./fields"
export * from "./fields/defaults"
export * from "./media"
export * from "./pipeline"
export * from "./safety"
export * from "./serialization"
export * from "./status"
