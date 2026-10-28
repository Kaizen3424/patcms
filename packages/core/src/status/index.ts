/** Deploy-status module barrel — ADR-0008 P2.8. */

export type { StatusDecision } from "./classify"
export { classifyCheckRuns, classifyCommitStatuses, decideStatus } from "./classify"
export { createStatusReads } from "./reads"
export type {
  DeployStatusCause,
  DeployStatusKind,
  DeployStatusSnapshot,
  StatusReads,
  StatusTiming,
  StatusWatcher,
  StatusWatcherOptions,
} from "./types"
export { DEFAULT_STATUS_TIMING } from "./types"
export { createStatusWatcher } from "./watcher"
