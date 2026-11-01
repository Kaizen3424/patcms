/**
 * Sha-keyed refcounted registry (ADR-0008 P2.8 appendix): one watcher per sha,
 * N entries published in one sweep share one poller, the last release stops it,
 * terminal states stop themselves, and a superseded sha annotates + stops
 * (INV-D03: a late run never repaints newer state).
 *
 * Timing is fully injected — the registry receives the same seams the core
 * watcher does, so these tests own the clock and the scheduler.
 */

import type {
  CheckRunSummary,
  CheckRunsRead,
  CommitStatusesRead,
  StatusReads,
} from "patcms/advanced"
import { describe, expect, it, vi } from "vitest"
import { createStatusRegistry } from "../registry"

const SHA = "a".repeat(40)
const NEWER = "b".repeat(40)

function run(
  status: CheckRunSummary["status"],
  conclusion: CheckRunSummary["conclusion"] = null,
): CheckRunSummary {
  return { id: 1, name: "site", status, conclusion }
}

const LIVE: CheckRunsRead = {
  kind: "ok",
  totalCount: 1,
  runs: [run("completed", "success")],
}

const BUILDING: CheckRunsRead = {
  kind: "ok",
  totalCount: 1,
  runs: [run("in_progress")],
}

interface HarnessOptions {
  readonly head?: () => string
  readonly checks?: () => CheckRunsRead
  readonly contexts?: readonly string[]
}

function harness(options: HarnessOptions = {}) {
  let now = 1_000
  const timers: Array<{ delay: number; task: () => void; cancelled: boolean }> = []
  const reads = {
    readHead: vi.fn<() => Promise<string>>(async () => options.head?.() ?? SHA),
    readCheckRuns: vi.fn<(sha: string) => Promise<CheckRunsRead>>(
      async () => options.checks?.() ?? LIVE,
    ),
    readCommitStatuses: vi.fn<(sha: string) => Promise<CommitStatusesRead>>(async () => ({
      kind: "ok",
      statuses: [{ context: "deploy", state: "success" }],
    })),
  } satisfies StatusReads

  const registry = createStatusRegistry({
    reads,
    ...(options.contexts === undefined ? {} : { contexts: options.contexts }),
    now: () => now,
    schedulePoll: (delay, task) => {
      const timer = { delay, task, cancelled: false }
      timers.push(timer)
      return () => {
        timer.cancelled = true
      }
    },
    random: () => 0.5,
  })

  return {
    registry,
    reads,
    timers,
    advance: (ms: number): void => {
      now += ms
    },
  }
}

/** Polls resolve through three microtask hops (head + checks, then onChange). */
async function settle(): Promise<void> {
  for (let hop = 0; hop < 4; hop += 1) await Promise.resolve()
}

describe("status registry", () => {
  it("shares one watcher across every lease on the same sha", async () => {
    const h = harness({ checks: () => BUILDING })
    const first = h.registry.acquire(SHA)
    const second = h.registry.acquire(SHA)
    await settle()

    expect(h.reads.readHead).toHaveBeenCalledTimes(1)
    expect(h.reads.readCheckRuns).toHaveBeenCalledTimes(1)
    expect(second.getSnapshot()).toBe(first.getSnapshot())
    expect(first.getSnapshot().kind).toBe("building")
    expect(h.timers).toHaveLength(1)
  })

  it("keeps polling until the last lease leaves, then stops", async () => {
    const h = harness({ checks: () => BUILDING })
    const first = h.registry.acquire(SHA)
    const second = h.registry.acquire(SHA)
    await settle()

    first.release()
    h.timers[0]?.task()
    await settle()
    expect(h.reads.readHead).toHaveBeenCalledTimes(2)

    second.release()
    const before = h.reads.readHead.mock.calls.length
    h.timers.at(-1)?.task()
    await settle()
    expect(h.reads.readHead).toHaveBeenCalledTimes(before)
  })

  it("stops on a terminal verdict and returns it to later leases", async () => {
    const h = harness()
    const first = h.registry.acquire(SHA)
    await settle()
    expect(first.getSnapshot().kind).toBe("live")
    expect(h.timers).toHaveLength(0)

    const second = h.registry.acquire(SHA)
    expect(second.getSnapshot()).toBe(first.getSnapshot())
    expect(h.reads.readCheckRuns).toHaveBeenCalledTimes(1)
  })

  it("annotates a superseded sha and stops polling (INV-D03)", async () => {
    const h = harness({ head: () => NEWER })
    const lease = h.registry.acquire(SHA)
    await settle()

    expect(lease.getSnapshot()).toMatchObject({ sha: SHA, supersededBy: NEWER })
    expect(lease.getSnapshot().kind).toBe("awaiting")
    expect(h.timers).toHaveLength(0)
  })

  it("never calls the statuses endpoint without deploy contexts", async () => {
    const h = harness({
      checks: () => ({ kind: "ok", totalCount: 1, runs: [run("completed", "neutral")] }),
    })
    const lease = h.registry.acquire(SHA)
    await settle()

    expect(lease.getSnapshot().kind).toBe("awaiting")
    expect(h.reads.readCommitStatuses).not.toHaveBeenCalled()
  })

  it("consults configured contexts when check-runs stay undecided", async () => {
    const h = harness({
      checks: () => ({ kind: "ok", totalCount: 1, runs: [run("completed", "neutral")] }),
      contexts: ["deploy"],
    })
    const lease = h.registry.acquire(SHA)
    await settle()

    expect(h.reads.readCommitStatuses).toHaveBeenCalledTimes(1)
    expect(lease.getSnapshot()).toMatchObject({ kind: "live", source: "statuses" })
    expect(h.timers).toHaveLength(0)
  })

  it("dispose stops every watcher and cancels pending polls", async () => {
    const h = harness({ checks: () => BUILDING })
    h.registry.acquire(SHA)
    await settle()
    const pending = h.timers.at(-1)
    expect(pending?.cancelled).toBe(false)

    h.registry.dispose()
    expect(pending?.cancelled).toBe(true)

    const before = h.reads.readHead.mock.calls.length
    pending?.task()
    await settle()
    expect(h.reads.readHead).toHaveBeenCalledTimes(before)
  })
})
