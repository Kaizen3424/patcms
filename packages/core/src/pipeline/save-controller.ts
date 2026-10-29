/**
 * Save coordinator — IO orchestration above the state machine (P2.5):
 * one-flight queue (INV-P04) · draft written BEFORE the first network call,
 * deleted only after the ref is observed to carry the commit (INV-P11/P10) ·
 * self-rebase when the conflict predicate is satisfied, or a clean field
 * merge exists (INV-P05; ADR-0004 "queued saves don't false-conflict after
 * own commit") · rate parking with EVENT-driven resume (INV-N01/P11) ·
 * auth pause halting the drain until `resumeAuth()` (INV-A01/A03; drafts
 * retained — ADR-0002 orthogonality) · retryable backoff cap → paused(manual)
 * (ADR-0004).
 *
 * The cross-tab lease is deliberately NOT here (ADR-0004: UX serialization
 * only — the CAS stays the sole correctness mechanism); the editor (P2.6)
 * acquires it and runs the full rebaseline (`adjudicateDraft`) on steal.
 * Progression is callback-driven (`subscribe`); the only timers are the
 * injected wakes (rate window, backoff).
 */

import type { CommitChangeSet, GitBackend } from "../backend/types"
import { BackendWriteError } from "../backend/write-errors"
import type { DraftRecord, DraftStore, SaveDraftPayload } from "../drafts"
import { decodeUtf8, encodeUtf8 } from "../safety/encoding"
import type { Logger } from "../safety/logger"
import { type JsonValue, parseUntrustedJson } from "../safety/untrusted-json"
import { computeDirtyPaths, fieldPathKey } from "./field-paths"
import { type ConflictEngineResult, type OurWrite, resolveConflictPaths } from "./invariant-engine"
import { createOneFlightQueue, type OneFlightQueue } from "./one-flight"
import { rebase } from "./rebase"
import {
  runSave,
  type SaveConflictDetails,
  type SaveDriverInput,
  type SaveVerdict,
} from "./save-driver"
import {
  isRetryableWriteCode,
  type SaveMachineEvent,
  type SaveMachineState,
  type SavePauseReason,
  transitionSaveState,
} from "./save-machine"

export interface SaveCoordinatorOptions {
  readonly backend: GitBackend
  readonly branch: string
  readonly drafts: DraftStore
  /** Epoch-ms clock (deterministic tests inject). Default Date.now. */
  readonly now?: () => number
  /** Single scheduled wake seam (rate window + backoff). Default setTimeout. */
  readonly scheduleWake?: (waitMs: number, wake: () => void) => void
  /** After-write failure re-probe hook (INV-A03) — forwarded to runSave. */
  readonly onAfterWriteFailure?: (error: BackendWriteError) => void
  readonly logger?: Logger
  /** Backoff delays for retryable failures (ms). Default [1000, 4000]. */
  readonly retryDelaysMs?: readonly number[]
  /** Auto-rebase re-entries per save (predicate satisfied / clean merge). Default 1. */
  readonly maxSelfRebases?: number
}

export interface SaveRequest {
  readonly draftKey: string
  readonly changes: CommitChangeSet
  readonly message?: string
  /**
   * Written pre-network under `draftKey` (INV-P11). Its `filePath` must be the
   * (single) write path of `changes` — v1 saves are one file; media tiles join
   * at P4 with per-tile records.
   */
  readonly draft?: SaveDraftPayload
  /** Base sha the form was loaded against (machine bookkeeping; no extra read). */
  readonly baseSha?: string
}

export interface CoordinatorSnapshot {
  readonly states: ReadonlyMap<string, SaveMachineState>
}

