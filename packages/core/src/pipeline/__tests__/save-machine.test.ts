/// <reference types="node" />
import { describe, expect, it } from "vitest"
import { BackendWriteError } from "../../backend/write-errors"
import type { SaveConflictDetails } from "../save-driver"
import {
  isRetryableWriteCode,
  SAVE_PHASE_ORDER,
  type SaveMachineEvent,
  type SaveMachineState,
  transitionSaveState,
} from "../save-machine"

/**
 * P2.5 — the ONE transition table (ADR-0004 §state machine). Every legal
 * transition asserted; illegal (phase, event) pairs are NO-OPS (a machine
 * that never throws cannot corrupt the single source of save truth).
 */

const DETAILS: SaveConflictDetails = {
  baseHeadSha: "1".repeat(40),
  currentHeadSha: "2".repeat(40),
  changed: new Map(),
}

const BASE = "a".repeat(40)

const EDITING: SaveMachineState = { phase: "editing", baseSha: BASE }
const DIRTY: SaveMachineState = { phase: "dirty", baseSha: BASE }
const QUEUED: SaveMachineState = { phase: "queued", baseSha: BASE }
const COMMITTING: SaveMachineState = { phase: "committing", baseSha: BASE }
const PAUSED: SaveMachineState = { phase: "paused", reason: "quota", waitMs: 250, baseSha: BASE }
const FAILED_RETRYABLE: SaveMachineState = {
  phase: "failed",
  error: new BackendWriteError("NETWORK", "lost", {}),
  retryable: true,
  baseSha: BASE,
}

describe("SAVE_PHASE_ORDER — the exhaustive phase vocabulary", () => {
  it("carries exactly the ADR-0004 phases in progression order", () => {
    expect([...SAVE_PHASE_ORDER]).toEqual([
      "editing",
      "dirty",
      "queued",
      "committing",
      "published",
      "conflict",
      "failed",
      "paused",
    ])
  })
})

describe("legal transitions", () => {
  it("editing/dirty → dirty on MARK_DIRTY", () => {
    expect(transitionSaveState(EDITING, { type: "MARK_DIRTY", baseSha: BASE })).toEqual({
      phase: "dirty",
      baseSha: BASE,
    })
    expect(transitionSaveState(DIRTY, { type: "MARK_DIRTY", baseSha: BASE })).toEqual({
      phase: "dirty",
      baseSha: BASE,
    })
  })

  it("editing/dirty → queued on SUBMIT (INV-P04 entry)", () => {
    expect(transitionSaveState(DIRTY, { type: "SUBMIT", baseSha: BASE })).toEqual({
      phase: "queued",
      baseSha: BASE,
    })
  })

  it("queued → committing on START (transport attempt begins)", () => {
    expect(transitionSaveState(QUEUED, { type: "START" })).toEqual({
      phase: "committing",
      baseSha: BASE,
    })
  })

  it("committing → published on PUBLISHED, carrying shas when present (INV-P10)", () => {
    expect(
      transitionSaveState(COMMITTING, { type: "PUBLISHED", commitSha: BASE, treeSha: "t" }),
    ).toEqual({
      phase: "published",
      commitSha: BASE,
      treeSha: "t",
    })
    expect(transitionSaveState(COMMITTING, { type: "PUBLISHED" })).toEqual({ phase: "published" })
  })

  it("committing → conflict on CONFLICT", () => {
    expect(transitionSaveState(COMMITTING, { type: "CONFLICT", details: DETAILS })).toEqual({
      phase: "conflict",
      details: DETAILS,
    })
  })

  it("committing → failed on FAILED (retryable flag preserved)", () => {
    const error = new BackendWriteError("NETWORK", "lost", {})
    expect(transitionSaveState(COMMITTING, { type: "FAILED", error, retryable: true })).toEqual({
      phase: "failed",
      error,
      retryable: true,
      baseSha: BASE,
    })
  })

  it("committing/queued → paused on PARK (quota/network/auth)", () => {
    expect(transitionSaveState(COMMITTING, { type: "PARK", reason: "quota", waitMs: 250 })).toEqual(
      { phase: "paused", reason: "quota", waitMs: 250, baseSha: BASE },
    )
    expect(transitionSaveState(QUEUED, { type: "PARK", reason: "auth", waitMs: null })).toEqual({
      phase: "paused",
      reason: "auth",
      waitMs: null,
      baseSha: BASE,
    })
  })

  it("failed(retryable) → paused on PARK — the ADR-0004 backoff-cap law", () => {
    expect(
      transitionSaveState(FAILED_RETRYABLE, { type: "PARK", reason: "network", waitMs: null }),
    ).toEqual({ phase: "paused", reason: "network", waitMs: null, baseSha: BASE })
  })

  it("dirty/queued/paused → queued on REBASELINE(resume) with the FRESH base", () => {
    for (const state of [DIRTY, QUEUED, PAUSED]) {
      expect(
        transitionSaveState(state, { type: "REBASELINE", outcome: "resume", baseSha: "b" }),
      ).toEqual({
        phase: "queued",
        baseSha: "b",
      })
    }
  })

  it("any unpublished → conflict on REBASELINE(conflict) — steal adjudication", () => {
    expect(
      transitionSaveState(PAUSED, {
        type: "REBASELINE",
        outcome: "conflict",
        details: DETAILS,
      }),
    ).toEqual({ phase: "conflict", details: DETAILS })
  })

  it("failed(retryable) → queued on RETRY; failed(unretryable) stays", () => {
    expect(transitionSaveState(FAILED_RETRYABLE, { type: "RETRY" })).toEqual({
      phase: "queued",
      baseSha: BASE,
    })
    const terminal: SaveMachineState = {
      phase: "failed",
      error: new BackendWriteError("SCOPE", "no", {}),
      retryable: false,
      baseSha: BASE,
    }
    expect(transitionSaveState(terminal, { type: "RETRY" })).toEqual(terminal)
  })

  it("paused → queued on RESUME (manual/event-driven wake)", () => {
    expect(transitionSaveState(PAUSED, { type: "RESUME" })).toEqual({
      phase: "queued",
      baseSha: BASE,
    })
  })

  it("published/conflict/failed → editing on RESET", () => {
    for (const state of [
      transitionSaveState(COMMITTING, { type: "PUBLISHED", commitSha: BASE }),
      transitionSaveState(COMMITTING, { type: "CONFLICT", details: DETAILS }),
      transitionSaveState(COMMITTING, {
        type: "FAILED",
        error: new BackendWriteError("SCOPE", "no", {}),
        retryable: false,
      }),
    ] as const) {
      expect(transitionSaveState(state, { type: "RESET", baseSha: "b" })).toEqual({
        phase: "editing",
        baseSha: "b",
      })
    }
  })
})

