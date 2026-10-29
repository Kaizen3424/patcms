import { BackendWriteError, type SaveMachineState } from "@mycms/core"
import { describe, expect, it } from "vitest"
import { describeSaveBar, type SaveBarInput, saveBarStatus } from "../save-bar-model"

/**
 * The sticky bar is a projection, not a state machine: every case below pins
 * one row of the precedence table. The last case is the ADR law that the bar
 * must show "all saved" while the MACHINE is still dirty when the founder
 * undoes back to the base — the machine never un-dirties and we do not invent
 * an event for it.
 */

const BASE = "a".repeat(40)

function input(overrides: Partial<SaveBarInput> = {}): SaveBarInput {
  return {
    state: { phase: "editing", baseSha: BASE },
    dirty: false,
    justSaved: false,
    justNoop: false,
    leaseLost: false,
    ...overrides,
  }
}

function state(value: SaveMachineState): SaveBarInput {
  return input({ state: value })
}

const failure = new BackendWriteError("NETWORK", "offline")

describe("save bar projection", () => {
  it("clean when nothing differs and nothing is in flight", () => {
    expect(saveBarStatus(input())).toBe("clean")
    expect(describeSaveBar(input()).canSave).toBe(false)
  })

  it("dirty enables Save", () => {
    const bar = describeSaveBar(input({ state: { phase: "dirty", baseSha: BASE }, dirty: true }))
    expect(bar.status).toBe("dirty")
    expect(bar.canSave).toBe(true)
    expect(bar.busy).toBe(false)
  })

  it("queued and committing both read as saving and disable Save", () => {
    for (const phase of ["queued", "committing"] as const) {
      const bar = describeSaveBar(state({ phase, baseSha: BASE }))
      expect(bar.status).toBe("saving")
      expect(bar.canSave).toBe(false)
      expect(bar.busy).toBe(true)
    }
  })

  it("published reads as saved, or noop when nothing was written", () => {
    expect(saveBarStatus(state({ phase: "published", commitSha: "c".repeat(40) }))).toBe("saved")
    expect(
      saveBarStatus(input({ state: { phase: "published" }, justNoop: true, justSaved: true })),
    ).toBe("noop")
  })

  it("the saved receipt survives the post-publish reset to a fresh base", () => {
    // The editor resets the machine to `editing` at the new commit, so a bar
    // that only read the phase would fall straight back to "clean" and the
    // founder would never see the confirmation.
    expect(
      saveBarStatus(input({ state: { phase: "editing", baseSha: BASE }, justSaved: true })),
    ).toBe("saved")
    expect(
      saveBarStatus(
        input({ state: { phase: "editing", baseSha: BASE }, justSaved: true, justNoop: true }),
      ),
    ).toBe("noop")
    // ...but a fresh edit typed after the save still owns the bar.
    expect(
      saveBarStatus(
        input({ state: { phase: "dirty", baseSha: BASE }, justSaved: true, dirty: true }),
      ),
    ).toBe("dirty")
  })

  it("a conflict offers start-over and blocks Save", () => {
    const bar = describeSaveBar(
      state({
        phase: "conflict",
        details: { baseHeadSha: BASE, currentHeadSha: "b".repeat(40), changed: new Map() },
      }),
    )
    expect(bar.status).toBe("conflict")
    expect(bar.canStartOver).toBe(true)
    expect(bar.canSave).toBe(false)
  })

  it("freezePending blocks Save and marks status as conflict even with dirty form", () => {
    const bar = describeSaveBar(
      input({
        state: { phase: "dirty", baseSha: BASE },
        dirty: true,
        freezePending: true,
      }),
    )
    expect(bar.status).toBe("conflict")
    expect(bar.canSave).toBe(false)
    expect(bar.canStartOver).toBe(true)
  })

  it("a quota park with a countdown reads as busy; a null window reads as paused", () => {
    expect(
      saveBarStatus(state({ phase: "paused", reason: "quota", waitMs: 30_000, baseSha: BASE })),
    ).toBe("busy")
    const manual = describeSaveBar(
      state({ phase: "paused", reason: "quota", waitMs: null, baseSha: BASE }),
    )
    expect(manual.status).toBe("paused")
    expect(manual.canRetry).toBe(true)
  })

  it("an auth pause maps to the access-key line", () => {
    const bar = describeSaveBar(
      state({ phase: "paused", reason: "auth", waitMs: null, baseSha: BASE }),
    )
    expect(bar.status).toBe("authExpired")
    expect(bar.canSave).toBe(false)
  })

  it("a terminal failure offers retry", () => {
    const bar = describeSaveBar(
      state({ phase: "failed", error: failure, retryable: false, baseSha: BASE }),
    )
    expect(bar.status).toBe("failed")
    expect(bar.canRetry).toBe(true)
    expect(bar.canSave).toBe(false)
  })

  it("a lost lease is a warning that outranks clean", () => {
    expect(saveBarStatus(input({ leaseLost: true }))).toBe("leaseLost")
    expect(describeSaveBar(input({ leaseLost: true })).tone).toBe("warning")
  })

  it("a lost lease offers Check again but never Save (re-acquire clears it)", () => {
    const bar = describeSaveBar(input({ leaseLost: true }))
    expect(bar.canRecheck).toBe(true)
    expect(bar.canSave).toBe(false)
    expect(bar.canRetry).toBe(false)
    expect(bar.canStartOver).toBe(false)
  })

  it("only the lost lease offers Check again", () => {
    expect(describeSaveBar(input()).canRecheck).toBe(false)
    expect(
      describeSaveBar(input({ state: { phase: "dirty", baseSha: BASE }, dirty: true })).canRecheck,
    ).toBe(false)
    expect(
      describeSaveBar(input({ state: { phase: "committing", baseSha: BASE }, dirty: true }))
        .canRecheck,
    ).toBe(false)
  })

  it("a live write outranks a lost lease and a stale local diff", () => {
    expect(
      saveBarStatus(
        input({ state: { phase: "committing", baseSha: BASE }, dirty: true, leaseLost: true }),
      ),
    ).toBe("saving")
  })

  it("edits typed during a save still need one (dirty beats published)", () => {
    expect(
      saveBarStatus(
        input({ state: { phase: "published", commitSha: "c".repeat(40) }, dirty: true }),
      ),
    ).toBe("dirty")
  })

  it("undoing back to the base shows clean while the machine is still dirty", () => {
    // ADR-0004 P2.6: dirtiness is a value-domain fact; the machine is lifecycle.
    const bar = describeSaveBar(input({ state: { phase: "dirty", baseSha: BASE }, dirty: false }))
    expect(bar.status).toBe("clean")
    expect(bar.canSave).toBe(false)
  })
})
