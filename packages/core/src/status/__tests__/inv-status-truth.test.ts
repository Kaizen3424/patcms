import { describe, expect, it } from "vitest"
import type { CheckRunSummary } from "../../backend/types"
import { DEFAULT_STATUS_TIMING } from "../types"
import { createStatusHarness, emptyChecks } from "./harness"

/**
 * INV-D01 — deploy-status truth (ADR-0008 P2.8 appendix).
 *
 * Check runs are primary and sha-matched; absences inside the grace window are
 * "unavailable", never "failed"; read errors degrade and stop; the
 * commit-status fallback runs only through configured contexts; cadence is
 * 5 s → 10 s jittered; polling stops on every terminal state.
 */

const SHA = "a".repeat(40)

const FAST_TIMING = {
  fastPollMs: 1_000,
  slowPollMs: 2_000,
  fastWindowMs: 10_000,
  graceMs: 5_000,
  maxWatchMs: 60_000,
  jitterRatio: 0,
} as const

function success(): CheckRunSummary {
  return { id: 1, name: "pages", status: "completed", conclusion: "success" }
}

describe("INV-D01 check-run truth", () => {
  it("pins the ADR timings: 5 s → 10 s, 120 s grace, 10 min ceiling", () => {
    expect(DEFAULT_STATUS_TIMING).toEqual({
      fastPollMs: 5_000,
      slowPollMs: 10_000,
      fastWindowMs: 60_000,
      graceMs: 120_000,
      maxWatchMs: 600_000,
      jitterRatio: 0.2,
    })
  })

  it("reports Live only for a sha-matched all-success set", async () => {
    const harness = createStatusHarness({
      sha: SHA,
      checks: { kind: "ok", totalCount: 1, runs: [success()] },
    })
    await harness.start()
    expect(harness.watcher.getSnapshot()).toEqual({
      sha: SHA,
      kind: "live",
      source: "checks",
    })
    expect(harness.checksShas).toEqual([SHA])
    expect(harness.active()).toEqual([])
  })

  it("keeps polling while building, then reports Live", async () => {
    const harness = createStatusHarness({
      sha: SHA,
      timing: FAST_TIMING,
      checks: {
        kind: "ok",
        totalCount: 1,
        runs: [{ ...success(), status: "in_progress", conclusion: null }],
      },
    })
    await harness.start()
    expect(harness.watcher.getSnapshot()).toMatchObject({ kind: "building", source: "checks" })

    harness.setChecks({ kind: "ok", totalCount: 1, runs: [success()] })
    await harness.advance(1_000)
    expect(harness.watcher.getSnapshot()).toMatchObject({ kind: "live", source: "checks" })
    expect(harness.active()).toEqual([])
  })

  it("turns 'no run yet' into unavailable at grace, never failed", async () => {
    const harness = createStatusHarness({ sha: SHA, timing: FAST_TIMING })
    await harness.start()
    for (let step = 0; step < 4; step += 1) {
      await harness.advance(1_000)
      expect(harness.watcher.getSnapshot().kind).toBe("awaiting")
    }
    await harness.advance(1_000)
    expect(harness.watcher.getSnapshot()).toEqual({
      sha: SHA,
      kind: "unavailable",
      source: "none",
      cause: "grace",
    })
    expect(harness.active()).toEqual([])
  })

  it("suppresses duplicate snapshots across polls", async () => {
    const harness = createStatusHarness({
      sha: SHA,
      timing: { ...FAST_TIMING, graceMs: 100_000 },
      checks: {
        kind: "ok",
        totalCount: 1,
        runs: [{ ...success(), status: "in_progress", conclusion: null }],
      },
    })
    await harness.start()
    await harness.advance(1_000)
    expect(harness.snapshots).toHaveLength(1)
    expect(harness.snapshots[0]).toMatchObject({ kind: "building" })
  })

  it("reports unavailable (never failed) and stops on a read error", async () => {
    const harness = createStatusHarness({ sha: SHA, timing: FAST_TIMING })
    harness.failChecksRead()
    await harness.start()
    expect(harness.watcher.getSnapshot()).toEqual({
      sha: SHA,
      kind: "unavailable",
      source: "none",
      cause: "error",
    })
    expect(harness.active()).toEqual([])
    await harness.advance(60_000)
    expect(harness.watcher.getSnapshot().kind).toBe("unavailable")
    expect(harness.checksReads).toBe(1)
  })

  it("reports unavailable and stops when the head read fails", async () => {
    const harness = createStatusHarness({ sha: SHA, timing: FAST_TIMING })
    harness.failHeadRead()
    await harness.start()
    expect(harness.watcher.getSnapshot()).toMatchObject({
      kind: "unavailable",
      cause: "error",
    })
    expect(harness.active()).toEqual([])
  })

  it("reports unsupported truth as unavailable without polling", async () => {
    const harness = createStatusHarness({ sha: SHA, checks: { kind: "unsupported" } })
    await harness.start()
    expect(harness.watcher.getSnapshot()).toEqual({
      sha: SHA,
      kind: "unavailable",
      source: "checks",
      cause: "unsupported",
    })
    expect(harness.active()).toEqual([])
  })

  it("never calls an incomplete page Live", async () => {
    const harness = createStatusHarness({
      sha: SHA,
      checks: { kind: "ok", totalCount: 120, runs: [success()] },
    })
    await harness.start()
    expect(harness.watcher.getSnapshot()).toEqual({
      sha: SHA,
      kind: "unavailable",
      source: "checks",
      cause: "incomplete",
    })
  })

  it("stops a still-building watch at the ceiling with a stale annotation", async () => {
    const harness = createStatusHarness({
      sha: SHA,
      timing: { ...FAST_TIMING, graceMs: 100_000, maxWatchMs: 3_000 },
      checks: {
        kind: "ok",
        totalCount: 1,
        runs: [{ ...success(), status: "queued", conclusion: null }],
      },
    })
    await harness.start()
    await harness.advance(1_000)
    await harness.advance(1_000)
    expect(harness.watcher.getSnapshot()).toMatchObject({ kind: "building" })
    await harness.advance(1_000)
    expect(harness.watcher.getSnapshot()).toEqual({
      sha: SHA,
      kind: "building",
      source: "checks",
      stale: true,
    })
    expect(harness.active()).toEqual([])
  })

  it("uses watch-timeout when grace sits beyond the ceiling", async () => {
    const harness = createStatusHarness({
      sha: SHA,
      timing: { ...FAST_TIMING, graceMs: 100_000, maxWatchMs: 2_000 },
    })
    await harness.start()
    await harness.advance(1_000)
    await harness.advance(1_000)
    expect(harness.watcher.getSnapshot()).toEqual({
      sha: SHA,
      kind: "unavailable",
      source: "none",
      cause: "watch-timeout",
    })
  })
})

