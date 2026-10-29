/**
 * Sticky save bar model (P2.6) — a PURE projection of two facts:
 *
 *  1. the save machine's phase (lifecycle truth), and
 *  2. the VALUE-domain dirty set (`computeDirtyPaths(formValue, baseValue)`).
 *
 * ADR-0004 P2.6 pin: "dirtiness is a VALUE-domain fact; lifecycle is the
 * machine. The save bar consumes both." A founder who undoes back to the base
 * sees `clean` while the machine may still be `dirty` — the machine never
 * un-dirties, and no event is invented for it.
 *
 * Precedence is deliberate: anything that BLOCKS a save outranks anything that
 * merely describes the edit state, an in-flight write outranks a stale local
 * diff (the write will land; the diff is re-evaluated after it settles), and a
 * fresh edit outranks the receipt of the save that preceded it.
 */
import type { SaveMachineState } from "@mycms/core"
import type { SaveBarStatus } from "./copy"

export type SaveBarTone = "neutral" | "positive" | "warning" | "danger"

export interface SaveBarInput {
  /** Coordinator state for this entry; `undefined` before the first dispatch. */
  readonly state: SaveMachineState | undefined
  /** `computeDirtyPaths(formValue, baseValue).length > 0`. */
  readonly dirty: boolean
  /** The last verdict published in this mount (drives the "Saved." receipt). */
  readonly justSaved: boolean
  /** The last verdict was a no-op (nothing to write). */
  readonly justNoop: boolean
  /** Cross-tab lease was displaced (`lease.onLost`). */
  readonly leaseLost: boolean
  /** Freeze UI has undecided conflict rows (Save stays blocked until decided). */
  readonly freezePending?: boolean
}

export interface SaveBarModel {
  readonly status: SaveBarStatus
  readonly tone: SaveBarTone
  /** The Save button is enabled only for a real, unblocked diff. */
  readonly canSave: boolean
  /** "Try saving again" is offered after a failure or a manual pause. */
  readonly canRetry: boolean
  /** "Start over from the latest version" is offered on a freeze. */
  readonly canStartOver: boolean
  /** "Check again" re-acquires a lost lease (ADR-0004 P2.7 clearing law). */
  readonly canRecheck: boolean
  /** True while a transport attempt is live or queued (submit stays disabled). */
  readonly busy: boolean
}

const TONES: Readonly<Record<SaveBarStatus, SaveBarTone>> = {
  clean: "positive",
  dirty: "neutral",
  saving: "neutral",
  saved: "positive",
  noop: "positive",
  conflict: "danger",
  busy: "warning",
  paused: "warning",
  authExpired: "danger",
  failed: "danger",
  leaseLost: "warning",
}

/**
 * Projects the bar. Statuses that imply a blocked save win; `dirty` beats
 * `published` because edits typed WHILE a save was committing still need one.
 */
export function saveBarStatus(input: SaveBarInput): SaveBarStatus {
  const phase = input.state?.phase

  if (phase === "paused" && input.state?.reason === "auth") return "authExpired"
  if (phase === "failed") return "failed"
  if (phase === "conflict" || input.freezePending) return "conflict"
  if (phase === "queued" || phase === "committing") return "saving"
  if (phase === "paused") {
    return input.state?.reason === "quota" && input.state.waitMs !== null ? "busy" : "paused"
  }
  if (input.leaseLost) return "leaseLost"
  if (input.dirty) return "dirty"
  // The receipt outlives the machine: the editor resets to a fresh base after
  // every published verdict (ADR-0004 RESET widening), so "Saved." comes from
  // the verdict that just landed, not from a phase that reset already erased.
  if (input.justSaved) return input.justNoop ? "noop" : "saved"
  if (phase === "published") return input.justNoop ? "noop" : "saved"
  return "clean"
}

export function describeSaveBar(input: SaveBarInput): SaveBarModel {
  const status = saveBarStatus(input)
  return {
    status,
    tone: TONES[status],
    canSave: status === "dirty" && !input.freezePending,
    canRetry: status === "failed" || status === "paused",
    canStartOver: status === "conflict",
    // A lost lease clears only via re-acquire (manual re-check or an observed
    // foreign release); Save stays disabled until the hold is actually won.
    canRecheck: status === "leaseLost",
    busy: status === "saving",
  }
}
