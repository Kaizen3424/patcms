import { describe, expect, it } from "vitest"
import type {
  CheckRunConclusion,
  CheckRunStatus,
  CheckRunSummary,
  CheckRunsRead,
  CommitStatusesRead,
  CommitStatusState,
  CommitStatusSummary,
} from "../../backend/types"
import { classifyCheckRuns, classifyCommitStatuses, decideStatus } from "../classify"

/**
 * ADR-0008 P2.8 conclusion matrix, pinned as a truth table:
 * failure-first → non-completed building → any success live,
 * neutral/skipped never mask a real success and a skipped-only set is
 * never Live. Commit statuses are a contexts-gated fallback only.
 */

function run(overrides: Partial<CheckRunSummary> = {}): CheckRunSummary {
  return { id: 1, name: "pages", status: "completed", conclusion: "success", ...overrides }
}

function checks(runs: readonly CheckRunSummary[], totalCount = runs.length): CheckRunsRead {
  return { kind: "ok", totalCount, runs }
}

function status(context: string, state: CommitStatusState): CommitStatusSummary {
  return { context, state }
}

function statuses(list: readonly CommitStatusSummary[]): CommitStatusesRead {
  return { kind: "ok", statuses: list }
}

describe("classifyCheckRuns — failure-first matrix", () => {
  it("treats unsupported as unavailable, never failed", () => {
    expect(classifyCheckRuns({ kind: "unsupported" })).toEqual({
      verdict: "unavailable",
      source: "checks",
      cause: "unsupported",
    })
  })

  it("lets a failure outrank a sibling that is still running", () => {
    const decision = classifyCheckRuns(
      checks([
        run({ id: 1, name: "still-running", status: "in_progress", conclusion: null }),
        run({
          id: 2,
          name: "pages",
          conclusion: "failure",
          detailsUrl: "https://github.com/o/r/runs/2",
        }),
      ]),
    )
    expect(decision).toEqual({
      verdict: "failed",
      source: "checks",
      detailsUrl: "https://github.com/o/r/runs/2",
      failureNames: ["pages"],
    })
  })

  it("maps every failure-class conclusion to failed", () => {
    const failureConclusions = [
      "failure",
      "timed_out",
      "cancelled",
      "action_required",
      "stale",
    ] as const satisfies readonly CheckRunConclusion[]
    for (const conclusion of failureConclusions) {
      const decision = classifyCheckRuns(checks([run({ conclusion })]))
      expect(decision.verdict).toBe("failed")
      expect(decision.source).toBe("checks")
    }
  })

  it("never treats neutral or skipped as failure or success", () => {
    expect(classifyCheckRuns(checks([run({ conclusion: "neutral" })])).verdict).toBe("awaiting")
    expect(classifyCheckRuns(checks([run({ conclusion: "skipped" })])).verdict).toBe("awaiting")
    expect(
      classifyCheckRuns(checks([run({ conclusion: "neutral" }), run({ conclusion: "skipped" })]))
        .verdict,
    ).toBe("awaiting")
  })

  it("reports building for every non-completed status", () => {
    for (const status of [
      "queued",
      "in_progress",
      "pending",
      "requested",
      "waiting",
    ] as const satisfies readonly CheckRunStatus[]) {
      const decision = classifyCheckRuns(checks([run({ status, conclusion: null })]))
      expect(decision).toEqual({ verdict: "building", source: "checks" })
    }
  })

  it("reports live when any real success exists, even beside neutral/skipped", () => {
    const decision = classifyCheckRuns(
      checks([
        run({ id: 1, conclusion: "neutral" }),
        run({ id: 2, conclusion: "skipped" }),
        run({ id: 3, conclusion: "success" }),
      ]),
    )
    expect(decision).toEqual({ verdict: "live", source: "checks" })
  })

  it("keeps an empty set awaiting (grace is the watcher's job)", () => {
    expect(classifyCheckRuns(checks([])).verdict).toBe("awaiting")
  })

  it("never reports Live from an incomplete page", () => {
    const decision = classifyCheckRuns(checks([run()], 120))
    expect(decision).toEqual({
      verdict: "unavailable",
      source: "checks",
      cause: "incomplete",
    })
  })

  it("keeps failure truth even when the page is incomplete", () => {
    const decision = classifyCheckRuns(
      checks([run({ conclusion: "failure", detailsUrl: "https://ci.example/1" })], 2),
    )
    expect(decision.verdict).toBe("failed")
    expect(decision.detailsUrl).toBe("https://ci.example/1")
  })

  it("keeps all failure names and omits a missing detail link", () => {
    const decision = classifyCheckRuns(
      checks([
        run({ id: 1, name: "pages", conclusion: "failure" }),
        run({ id: 2, name: "preview", conclusion: "timed_out" }),
      ]),
    )
    expect(decision.failureNames).toEqual(["pages", "preview"])
    expect(decision).not.toHaveProperty("detailsUrl")
  })

  it("links the first failure that actually has a safe URL", () => {
    const decision = classifyCheckRuns(
      checks([
        run({ id: 1, name: "no-link", conclusion: "failure" }),
        run({
          id: 2,
          name: "linked",
          conclusion: "failure",
          detailsUrl: "https://github.com/o/r/runs/2",
        }),
      ]),
    )
    expect(decision.detailsUrl).toBe("https://github.com/o/r/runs/2")
    expect(decision.failureNames).toEqual(["no-link", "linked"])
  })
})

