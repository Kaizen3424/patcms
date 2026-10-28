/**
 * Deploy-status watcher — ADR-0008 P2.8 appendix.
 *
 * One watcher per commit sha. All timing enters through injected `now`,
 * `schedulePoll` and `random`; the module never touches a global timer.
 * Terminal states stop; read errors degrade to `unavailable` (never `failed`);
 * the configured grace turns "no decisive run yet" into `unavailable`.
 */

import type { CheckRunsRead } from "../backend/types"
import type { StatusDecision } from "./classify"
import { classifyCheckRuns, decideStatus } from "./classify"
import {
  DEFAULT_STATUS_TIMING,
  type DeployStatusCause,
  type DeployStatusSnapshot,
  type StatusTiming,
  type StatusWatcher,
  type StatusWatcherOptions,
} from "./types"

export function createStatusWatcher(options: StatusWatcherOptions): StatusWatcher {
  const timing: StatusTiming = { ...DEFAULT_STATUS_TIMING, ...options.timing }
  const contexts = options.contexts ?? []
  let snapshot: DeployStatusSnapshot = {
    sha: options.sha,
    kind: "awaiting",
    source: "none",
  }
  let started = false
  let stopped = false
  let startedAt = 0
  let cancelScheduled: (() => void) | undefined
  let generation = 0

  const elapsed = (): number => options.now() - startedAt

  const stop = (): void => {
    if (stopped) return
    stopped = true
    generation += 1
    if (cancelScheduled !== undefined) {
      cancelScheduled()
      cancelScheduled = undefined
    }
  }

  const emit = (next: DeployStatusSnapshot): void => {
    if (sameSnapshot(snapshot, next)) return
    snapshot = next
    options.onChange?.(next)
  }

  const finish = (next: DeployStatusSnapshot): void => {
    emit(next)
    stop()
  }

  const degrade = (cause: DeployStatusCause): void => {
    if (stopped) return
    finish({ sha: options.sha, kind: "unavailable", source: "none", cause })
  }

  /** Returns true when the watch reached a terminal state. */
  const applyDecision = (decision: StatusDecision): boolean => {
    if (decision.verdict === "failed") {
      finish({
        sha: options.sha,
        kind: "failed",
        source: decision.source,
        ...(decision.detailsUrl === undefined ? {} : { detailsUrl: decision.detailsUrl }),
        ...(decision.failureNames === undefined ? {} : { failureNames: decision.failureNames }),
      })
      return true
    }
    if (decision.verdict === "live") {
      finish({ sha: options.sha, kind: "live", source: decision.source })
      return true
    }
    if (decision.verdict === "unavailable") {
      finish({
        sha: options.sha,
        kind: "unavailable",
        source: decision.source,
        ...(decision.cause === undefined ? {} : { cause: decision.cause }),
      })
      return true
    }
    if (decision.verdict === "building") {
      if (elapsed() >= timing.maxWatchMs) {
        finish({
          sha: options.sha,
          kind: "building",
          source: decision.source,
          stale: true,
        })
        return true
      }
      emit({ sha: options.sha, kind: "building", source: decision.source })
      return false
    }

    // awaiting: no decisive run/status yet.
    if (elapsed() >= timing.graceMs) {
      degrade("grace")
      return true
    }
    if (elapsed() >= timing.maxWatchMs) {
      degrade("watch-timeout")
      return true
    }
    emit({ sha: options.sha, kind: "awaiting", source: "none" })
    return false
  }

  const scheduleNext = (): void => {
    if (stopped) return
    const base = elapsed() < timing.fastWindowMs ? timing.fastPollMs : timing.slowPollMs
    const jitter = timing.jitterRatio * (2 * options.random() - 1)
    const delay = Math.max(0, base * (1 + jitter))
    cancelScheduled = options.schedulePoll(delay, () => {
      cancelScheduled = undefined
      void poll()
    })
  }

  async function poll(): Promise<void> {
    if (stopped) return
    const current = ++generation
    let head: string
    let checks: CheckRunsRead
    try {
      ;[head, checks] = await Promise.all([
        options.reads.readHead(),
        options.reads.readCheckRuns(options.sha),
      ])
    } catch {
      if (current === generation) degrade("error")
      return
    }
    if (stopped || current !== generation) return

    if (head !== options.sha) {
      // Head advanced: a late run on the old sha must never repaint the newer
      // state (INV-D03). Keep the last kind as data, annotate and stop.
      emit({ ...snapshot, supersededBy: head })
      stop()
      return
    }

    let decision = classifyCheckRuns(checks)
    if (decision.verdict === "awaiting" && contexts.length > 0) {
      try {
        const statuses = await options.reads.readCommitStatuses(options.sha)
        if (stopped || current !== generation) return
        decision = decideStatus(checks, statuses, contexts)
      } catch {
        if (current === generation) degrade("error")
        return
      }
    }
    if (stopped || current !== generation) return
    if (applyDecision(decision)) return
    scheduleNext()
  }

  return {
    start(): void {
      if (started || stopped) return
      started = true
      startedAt = options.now()
      void poll()
    },
    stop,
    getSnapshot(): DeployStatusSnapshot {
      return snapshot
    },
  }
}

function sameSnapshot(left: DeployStatusSnapshot, right: DeployStatusSnapshot): boolean {
  return (
    left.sha === right.sha &&
    left.kind === right.kind &&
    left.source === right.source &&
    left.supersededBy === right.supersededBy &&
    left.detailsUrl === right.detailsUrl &&
    left.cause === right.cause &&
    left.stale === right.stale &&
    sameList(left.failureNames, right.failureNames)
  )
}

function sameList(
  left: readonly string[] | undefined,
  right: readonly string[] | undefined,
): boolean {
  if (left === right) return true
  if (left === undefined || right === undefined) return false
  return left.length === right.length && left.every((value, index) => value === right[index])
}
