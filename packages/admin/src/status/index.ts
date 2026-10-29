/**
 * Deploy-status admin surface (ADR-0008 P2.8 appendix): session publish
 * journal, sha-keyed refcounted registry, React hooks/components, and the one
 * copy deck. Hosts import `StatusProvider` only through the mount runtime.
 */

export type { StatusChipProps } from "./chip"
export { StatusBanner, StatusChip } from "./chip"
export {
  STATUS_CAUSE_COPY,
  STATUS_COPY,
  STATUS_DISABLED_COPY,
  STATUS_SUPERSEDED_COPY,
} from "./copy"
export type { StatusProviderDeps, UseStatusResult } from "./provider"
export { StatusProvider, useEntryStatus, usePublishedSha, useSiteStatus } from "./provider"
export type { PublishStore } from "./publish-store"
export { createPublishStore } from "./publish-store"
export type { StatusLease, StatusRegistry, StatusRegistryOptions } from "./registry"
export { createStatusRegistry } from "./registry"
