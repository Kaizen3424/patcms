/**
 * Save pipeline vocabulary — ADR-0004 (one transition table, never scattered
 * booleans). P2.5: state machine, one-flight queue, save coordinator (drafts +
 * boot replay), lease contract. C.1 mechanics: save driver, skip-token law,
 * rate policy, zero-diff gate. C.2 mechanics: conflict invariant engine
 * (file-level) + `rebase()` (field-level merge).
 */

export type { AdjudicateDraftInput, DraftAdjudication } from "./boot-replay"
export { adjudicateDraft } from "./boot-replay"
export type { CommitMessageVerdict } from "./commit-message"
export { composeCommitMessage, containsSkipToken } from "./commit-message"
export { fieldEquals } from "./field-equals"
export type {
  FieldPath,
  FieldPathSegment,
  FieldPathWriteIssue,
  FieldPathWriteResult,
} from "./field-paths"
export {
  commonAncestorFieldPath,
  computeDirtyPaths,
  deleteAtFieldPath,
  diffPaths,
  equalsFieldPath,
  fieldPathKey,
  isAncestorFieldPath,
  readAtFieldPath,
  relatedFieldPaths,
  writeAtFieldPath,
} from "./field-paths"
export type {
  ConflictEngineInput,
  ConflictEngineResult,
  FileConflictVerdict,
  OurWrite,
} from "./invariant-engine"
export { resolveConflictPaths } from "./invariant-engine"
export type { OneFlightQueue } from "./one-flight"
export { createOneFlightQueue } from "./one-flight"
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
export type {
  CoordinatorSnapshot,
  SaveCoordinator,
  SaveCoordinatorOptions,
  SaveRequest,
} from "./save-controller"
export { createSaveCoordinator, SaveInFlightError } from "./save-controller"
export type {
  ConflictMergePreview,
  SaveConflictDetails,
  SaveDriverInput,
  SaveReconciliation,
  SaveVerdict,
} from "./save-driver"
export { runSave } from "./save-driver"
export type {
  LeaseCarrier,
  LeaseMessage,
  SaveLease,
  SaveLeaseOptions,
} from "./save-lease"
export {
  createSaveLease,
  DEFAULT_LEASE_HEARTBEAT_MS,
  DEFAULT_LEASE_TTL_MS,
} from "./save-lease"
export type {
  SaveMachineEvent,
  SaveMachineState,
  SavePauseReason,
  SavePhase,
} from "./save-machine"
export { isRetryableWriteCode, SAVE_PHASE_ORDER, transitionSaveState } from "./save-machine"
export { isZeroDiffChangeSet } from "./zero-diff"