export interface SaveCoordinator {
  /** Queues a save; resolves on its TERMINAL verdict (parked keeps pending). */
  save(request: SaveRequest): Promise<SaveVerdict>
  /** Manual resume for a parked save (no guidance / backoff cap reached). */
  resume(draftKey: string): void
  /** Clears the auth pause after a successful re-auth + re-probe (INV-A01). */
  resumeAuth(): void
  /** Editor keystroke: `editing|dirty` → `dirty`; a no-op everywhere else. */
  markDirty(draftKey: string, baseSha: string): void
  /**
   * Back to `editing` against a (new) base (ADR-0004 P2.6 pin). Legal from
   * every phase except `committing`. Used on mount, after a published/noop
   * verdict, and when the founder starts over from the latest version.
   */
  reset(draftKey: string, baseSha: string): void
  /**
   * Abandons a save that is NOT committing: resolves `cancelled` and returns
   * the machine to `editing`. The draft is retained (crash-safety record).
   */
  cancel(draftKey: string): void
  /** True between a 401 pause and `resumeAuth()` — save() refuses pre-network. */
  readonly authPaused: boolean
  state(draftKey: string): SaveMachineState | undefined
  subscribe(listener: (snapshot: CoordinatorSnapshot) => void): () => void
}

/**
 * A second `save()` for a draftKey whose previous job is still live. Raised
 * instead of overwriting the job registration: the one-flight queue would
 * otherwise strand the first promise forever (ADR-0004 P2.6 pin).
 */
export class SaveInFlightError extends Error {
  readonly draftKey: string

  constructor(draftKey: string) {
    super(`a save is already in progress for ${draftKey}`)
    this.name = "SaveInFlightError"
    this.draftKey = draftKey
  }
}

interface Job {
  readonly key: string
  request: SaveRequest
  resolve: (verdict: SaveVerdict) => void
  gate: WakeGate
  rebaseBudget: number
  backoffIndex: number
  /** Set by `cancel()`; checked at attempt entry and after every gate wait. */
  cancelRequested: boolean
  /**
   * P2.9 (ADR-0004 appendix): set when a disjoint auto-merge replaced the
   * write bytes — the editor must adopt the MERGED bytes as its post-publish
   * base, or its next save would silently revert the partner's change.
   */
  reconciledRaw?: string
}

/** Coalescing wake gate (see {@link createWakeGate}). */
interface WakeGate {
  wait(): Promise<void>
  wake(): void
}

/**
 * Coalescing wake gate: a `wake()` that arrives between waits is not lost —
 * the NEXT wait consumes it. Manual resumes during a committing phase land on
 * the next pause instead of vanishing.
 */
function createWakeGate() {
  let pending = false
  let release: (() => void) | undefined
  return {
    wait(): Promise<void> {
      if (pending) {
        pending = false
        return Promise.resolve()
      }
      return new Promise<void>((resolve) => {
        release = resolve
      })
    },
    wake(): void {
      pending = true
      release?.()
    },
  }
}

