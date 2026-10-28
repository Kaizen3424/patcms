/**
 * Deploy-status types — ADR-0008 P2.8 appendix.
 *
 * The core module is pure and test-driven: all timing/randomness enters through
 * injected seams, and the only I/O is the three read functions supplied by the
 * caller. No React, no globals, no `Date.now()` or `Math.random()`.
 */

import type { CheckRunsRead, CommitStatusesRead } from "../backend/types"

/** Terminal + in-flight states a founder-visible status can carry. */
export type DeployStatusKind = "awaiting" | "building" | "live" | "failed" | "unavailable"

/** Why an `unavailable` (or stale) snapshot stopped short of a verdict. */
export type DeployStatusCause = "grace" | "error" | "incomplete" | "unsupported" | "watch-timeout"

export interface DeployStatusSnapshot {
  /** The exact commit this watcher is about (per-entry chip key). */
  readonly sha: string
  readonly kind: DeployStatusKind
  /** Which truth source produced a decisive result; `none` while awaiting. */
  readonly source: "checks" | "statuses" | "none"
  /** Head advanced while watching; polling stopped (INV-D03). */
  readonly supersededBy?: string
  /** Failing run/status link, https-only (ADR-0006). */
  readonly detailsUrl?: string
  /** Names of failing runs for cause hints (never raw dashboards). */
  readonly failureNames?: readonly string[]
  readonly cause?: DeployStatusCause
  /** Polling stopped at `maxWatchMs` while still building/awaiting. */
  readonly stale?: boolean
}

export interface StatusTiming {
  readonly fastPollMs: number
  readonly slowPollMs: number
  readonly fastWindowMs: number
  readonly graceMs: number
  readonly maxWatchMs: number
  readonly jitterRatio: number
}

/** 5 s → 10 s, 120 s grace, 10 min ceiling, ±20% jitter (ADR-0008 P2.8). */
export const DEFAULT_STATUS_TIMING: StatusTiming = Object.freeze({
  fastPollMs: 5_000,
  slowPollMs: 10_000,
  fastWindowMs: 60_000,
  graceMs: 120_000,
  maxWatchMs: 600_000,
  jitterRatio: 0.2,
})

export interface StatusReads {
  /** Current branch head (supersede truth). */
  readHead(): Promise<string>
  readCheckRuns(sha: string): Promise<CheckRunsRead>
  readCommitStatuses(sha: string): Promise<CommitStatusesRead>
}

export interface StatusWatcherOptions {
  readonly sha: string
  readonly reads: StatusReads
  /** Exact third-party contexts; empty means statuses fallback is off. */
  readonly contexts?: readonly string[]
  readonly timing?: Partial<StatusTiming>
  readonly now: () => number
  readonly schedulePoll: (delayMs: number, task: () => void) => () => void
  readonly random: () => number
  readonly onChange?: (snapshot: DeployStatusSnapshot) => void
}

export interface StatusWatcher {
  start(): void
  stop(): void
  getSnapshot(): DeployStatusSnapshot
}
