/**
 * Pure deploy-status classifiers — ADR-0008 P2.8 conclusion matrix.
 *
 * Check runs are primary; commit statuses are consulted only through configured
 * `deploy.contexts` and only when the check-run set has no decisive result.
 * `neutral`/`skipped` never count as success (a skipped-only set is unavailable,
 * never Live). Failure outranks a still-running sibling.
 */

import type {
  CheckRunConclusion,
  CheckRunSummary,
  CheckRunsRead,
  CommitStatusesRead,
  CommitStatusSummary,
} from "../backend/types"
import type { DeployStatusCause, DeployStatusKind } from "./types"

export interface StatusDecision {
  readonly verdict: DeployStatusKind
  readonly source: "checks" | "statuses" | "none"
  readonly detailsUrl?: string
  readonly failureNames?: readonly string[]
  readonly cause?: DeployStatusCause
}

const FAILURE_CONCLUSIONS: ReadonlySet<CheckRunConclusion> = new Set([
  "failure",
  "timed_out",
  "cancelled",
  "action_required",
  "stale",
])

/** Check-run matrix; `awaiting` means "no decisive result yet" (grace subject). */
export function classifyCheckRuns(read: CheckRunsRead): StatusDecision {
  if (read.kind === "unsupported") {
    return { verdict: "unavailable", source: "checks", cause: "unsupported" }
  }
  const failures = read.runs.filter(
    (run) => run.conclusion !== null && FAILURE_CONCLUSIONS.has(run.conclusion),
  )
  if (failures.length > 0) return checkFailureDecision(failures)
  if (read.totalCount > read.runs.length) {
    // Partial truth is never Live; a page we cannot fully see is unavailable.
    return { verdict: "unavailable", source: "checks", cause: "incomplete" }
  }
  if (read.runs.some((run) => run.status !== "completed")) {
    return { verdict: "building", source: "checks" }
  }
  if (read.runs.some((run) => run.conclusion === "success")) {
    return { verdict: "live", source: "checks" }
  }
  // No runs, or only neutral/skipped: no decisive result.
  return { verdict: "awaiting", source: "checks" }
}

/**
 * Commit-statuses fallback. `contexts` is the exact allow-list; absent/empty
 * disables the source entirely (never polled by the watcher).
 */
export function classifyCommitStatuses(
  read: CommitStatusesRead,
  contexts: readonly string[],
): StatusDecision {
  if (read.kind === "unsupported" || contexts.length === 0) {
    return { verdict: "awaiting", source: "statuses" }
  }
  const wanted = new Set(contexts)
  const statuses = read.statuses.filter((status) => wanted.has(status.context))
  const failures = statuses.filter(
    (status) => status.state === "error" || status.state === "failure",
  )
  if (failures.length > 0) return statusFailureDecision(failures)
  if (statuses.some((status) => status.state === "pending")) {
    return { verdict: "building", source: "statuses" }
  }
  if (statuses.some((status) => status.state === "success")) {
    return { verdict: "live", source: "statuses" }
  }
  return { verdict: "awaiting", source: "statuses" }
}

/** Primary/fallback composition: a decisive check state always wins. */
export function decideStatus(
  checks: CheckRunsRead,
  statuses: CommitStatusesRead,
  contexts: readonly string[],
): StatusDecision {
  const primary = classifyCheckRuns(checks)
  if (primary.verdict !== "awaiting") return primary
  if (contexts.length === 0) return primary
  const fallback = classifyCommitStatuses(statuses, contexts)
  return fallback.verdict === "awaiting" ? primary : fallback
}

function checkFailureDecision(failures: readonly CheckRunSummary[]): StatusDecision {
  const detailsUrl = failures.find((run) => run.detailsUrl !== undefined)?.detailsUrl
  return failureDecision(
    "checks",
    detailsUrl,
    failures.map((run) => run.name),
  )
}

function statusFailureDecision(failures: readonly CommitStatusSummary[]): StatusDecision {
  const detailsUrl = failures.find((status) => status.targetUrl !== undefined)?.targetUrl
  return failureDecision("statuses", detailsUrl)
}

function failureDecision(
  source: "checks" | "statuses",
  detailsUrl: string | undefined,
  failureNames?: readonly string[],
): StatusDecision {
  return {
    verdict: "failed",
    source,
    ...(detailsUrl === undefined ? {} : { detailsUrl }),
    ...(failureNames === undefined ? {} : { failureNames }),
  }
}