export function createSaveCoordinator(options: SaveCoordinatorOptions): SaveCoordinator {
  const now = options.now ?? (() => Date.now())
  const scheduleWake = options.scheduleWake ?? defaultScheduleWake
  const retryDelays = options.retryDelaysMs ?? [1_000, 4_000]
  const maxSelfRebases = options.maxSelfRebases ?? 1
  const queue: OneFlightQueue = createOneFlightQueue()
  const states = new Map<string, SaveMachineState>()
  const listeners = new Set<(snapshot: CoordinatorSnapshot) => void>()
  const jobs = new Map<string, Job>()
  let authPaused = false

  const emit = (): void => {
    const snapshot: CoordinatorSnapshot = { states: new Map(states) }
    for (const listener of listeners) listener(snapshot)
  }

  const baseShaOfRequest = (request: SaveRequest): string =>
    request.baseSha ?? request.draft?.baseSha ?? ""

  const dispatch = (key: string, event: SaveMachineEvent): void => {
    const current = states.get(key) ?? { phase: "editing", baseSha: "" }
    const next = transitionSaveState(current, event)
    if (next === current) {
      options.logger?.debug("save coordinator: transition no-op", { key, event: event.type })
      return
    }
    states.set(key, next)
    options.logger?.debug("save coordinator: transition", {
      key,
      from: current.phase,
      to: next.phase,
    })
    emit()
  }

  const writeDraft = async (request: SaveRequest): Promise<boolean> => {
    if (request.draft === undefined) return true
    const record: DraftRecord<SaveDraftPayload> = {
      key: request.draftKey,
      value: request.draft,
      savedAt: new Date(now()).toISOString(),
    }
    try {
      // INV-P11: the draft EXISTS before the save's first network call — the
      // queue is only entered after this write succeeds.
      await options.drafts.put(record)
      return true
    } catch (error) {
      options.logger?.error("save coordinator: draft store write failed — save refused", {
        key: request.draftKey,
        message: error instanceof Error ? error.message : "unknown",
      })
      return false
    }
  }

  const pauseReason = (code: string): SavePauseReason => {
    if (code === "RATE_LIMIT") return "quota"
    if (code === "AUTH_EXPIRED") return "auth"
    return "network"
  }

  /**
   * Cancellation is observed ONLY at boundaries where no transport call is in
   * flight (attempt entry, and after each park/backoff gate wait), so an
   * abandoned save can never race a write that cannot be un-sent. Resolving
   * `cancelled` returns the machine to `editing` and keeps the draft.
   */
  const cancelledVerdict = (job: Job): { readonly kind: "cancelled" } | undefined => {
    if (!job.cancelRequested) return undefined
    dispatch(job.key, { type: "RESET", baseSha: baseShaOfRequest(job.request) })
    return { kind: "cancelled" }
  }

  /**
   * One transport attempt + verdict handling. Returns `undefined` when the
   * job must LOOP (parked / retrying / rebasing); a verdict = terminal.
   */
  const attemptOnce = async (job: Job): Promise<SaveVerdict | undefined> => {
    const cancelledAtEntry = cancelledVerdict(job)
    if (cancelledAtEntry !== undefined) return cancelledAtEntry
    const request = job.request
    dispatch(job.key, { type: "START" })
    const input: SaveDriverInput = {
      backend: options.backend,
      branch: options.branch,
      changes: request.changes,
      ...(request.message === undefined ? {} : { message: request.message }),
      ...(options.onAfterWriteFailure === undefined
        ? {}
        : { onAfterWriteFailure: options.onAfterWriteFailure }),
      now,
    }
    const verdict = await runSave(input)
    options.logger?.debug("save coordinator: verdict", { key: job.key, kind: verdict.kind })

    if (verdict.kind === "published") {
      // Ref observed carrying the commit (by content) — NOW the draft may die.
      if (request.draft !== undefined) await options.drafts.delete(job.key)
      dispatch(job.key, {
        type: "PUBLISHED",
        commitSha: verdict.commitSha,
        ...(verdict.treeSha === undefined ? {} : { treeSha: verdict.treeSha }),
      })
      return attachReconciliation(verdict, job, verdict.commitSha)
    }
    if (verdict.kind === "noop") {
      // Nothing to write — content already live; the draft has no future use.
      if (request.draft !== undefined) await options.drafts.delete(job.key)
      dispatch(job.key, { type: "PUBLISHED" })
      // A noop after an auto-merge rebase means the MERGED bytes are already
      // live byte-equal; the editor still needs them as its new base. The
      // request's baseSha is the head this attempt was pinned to (fresh, per
      // the fresh-binding law) — the honest reconciled coordinate.
      if (job.reconciledRaw !== undefined) {
        return {
          kind: "noop",
          reconciliation: {
            reconciledRaw: job.reconciledRaw,
            reconciledSha: baseShaOfRequest(request),
          },
        }
      }
      return verdict
    }
    if (verdict.kind === "parked") {
      dispatch(job.key, { type: "PARK", reason: "quota", waitMs: verdict.waitMs })
      if (verdict.waitMs !== null) scheduleWake(verdict.waitMs, job.gate.wake)
      await job.gate.wait() // event-driven resume (INV-N01); null → manual
      const cancelledAfterPark = cancelledVerdict(job)
      if (cancelledAfterPark !== undefined) return cancelledAfterPark
      dispatch(job.key, { type: "RESUME" })
      return undefined
    }
    if (verdict.kind === "conflict") {
      return await adjudicateConflict(job, verdict.details)
    }
    // Defensive: the driver never returns `cancelled` (it is produced only by
    // cancelledVerdict at the gate boundaries above), but the union demands a
    // branch and an honest settle beats a cast.
    if (verdict.kind === "cancelled") return verdict
    // failed —
    if (verdict.error.code === "AUTH_EXPIRED") {
      // INV-A01: the drain freezes here (no further network until the admin
      // re-probes and calls resumeAuth); queued jobs stay behind the parked
      // head; drafts retained (ADR-0002 orthogonality).
      authPaused = true
      dispatch(job.key, { type: "PARK", reason: "auth", waitMs: null })
      await job.gate.wait()
      const cancelledAfterAuth = cancelledVerdict(job)
      if (cancelledAfterAuth !== undefined) return cancelledAfterAuth
      dispatch(job.key, { type: "RESUME" })
      return undefined
    }
    if (isRetryableWriteCode(verdict.error.code)) {
      if (job.backoffIndex < retryDelays.length) {
        const delay = retryDelays[job.backoffIndex] as number
        job.backoffIndex += 1
        dispatch(job.key, { type: "FAILED", error: verdict.error, retryable: true })
        dispatch(job.key, { type: "RETRY" })
        scheduleWake(delay, job.gate.wake)
        await job.gate.wait()
        const cancelledInBackoff = cancelledVerdict(job)
        if (cancelledInBackoff !== undefined) return cancelledInBackoff
        return undefined
      }
      // Backoff cap exhausted → paused(manual) per ADR-0004.
      dispatch(job.key, { type: "PARK", reason: pauseReason(verdict.error.code), waitMs: null })
      await job.gate.wait()
      const cancelledAtCap = cancelledVerdict(job)
      if (cancelledAtCap !== undefined) return cancelledAtCap
      job.backoffIndex = 0 // manual resume grants a fresh budget
      dispatch(job.key, { type: "RESUME" })
      return undefined
    }
    dispatch(job.key, { type: "FAILED", error: verdict.error, retryable: false })
    return verdict
  }

  /** Queue-slot loop: parks/retries/rebases loop; terminal verdicts resolve. */
  const runJob = async (job: Job): Promise<void> => {
    for (;;) {
      const verdict = await attemptOnce(job)
      if (verdict === undefined) continue
      // Deregister BEFORE resolving: a `finally`-based delete on the queue
      // promise could otherwise remove a NEWER job registered for the same
      // draftKey in the microtask gap (the same class of bug as overwriting).
      jobs.delete(job.key)
      job.resolve(verdict)
      return
    }
  }

  /**
   * Conflict adjudication (INV-P05 + ADR-0004): FRESH challenge reads; a
   * SATISFIED predicate (or a disjoint field merge) self-rebases by
   * re-entering the CAS against the current head; otherwise the conflict
   * freezes with details (+ rebase preview / verdicts) for the freeze UI.
   */
  const adjudicateConflict = async (
    job: Job,
    details: SaveConflictDetails,
  ): Promise<SaveVerdict | undefined> => {
    if (details.currentHeadSha.length === 0) {
      // Challenge reads failed — honest conflict; re-probes on the next save.
      dispatch(job.key, { type: "CONFLICT", details })
      return { kind: "conflict", details }
    }
    const engine = await adjudicateEngine(job, details)
    if (engine === undefined) {
      // Challenge machinery itself failed — freeze conservatively.
      dispatch(job.key, { type: "CONFLICT", details })
      return { kind: "conflict", details }
    }
    if (engine.sameFilePredicateSatisfied) {
      if (job.rebaseBudget > 0) {
        job.rebaseBudget -= 1
        job.request = { ...job.request, baseSha: details.currentHeadSha }
        return undefined // self-rebase: fresh getRef pins the new head
      }
      dispatch(job.key, { type: "CONFLICT", details })
      return { kind: "conflict", details }
    }
    const merge = await mergePreview(job, engine, details)
    const enriched: SaveConflictDetails = {
      ...details,
      ...(merge === undefined ? {} : { merge }),
      verdicts: engine.verdicts,
    }
    if (merge !== undefined && merge.frozenFieldPaths.length === 0 && job.rebaseBudget > 0) {
      // Disjoint auto-merge (non-overlapping fields) — commit the merged
      // bytes; announcements surface with the publish (founder-cry law).
      // P2.9: record the reconciled bytes so the published verdict carries
      // them (the editor's base would otherwise revert the partner's change).
      job.rebaseBudget -= 1
      job.reconciledRaw = merge.mergedRaw
      job.request = {
        ...job.request,
        changes: replaceWriteBytes(job.request.changes, merge.path, merge.mergedRaw),
        baseSha: details.currentHeadSha,
      }
      return undefined
    }
    dispatch(job.key, { type: "CONFLICT", details: enriched })
    return { kind: "conflict", details: enriched }
  }

  const adjudicateEngine = async (
    job: Job,
    details: SaveConflictDetails,
  ): Promise<ConflictEngineResult | undefined> => {
    try {
      const [headTree, baseTree] = await Promise.all([
        options.backend.readTree(options.branch, details.currentHeadSha),
        options.backend.readTree(options.branch, details.baseHeadSha),
      ])
      if (headTree.kind !== "tree" || baseTree.kind !== "tree") return undefined
      const headEntries = new Map(headTree.tree.entries.map((entry) => [entry.path, entry]))
      const baseEntries = new Map(baseTree.tree.entries.map((entry) => [entry.path, entry]))
      const writes = new Map<string, OurWrite>()
      for (const write of [
        ...(job.request.changes.adds ?? []),
        ...(job.request.changes.updates ?? []),
      ]) {
        writes.set(write.path, { bytes: write.bytes, mode: "100644" })
      }
      const payload = job.request.draft
      return await resolveConflictPaths({
        changed: details.changed,
        headEntries,
        baseEntries,
        ourWrites: writes,
        ourDeletes: new Set(job.request.changes.deletes ?? []),
        readFreshBlob: async (path, tuple) => {
          const file = await options.backend.readFile(options.branch, path, tuple.sha)
          return file.kind === "file" ? file.file.bytes : undefined
        },
        baseRawBytes: (path) =>
          payload !== undefined && payload.filePath === path
            ? encodeUtf8(payload.baseRaw)
            : undefined,
      })
    } catch (error) {
      options.logger?.warn("save coordinator: engine adjudication failed", {
        key: job.key,
        message: error instanceof Error ? error.message : "unknown",
      })
      return undefined
    }
  }

  /** rebase() preview for the freeze UI (ADR-0004 field-granular machinery). */
  const mergePreview = async (
    job: Job,
    engine: ConflictEngineResult,
    details: SaveConflictDetails,
  ): Promise<SaveConflictDetails["merge"]> => {
    const payload = job.request.draft
    if (payload === undefined) return undefined
    const tuple = details.changed.get(payload.filePath)
    if (tuple === undefined) return undefined
    try {
      const file = await options.backend.readFile(options.branch, payload.filePath, tuple.sha)
      if (file.kind !== "file") return undefined
      const remoteRaw = decodeUtf8(file.file.bytes)
      const oldBase = parseJsonValue(payload.baseRaw)
      const formValue = parseJsonValue(safeStringify(payload.formValue))
      if (oldBase === undefined || formValue === undefined) return undefined
      const merged = rebase({
        formValue,
        dirtyPaths: new Set(computeDirtyPaths(formValue, oldBase)),
        oldBase,
        oldRaw: payload.baseRaw,
        newBaseRaw: remoteRaw,
      })
      if (!merged.ok) return undefined
      const frozen = new Set(merged.conflicts.map(fieldPathKey))
      return {
        path: payload.filePath,
        mergedRaw: merged.mergedRaw,
        frozenFieldPaths: merged.conflicts,
        warnings: merged.warnings,
        engineNotes: engine.notes,
        remoteRaw,
        ourFieldPaths: computeDirtyPaths(formValue, oldBase).filter(
          (dirtyPath) => !frozen.has(fieldPathKey(dirtyPath)),
        ),
      }
    } catch {
      return undefined
    }
  }

  /**
   * P2.9: when a disjoint auto-merge replaced the write bytes, attach the
   * reconciled payload so the editor adopts the merged base (ADR-0004
   * appendix). Ordinary publishes pass through untouched.
   */
  const attachReconciliation = <T extends SaveVerdict>(
    verdict: T,
    job: Job,
    reconciledSha: string,
  ): SaveVerdict => {
    if (job.reconciledRaw === undefined) return verdict
    if (verdict.kind === "published") {
      return {
        ...verdict,
        reconciliation: { reconciledRaw: job.reconciledRaw, reconciledSha },
      }
    }
    return verdict
  }

  return {
    async save(request: SaveRequest): Promise<SaveVerdict> {
      if (jobs.has(request.draftKey)) {
        // ADR-0004 P2.6 pin: never overwrite a live job registration — the
        // one-flight queue would strand the first promise forever.
        return Promise.reject(new SaveInFlightError(request.draftKey))
      }
      if (authPaused) {
        // INV-A01: no requests inside the auth-paused window — refuse BEFORE
        // any network; the editor keeps its own edits (and may persist them
        // itself through the draft store).
        return {
          kind: "failed",
          error: new BackendWriteError(
            "AUTH_EXPIRED",
            "authentication paused — re-probe required before saving",
          ),
        }
      }
      if (!(await writeDraft(request))) {
        // INV-P11: a save whose crash-protection write failed never touches
        // the network (zero silent-failure paths).
        return {
          kind: "failed",
          error: new BackendWriteError("UNKNOWN", "draft store unavailable — save refused"),
        }
      }
      return new Promise<SaveVerdict>((resolve) => {
        const job: Job = {
          key: request.draftKey,
          request,
          resolve,
          gate: createWakeGate(),
          rebaseBudget: maxSelfRebases,
          backoffIndex: 0,
          cancelRequested: false,
        }
        jobs.set(request.draftKey, job)
        dispatch(request.draftKey, {
          type: "SUBMIT",
          baseSha: baseShaOfRequest(request),
        })
        void queue.submit(() => runJob(job))
      })
    },

    resume(draftKey: string): void {
      const state = states.get(draftKey)
      if (state === undefined || state.phase !== "paused") return
      const job = jobs.get(draftKey)
      if (job === undefined) return
      job.gate.wake()
    },

    resumeAuth(): void {
      if (!authPaused) return
      authPaused = false
      // The parked head resumes the frozen drain; queued jobs follow in order.
      for (const [key, job] of jobs) {
        const state = states.get(key)
        if (state?.phase === "paused" && state.reason === "auth") job.gate.wake()
      }
    },

    get authPaused(): boolean {
      return authPaused
    },

    markDirty(draftKey: string, baseSha: string): void {
      dispatch(draftKey, { type: "MARK_DIRTY", baseSha })
    },

    reset(draftKey: string, baseSha: string): void {
      dispatch(draftKey, { type: "RESET", baseSha })
    },

    cancel(draftKey: string): void {
      const job = jobs.get(draftKey)
      if (job === undefined) return
      // A live transport write cannot be un-sent; cancellation only applies to
      // queued/parked/backoff states, where the job is waiting on its gate.
      if (states.get(draftKey)?.phase === "committing") return
      job.cancelRequested = true
      job.gate.wake()
    },

    state(draftKey: string): SaveMachineState | undefined {
      return states.get(draftKey)
    },

    subscribe(listener: (snapshot: CoordinatorSnapshot) => void): () => void {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

/** Swap one write path's bytes with the merged result (auto-merge re-entry). */
function replaceWriteBytes(
  changes: CommitChangeSet,
  path: string,
  mergedRaw: string,
): CommitChangeSet {
  const bytes = encodeUtf8(mergedRaw)
  if (changes.updates?.some((write) => write.path === path)) {
    return {
      ...changes,
      updates: changes.updates.map((write) => (write.path === path ? { path, bytes } : write)),
    }
  }
  if (changes.adds?.some((write) => write.path === path)) {
    return {
      ...changes,
      adds: changes.adds.map((write) => (write.path === path ? { path, bytes } : write)),
    }
  }
  return changes
}

function defaultScheduleWake(waitMs: number, wake: () => void): void {
  const timer = setTimeout(wake, waitMs)
  if (typeof timer === "object" && timer !== null && "unref" in timer) {
    ;(timer as { unref?: () => void }).unref?.()
  }
}

function parseJsonValue(raw: string): JsonValue | undefined {
  const parsed = parseUntrustedJson(raw)
  return parsed.ok ? parsed.value : undefined
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? "null"
  } catch {
    return "null"
  }
}