describe("illegal transitions are no-ops (never a throw, never a corrupt state)", () => {
  const cases: ReadonlyArray<readonly [SaveMachineState, SaveMachineEvent]> = [
    [EDITING, { type: "START" }],
    [EDITING, { type: "PUBLISHED", commitSha: BASE }],
    [EDITING, { type: "CONFLICT", details: DETAILS }],
    [
      EDITING,
      { type: "FAILED", error: new BackendWriteError("NETWORK", "x", {}), retryable: true },
    ],
    [EDITING, { type: "RETRY" }],
    [EDITING, { type: "RESUME" }],
    [DIRTY, { type: "START" }],
    [QUEUED, { type: "SUBMIT", baseSha: BASE }],
    [QUEUED, { type: "RETRY" }],
    [COMMITTING, { type: "SUBMIT", baseSha: BASE }],
    [COMMITTING, { type: "RETRY" }],
    [COMMITTING, { type: "RESET", baseSha: "b" }],
    [PAUSED, { type: "PUBLISHED", commitSha: BASE }],
    [PAUSED, { type: "CONFLICT", details: DETAILS }],
    [PAUSED, { type: "PARK", reason: "quota", waitMs: 1 }],
    [
      { phase: "published", commitSha: BASE },
      { type: "REBASELINE", outcome: "conflict", details: DETAILS },
    ],
    [{ phase: "conflict", details: DETAILS }, { type: "RETRY" }],
    [
      {
        phase: "failed",
        error: new BackendWriteError("SCOPE", "x", {}),
        retryable: false,
        baseSha: BASE,
      },
      { type: "PARK", reason: "network", waitMs: null },
    ],
  ] as const

  it("return the state UNCHANGED (identity, not a copy)", () => {
    for (const [state, event] of cases) {
      expect(transitionSaveState(state, event)).toBe(state)
    }
  })
})

describe("isRetryableWriteCode — the backoff eligibility set", () => {
  it("NETWORK and UNKNOWN retry; everything else is terminal", () => {
    expect(isRetryableWriteCode("NETWORK")).toBe(true)
    expect(isRetryableWriteCode("UNKNOWN")).toBe(true)
    expect(isRetryableWriteCode("AUTH_EXPIRED")).toBe(false)
    expect(isRetryableWriteCode("RATE_LIMIT")).toBe(false)
    expect(isRetryableWriteCode("CAS_CONFLICT")).toBe(false)
    expect(isRetryableWriteCode("SCOPE")).toBe(false)
  })
})
