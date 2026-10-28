import { describe, expect, it } from "vitest"
import type { CheckRunSummary } from "../../backend/types"
import { createStatusHarness } from "./harness"

/**
 * INV-D03 — supersede truth (ADR-0008 P2.8 appendix).
 *
 * Polling watches one exact sha. When the branch head advances, the snapshot
 * gains `supersededBy` and stops; a late run on the old sha can never repaint a
 * newer commit. Watchers are per-sha keyed, so two publishes never share truth.
 */

const C1 = "1".repeat(40)
const C2 = "2".repeat(40)
const C3 = "3".repeat(40)

const TIMING = {
  fastPollMs: 1_000,
  slowPollMs: 2_000,
  fastWindowMs: 60_000,
  graceMs: 60_000,
  maxWatchMs: 120_000,
  jitterRatio: 0,
} as const

function running(): CheckRunSummary {
  return { id: 1, name: "pages", status: "in_progress", conclusion: null }
}

function success(): CheckRunSummary {
  return { id: 1, name: "pages", status: "completed", conclusion: "success" }
}

describe("INV-D03 supersede annotation", () => {
  it("annotates and stops when the first poll already sees a newer head", async () => {
    const harness = createStatusHarness({ sha: C1, head: C2, timing: TIMING })
    await harness.start()
    expect(harness.watcher.getSnapshot()).toEqual({
      sha: C1,
      kind: "awaiting",
      source: "none",
      supersededBy: C2,
    })
    expect(harness.active()).toEqual([])
  })

  it("annotates a watch whose head advances while building", async () => {
    const harness = createStatusHarness({
      sha: C1,
      head: C1,
      timing: TIMING,
      checks: { kind: "ok", totalCount: 1, runs: [running()] },
    })
    await harness.start()
    expect(harness.watcher.getSnapshot()).toMatchObject({ kind: "building" })

    harness.setHead(C2)
    await harness.advance(1_000)
    expect(harness.watcher.getSnapshot()).toEqual({
      sha: C1,
      kind: "building",
      source: "checks",
      supersededBy: C2,
    })
    expect(harness.active()).toEqual([])
  })

  it("never repaints the old chip from a late run on the old sha", async () => {
    const harness = createStatusHarness({
      sha: C1,
      head: C1,
      timing: TIMING,
      checks: { kind: "ok", totalCount: 1, runs: [running()] },
    })
    await harness.start()
    harness.setHead(C2)
    await harness.advance(1_000)
    const annotated = harness.watcher.getSnapshot()
    const emitted = harness.snapshots.length

    harness.setChecks({
      kind: "ok",
      totalCount: 1,
      runs: [{ ...running(), status: "completed", conclusion: "failure" }],
    })
    await harness.advance(60_000)

    expect(harness.watcher.getSnapshot()).toEqual(annotated)
    expect(harness.snapshots).toHaveLength(emitted)
    expect(harness.watcher.getSnapshot().kind).not.toBe("failed")
  })

  it("keys truth per sha: a newer watcher and an older watcher disagree safely", async () => {
    const older = createStatusHarness({
      sha: C1,
      head: C1,
      timing: TIMING,
      checks: { kind: "ok", totalCount: 1, runs: [running()] },
    })
    const newer = createStatusHarness({
      sha: C2,
      head: C2,
      timing: TIMING,
      checks: { kind: "ok", totalCount: 1, runs: [success()] },
    })
    await older.start()
    await newer.start()
    expect(older.watcher.getSnapshot()).toMatchObject({ sha: C1, kind: "building" })
    expect(newer.watcher.getSnapshot()).toEqual({ sha: C2, kind: "live", source: "checks" })
    expect(older.checksShas).toEqual([C1])
    expect(newer.checksShas).toEqual([C2])

    older.setHead(C3)
    await older.advance(1_000)
    expect(older.watcher.getSnapshot()).toMatchObject({ supersededBy: C3 })
    expect(newer.watcher.getSnapshot()).toEqual({ sha: C2, kind: "live", source: "checks" })
  })

  it("does not annotate while the head stays on the watched sha", async () => {
    const harness = createStatusHarness({
      sha: C1,
      head: C1,
      timing: TIMING,
      checks: { kind: "ok", totalCount: 1, runs: [running()] },
    })
    await harness.start()
    await harness.advance(1_000)
    expect(harness.watcher.getSnapshot()).not.toHaveProperty("supersededBy")
    expect(harness.active()).toHaveLength(1)
  })
})
