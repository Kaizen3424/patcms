/**
 * Save pipeline vocabulary — ADR-0004 (one transition table, never scattered
 * booleans). The state machine + drafts + lease land in P2.5. C.1 mechanics:
 * save driver, skip-token law, rate policy, zero-diff gate. C.2 mechanics:
 * conflict invariant engine (file-level) + `rebase()` (field-level merge).
 */

/** Exhaustive save phases (ADR-0004 §state machine). */
export const SAVE_PHASE_ORDER = [
  "editing",
  "dirty",
  "queued",
  "committing",
  "published",
  "conflict",
  "failed",
  "paused",
] as const

export type SavePhase = (typeof SAVE_PHASE_ORDER)[number]

export type { CommitMessageVerdict } from "./commit-message"
export { composeCommitMessage, containsSkipToken } from "./commit-message"
export { fieldEquals } from "./field-equals"
export type { FieldPath, FieldPathSegment } from "./field-paths"
export {
  commonAncestorFieldPath,
  computeDirtyPaths,
  diffPaths,
  equalsFieldPath,
  fieldPathKey,
  isAncestorFieldPath,
  readAtFieldPath,
  relatedFieldPaths,
} from "./field-paths"
export type {
  ConflictEngineInput,
  ConflictEngineResult,
  FileConflictVerdict,
  OurWrite,
} from "./invariant-engine"
export { resolveConflictPaths } from "./invariant-engine"
export type {
  ConcurrencyLimiter,
  RateDescriptor,
} from "./rate-policy"
export {
  createConcurrencyLimiter,
  createRateResume,
  describeRatePause,
  parseRateWindowReset,
  parseRetryAfter,
} from "./rate-policy"
export type {
  RebaseInput,
  RebaseIssue,
  RebaseIssueCode,
  RebaseResult,
  RebaseSuccess,
} from "./rebase"
export { rebase } from "./rebase"
export type { SaveConflictDetails, SaveDriverInput, SaveVerdict } from "./save-driver"
export { runSave } from "./save-driver"
export { isZeroDiffChangeSet } from "./zero-diff"