describe("INV-D01 commit-status fallback (deploy.contexts)", () => {
  it("accepts a configured context success when no check run is decisive", async () => {
    const harness = createStatusHarness({
      sha: SHA,
      contexts: ["ci/site"],
      statuses: { kind: "ok", statuses: [{ context: "ci/site", state: "success" }] },
    })
    await harness.start()
    expect(harness.watcher.getSnapshot()).toEqual({
      sha: SHA,
      kind: "live",
      source: "statuses",
    })
    expect(harness.statusesShas).toEqual([SHA])
  })

  it("never polls statuses without configured contexts", async () => {
    const harness = createStatusHarness({
      sha: SHA,
      timing: { ...FAST_TIMING, graceMs: 1_000 },
      statuses: { kind: "ok", statuses: [{ context: "ci/site", state: "success" }] },
    })
    await harness.start()
    expect(harness.statusesReads).toBe(0)
    await harness.advance(1_000)
    expect(harness.watcher.getSnapshot()).toMatchObject({
      kind: "unavailable",
      cause: "grace",
    })
    expect(harness.statusesReads).toBe(0)
  })

  it("keeps a decisive check-run state above the fallback", async () => {
    const harness = createStatusHarness({
      sha: SHA,
      contexts: ["ci/site"],
      checks: {
        kind: "ok",
        totalCount: 1,
        runs: [{ ...success(), conclusion: "failure" }],
      },
      statuses: { kind: "ok", statuses: [{ context: "ci/site", state: "success" }] },
    })
    await harness.start()
    expect(harness.watcher.getSnapshot()).toMatchObject({
      kind: "failed",
      source: "checks",
    })
    expect(harness.statusesReads).toBe(0)
  })

  it("reports unavailable on a fallback read error, never failed", async () => {
    const harness = createStatusHarness({ sha: SHA, contexts: ["ci/site"] })
    harness.failStatusesRead()
    await harness.start()
    expect(harness.watcher.getSnapshot()).toEqual({
      sha: SHA,
      kind: "unavailable",
      source: "none",
      cause: "error",
    })
    expect(harness.active()).toEqual([])
  })
})

