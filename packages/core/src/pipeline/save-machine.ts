/**
 * Save state machine — ADR-0004 §state machine: ONE transition table, never
 * scattered booleans. Pure over its state: the coordinator (P2.5) drives the
 * IO and dispatches events per entry; the editor (P2.6) owns the editing/dirty
 * ends of the same table. Illegal (phase, event) pairs are NO-OPS — a machine
 * that has never thrown cannot corrupt the one source of save truth.
 *
 * Vocabulary (ADR-0004): editing(baseSha) → dirty → queued → committing →
 * published | conflict | failed(retryable→backoff cap→paused(manual)) |
 * paused(reason{network,auth,quota}). Progression is callback-driven;
 * `visibilitychange` wakes verify-then-rebuild (controller law).
 */

import type { BackendWriteError } from "../backend/write-errors"
import type { SaveConflictDetails } from "./save-driver"

/** Exhaustive save phases (ADR-0004 §state machine) — the barrel re-exports. */
export const SAVE_PHASE_ORDER = [
  "editing",
  "dirty",
  "queued",
  "committing",
  "published",
  "conflict",
  "failed",
  "paused",
] as const

export type SavePhase = (typeof SAVE_PHASE_ORDER)[number]

/** Why a save is parked (ADR-0004 C.3 pins: paused-reasons table). */
export type SavePauseReason = "quota" | "network" | "auth"

export type SaveMachineState =
  | { readonly phase: "editing"; readonly baseSha: string }
  | { readonly phase: "dirty"; readonly baseSha: string }
  | { readonly phase: "queued"; readonly baseSha: string }
  | { readonly phase: "committing"; readonly baseSha: string }
  /** Saved ✓ — confirmation by content (INV-P10); `commitSha` absent on noop. */
  | { readonly phase: "published"; readonly commitSha?: string; readonly treeSha?: string }
  | { readonly phase: "conflict"; readonly details: SaveConflictDetails }
  | {
      readonly phase: "failed"
      readonly error: BackendWriteError
      /** Retryable failures flow to paused(network) after the backoff cap. */
      readonly retryable: boolean
      /** Kept so RETRY/PARK can re-enter the queue with the same coordinate. */
      readonly baseSha: string
    }
  | {
      readonly phase: "paused"
      readonly reason: SavePauseReason
      /** Countdown guidance; `null` = no window guidance → manual resume. */
      readonly waitMs: number | null
      readonly baseSha: string
    }

export type SaveMachineEvent =
  | { readonly type: "MARK_DIRTY"; readonly baseSha: string }
  /** Editor submits a save; the coordinator queues it (INV-P04). */
  | { readonly type: "SUBMIT"; readonly baseSha: string }
  /** Queue head begins its transport attempt (fresh getRef inside runSave). */
  | { readonly type: "START" }
  /** By-content confirmation — ref observed carrying the commit (INV-P10). */
  | { readonly type: "PUBLISHED"; readonly commitSha?: string; readonly treeSha?: string }
  | { readonly type: "CONFLICT"; readonly details: SaveConflictDetails }
  | { readonly type: "FAILED"; readonly error: BackendWriteError; readonly retryable: boolean }
  | { readonly type: "PARK"; readonly reason: SavePauseReason; readonly waitMs: number | null }
  /**
   * Full-batch rebaseline verdict (boot replay / lease steal / rate wake):
   * resume re-enters the queue against the FRESH head; conflict enters the
   * freeze UI. Never a blind re-dispatch (ADR-0004 rule).
   */
  | { readonly type: "REBASELINE"; readonly outcome: "resume"; readonly baseSha: string }
  | {
      readonly type: "REBASELINE"
      readonly outcome: "conflict"
      readonly details: SaveConflictDetails
    }
  /** Retryable failure re-enters the queue under the backoff policy. */
  | { readonly type: "RETRY" }
  /** Wake (rate window elapsed / re-auth probe ok / manual). */
  | { readonly type: "RESUME" }
  /** Back to editing against a (new) base — conflict resolved or fresh load. */
  | { readonly type: "RESET"; readonly baseSha: string }

/** Codes the controller retries with backoff before pausing for manual retry. */
const RETRYABLE_CODES: ReadonlySet<string> = new Set(["NETWORK", "UNKNOWN"])

export function isRetryableWriteCode(code: string): boolean {
  return RETRYABLE_CODES.has(code)
}

/**
 * The transition table. Illegal pairs return the state UNCHANGED — the
 * machine stays total and side-effect-free; the coordinator only dispatches
 * legal events anyway (asserted by the table unit test).
 */
export function transitionSaveState(
  state: SaveMachineState,
  event: SaveMachineEvent,
): SaveMachineState {
  const paused = (reason: SavePauseReason, waitMs: number | null): SaveMachineState => ({
    phase: "paused",
    reason,
    waitMs,
    baseSha: baseShaOf(state),
  })

  switch (event.type) {
    case "MARK_DIRTY":
      if (state.phase === "editing" || state.phase === "dirty") {
        return { phase: "dirty", baseSha: event.baseSha }
      }
      return state
    case "SUBMIT":
      if (state.phase === "dirty" || state.phase === "editing") {
        return { phase: "queued", baseSha: event.baseSha }
      }
      return state
    case "START":
      return state.phase === "queued" ? { phase: "committing", baseSha: state.baseSha } : state
    case "PUBLISHED":
      if (state.phase === "committing" || state.phase === "queued") {
        return {
          phase: "published",
          ...(event.commitSha === undefined ? {} : { commitSha: event.commitSha }),
          ...(event.treeSha === undefined ? {} : { treeSha: event.treeSha }),
        }
      }
      return state
    case "CONFLICT":
      if (state.phase === "committing") return { phase: "conflict", details: event.details }
      return state
    case "FAILED":
      if (state.phase === "committing") {
        return {
          phase: "failed",
          error: event.error,
          retryable: event.retryable,
          baseSha: state.baseSha,
        }
      }
      return state
    case "PARK":
      if (state.phase === "committing" || state.phase === "queued") {
        return paused(event.reason, event.waitMs)
      }
      // ADR-0004: failed(retryable→backoff cap→paused(manual)) — a retryable
      // failure whose backoff budget is exhausted parks for manual retry.
      if (state.phase === "failed" && state.retryable) {
        return paused(event.reason, event.waitMs)
      }
      return state
    case "REBASELINE":
      if (event.outcome === "resume") {
        if (state.phase === "dirty" || state.phase === "queued" || state.phase === "paused") {
          return { phase: "queued", baseSha: event.baseSha }
        }
        return state
      }
      if (state.phase !== "published") {
        return { phase: "conflict", details: event.details }
      }
      return state
    case "RETRY":
      return state.phase === "failed" && state.retryable
        ? { phase: "queued", baseSha: baseShaOf(state) }
        : state
    case "RESUME":
      return state.phase === "paused" ? { phase: "queued", baseSha: state.baseSha } : state
    case "RESET":
      if (state.phase === "published" || state.phase === "conflict" || state.phase === "failed") {
        return { phase: "editing", baseSha: event.baseSha }
      }
      return state
  }
}

function baseShaOf(state: SaveMachineState): string {
  switch (state.phase) {
    case "editing":
    case "dirty":
    case "queued":
    case "committing":
    case "paused":
    case "failed":
      return state.baseSha
    case "published":
    case "conflict":
      return ""
  }
}