describe("classifyCommitStatuses — contexts-gated fallback", () => {
  it("is inert without configured contexts", () => {
    expect(classifyCommitStatuses(statuses([status("ci/site", "failure")]), [])).toEqual({
      verdict: "awaiting",
      source: "statuses",
    })
  })

  it("is inert when the source is unsupported", () => {
    expect(classifyCommitStatuses({ kind: "unsupported" }, ["ci/site"]).verdict).toBe("awaiting")
  })

  it("matches contexts exactly and ignores unrelated failures", () => {
    const decision = classifyCommitStatuses(
      statuses([status("some-other-ci", "failure"), status("ci/site", "success")]),
      ["ci/site"],
    )
    expect(decision).toEqual({ verdict: "live", source: "statuses" })
  })

  it("prefers a matching failure over pending/success", () => {
    const decision = classifyCommitStatuses(
      statuses([
        status("ci/site", "pending"),
        { context: "ci/site", state: "error", targetUrl: "https://ci.example/err" },
      ]),
      ["ci/site"],
    )
    expect(decision).toEqual({
      verdict: "failed",
      source: "statuses",
      detailsUrl: "https://ci.example/err",
    })
  })

  it("reports building for pending and live for success", () => {
    expect(
      classifyCommitStatuses(statuses([status("ci/site", "pending")]), ["ci/site"]).verdict,
    ).toBe("building")
    expect(
      classifyCommitStatuses(statuses([status("ci/site", "success")]), ["ci/site"]).verdict,
    ).toBe("live")
  })

  it("stays awaiting when no configured context has reported", () => {
    expect(
      classifyCommitStatuses(statuses([status("other", "failure")]), ["ci/site"]).verdict,
    ).toBe("awaiting")
  })
})

describe("decideStatus — a decisive check-run state always wins", () => {
  it("keeps a check-run failure even when statuses claim success", () => {
    const decision = decideStatus(
      checks([run({ conclusion: "failure" })]),
      statuses([status("ci/site", "success")]),
      ["ci/site"],
    )
    expect(decision).toMatchObject({ verdict: "failed", source: "checks" })
  })

  it("falls back only when checks are awaiting", () => {
    const decision = decideStatus(
      checks([run({ conclusion: "neutral" })]),
      statuses([status("ci/site", "success")]),
      ["ci/site"],
    )
    expect(decision).toEqual({ verdict: "live", source: "statuses" })
  })

  it("keeps the checks decision when no contexts are configured", () => {
    const decision = decideStatus(checks([]), statuses([status("ci/site", "success")]), [])
    expect(decision).toEqual({ verdict: "awaiting", source: "checks" })
  })

  it("keeps checks awaiting when the filtered statuses are also awaiting", () => {
    const decision = decideStatus(checks([]), statuses([status("other", "failure")]), ["ci/site"])
    expect(decision).toEqual({ verdict: "awaiting", source: "checks" })
  })
})