describe("INV-D01 cadence and lifecycle", () => {
  it("uses the fast cadence inside the window and the slow cadence after", async () => {
    const harness = createStatusHarness({
      sha: SHA,
      timing: {
        fastPollMs: 1_000,
        slowPollMs: 5_000,
        fastWindowMs: 3_000,
        graceMs: 100_000,
        maxWatchMs: 200_000,
        jitterRatio: 0,
      },
    })
    await harness.start()
    await harness.advance(1_000)
    await harness.advance(1_000)
    await harness.advance(1_000)
    expect(harness.delays).toEqual([1_000, 1_000, 1_000, 5_000])
    await harness.advance(5_000)
    expect(harness.delays).toEqual([1_000, 1_000, 1_000, 5_000, 5_000])
  })

  it("applies ±jitterRatio via the injected random source", async () => {
    const draws = [0, 1]
    let index = 0
    const harness = createStatusHarness({
      sha: SHA,
      timing: { ...FAST_TIMING, graceMs: 100_000, jitterRatio: 0.2 },
      random: () => draws[index++] ?? 0.5,
    })
    await harness.start()
    await harness.advance(800)
    expect(harness.delays).toHaveLength(2)
    expect(harness.delays[0]).toBeCloseTo(800)
    expect(harness.delays[1]).toBeCloseTo(1_200)
  })

  it("clamps a negative jittered delay to zero", async () => {
    const harness = createStatusHarness({
      sha: SHA,
      timing: { ...FAST_TIMING, graceMs: 100_000, jitterRatio: 2 },
      random: () => 0,
    })
    await harness.start()
    expect(harness.delays).toEqual([0])
    harness.setChecks({ kind: "ok", totalCount: 1, runs: [success()] })
    await harness.advance(0)
    expect(harness.watcher.getSnapshot().kind).toBe("live")
    expect(harness.delays).toEqual([0])
  })

  it("is idempotent on start and inert after stop", async () => {
    const harness = createStatusHarness({ sha: SHA, timing: FAST_TIMING })
    await harness.start()
    harness.watcher.start()
    await harness.flush()
    expect(harness.checksReads).toBe(1)
    expect(harness.headReads).toBe(1)

    expect(harness.active()).toHaveLength(1)
    harness.watcher.stop()
    expect(harness.active()).toEqual([])
    await harness.advance(100_000)
    expect(harness.checksReads).toBe(1)
  })

  it("never polls when stopped before start", async () => {
    const harness = createStatusHarness({ sha: SHA })
    harness.watcher.stop()
    await harness.start()
    expect(harness.checksReads).toBe(0)
    expect(harness.watcher.getSnapshot()).toEqual({
      sha: SHA,
      kind: "awaiting",
      source: "none",
    })
  })

  it("reads the watched sha, not the branch head", async () => {
    const harness = createStatusHarness({
      sha: SHA,
      head: SHA,
      checks: emptyChecks(),
      timing: { ...FAST_TIMING, graceMs: 2_000 },
    })
    await harness.start()
    await harness.advance(1_000)
    expect(harness.checksShas).toEqual([SHA, SHA])
    expect(harness.watcher.getSnapshot().kind).toBe("awaiting")
  })
})
