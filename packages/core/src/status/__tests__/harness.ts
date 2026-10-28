/**
 * Deterministic seams for status-watcher tests: no real timers, no globals.
 * The watcher owns no clock — this harness proves the injection contract and
 * lets INV-D01/D03 drive grace, cadence and supersede without sleeps.
 */

import type { CheckRunsRead, CommitStatusesRead } from "../../backend/types"
import type { DeployStatusSnapshot, StatusTiming, StatusWatcher } from "../types"
import { createStatusWatcher } from "../watcher"

export interface ScheduledPoll {
  readonly at: number
  readonly delay: number
  readonly task: () => void
  cancelled: boolean
  ran: boolean
}

export interface StatusHarnessOptions {
  readonly sha: string
  readonly head?: string
  readonly contexts?: readonly string[]
  readonly timing?: Partial<StatusTiming>
  readonly checks?: CheckRunsRead
  readonly statuses?: CommitStatusesRead
  readonly random?: () => number
}

export function emptyChecks(): CheckRunsRead {
  return { kind: "ok", totalCount: 0, runs: [] }
}

export function emptyStatuses(): CommitStatusesRead {
  return { kind: "ok", statuses: [] }
}

export interface StatusHarness {
  readonly watcher: StatusWatcher
  readonly snapshots: readonly DeployStatusSnapshot[]
  readonly scheduled: readonly ScheduledPoll[]
  readonly delays: readonly number[]
  readonly checksReads: number
  readonly statusesReads: number
  readonly headReads: number
  /** Shas the watcher actually asked about (per-sha keying truth). */
  readonly checksShas: readonly string[]
  readonly statusesShas: readonly string[]
  now(): number
  start(): Promise<void>
  advance(ms: number): Promise<void>
  flush(): Promise<void>
  active(): readonly ScheduledPoll[]
  setHead(head: string): void
  setChecks(checks: CheckRunsRead): void
  setStatuses(statuses: CommitStatusesRead): void
  failHeadRead(): void
  failChecksRead(): void
  failStatusesRead(): void
}

export function createStatusHarness(options: StatusHarnessOptions): StatusHarness {
  let nowMs = 0
  let head = options.head ?? options.sha
  let checks = options.checks ?? emptyChecks()
  let statuses = options.statuses ?? emptyStatuses()
  let headFails = false
  let checksFails = false
  let statusesFails = false
  let checksReads = 0
  let statusesReads = 0
  let headReads = 0
  const scheduled: ScheduledPoll[] = []
  const delays: number[] = []
  const snapshots: DeployStatusSnapshot[] = []
  const checksShas: string[] = []
  const statusesShas: string[] = []

  const watcher = createStatusWatcher({
    sha: options.sha,
    reads: {
      readHead: async () => {
        headReads += 1
        if (headFails) throw new Error("head read failed")
        return head
      },
      readCheckRuns: async (sha) => {
        checksReads += 1
        checksShas.push(sha)
        if (checksFails) throw new Error("check-runs read failed")
        return checks
      },
      readCommitStatuses: async (sha) => {
        statusesReads += 1
        statusesShas.push(sha)
        if (statusesFails) throw new Error("status read failed")
        return statuses
      },
    },
    ...(options.contexts === undefined ? {} : { contexts: options.contexts }),
    ...(options.timing === undefined ? {} : { timing: options.timing }),
    now: () => nowMs,
    schedulePoll: (delay, task) => {
      const entry: ScheduledPoll = {
        at: nowMs + delay,
        delay,
        task,
        cancelled: false,
        ran: false,
      }
      scheduled.push(entry)
      delays.push(delay)
      return () => {
        entry.cancelled = true
      }
    },
    random: options.random ?? (() => 0.5),
    onChange: (snapshot) => {
      snapshots.push(snapshot)
    },
  })

  // Every poll path awaits at most a few microtasks; twelve is generous.
  async function flush(): Promise<void> {
    for (let index = 0; index < 12; index += 1) await Promise.resolve()
  }

  function nextDue(): ScheduledPoll | undefined {
    let due: ScheduledPoll | undefined
    for (const entry of scheduled) {
      if (entry.cancelled || entry.ran || entry.at > nowMs) continue
      if (due === undefined || entry.at < due.at) due = entry
    }
    return due
  }

  async function advance(ms: number): Promise<void> {
    nowMs += ms
    for (let entry = nextDue(); entry !== undefined; entry = nextDue()) {
      entry.ran = true
      entry.task()
      await flush()
    }
  }

  return {
    watcher,
    snapshots,
    scheduled,
    delays,
    get checksReads() {
      return checksReads
    },
    get statusesReads() {
      return statusesReads
    },
    get headReads() {
      return headReads
    },
    checksShas,
    statusesShas,
    now: () => nowMs,
    async start() {
      watcher.start()
      await flush()
    },
    advance,
    flush,
    active: () => scheduled.filter((entry) => !entry.cancelled && !entry.ran),
    setHead: (value) => {
      head = value
    },
    setChecks: (value) => {
      checks = value
    },
    setStatuses: (value) => {
      statuses = value
    },
    failHeadRead: () => {
      headFails = true
    },
    failChecksRead: () => {
      checksFails = true
    },
    failStatusesRead: () => {
      statusesFails = true
    },
  }
}
