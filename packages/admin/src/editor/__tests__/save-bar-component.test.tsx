import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { BackendWriteError } from "patcms/advanced"
import { describe, expect, it, vi } from "vitest"
import { ACTION_COPY, RECOVERY_COPY, VALIDATION_COPY } from "../copy"
import { SaveBar } from "../save-bar"
import { describeSaveBar, type SaveBarInput } from "../save-bar-model"

/**
 * Bar rendering: the component is a pure projection of the model, so each case
 * pins which controls appear and that the primary action stays disabled unless
 * a real unblocked diff exists. Copy itself is covered by the banned-word test.
 */

const BASE = "a".repeat(40)

function bar(
  input: Partial<SaveBarInput> = {},
  overrides: Partial<Parameters<typeof SaveBar>[0]> = {},
) {
  const model = describeSaveBar({
    state: { phase: "editing", baseSha: BASE },
    dirty: false,
    justSaved: false,
    justNoop: false,
    leaseLost: false,
    ...input,
  })
  const handlers = {
    onSave: vi.fn(),
    onRetry: vi.fn(),
    onStartOver: vi.fn(),
    onRecheck: vi.fn(),
    onSignOut: vi.fn(),
  }
  render(
    <SaveBar
      model={model}
      supportName="Ada"
      validationBlocked={false}
      {...handlers}
      {...overrides}
    />,
  )
  return handlers
}

describe("save bar component", () => {
  it("enables Save only for a dirty form and wires the action", async () => {
    const handlers = bar({ state: { phase: "dirty", baseSha: BASE }, dirty: true })
    const save = screen.getByRole("button", { name: ACTION_COPY.save })
    expect((save as HTMLButtonElement).disabled).toBe(false)
    await userEvent.setup().click(save)
    expect(handlers.onSave).toHaveBeenCalledOnce()
  })

  it("disables Save while clean and while saving", () => {
    bar()
    const clean = screen.getByRole("button", { name: ACTION_COPY.save })
    expect((clean as HTMLButtonElement).disabled).toBe(true)

    bar({ state: { phase: "committing", baseSha: BASE }, dirty: true })
    const saving = screen.getByRole("button", { name: ACTION_COPY.saving })
    expect((saving as HTMLButtonElement).disabled).toBe(true)
  })

  it("offers retry after a failure", async () => {
    const handlers = bar({
      state: {
        phase: "failed",
        error: new BackendWriteError("NETWORK", "offline"),
        retryable: false,
        baseSha: BASE,
      },
      dirty: true,
    })
    const retry = screen.getByRole("button", { name: ACTION_COPY.retry })
    await userEvent.setup().click(retry)
    expect(handlers.onRetry).toHaveBeenCalledOnce()
  })

  it("offers Check again on a lost lease; Save stays blocked until it returns", async () => {
    const handlers = bar({ leaseLost: true })
    expect(screen.getByTestId("save-bar").getAttribute("data-status")).toBe("leaseLost")
    const check = screen.getByRole("button", { name: RECOVERY_COPY.recheck.label })
    await userEvent.setup().click(check)
    expect(handlers.onRecheck).toHaveBeenCalledOnce()
    const save = screen.getByRole("button", { name: ACTION_COPY.save })
    expect((save as HTMLButtonElement).disabled).toBe(true)
    expect(screen.queryByRole("button", { name: ACTION_COPY.retry })).toBeNull()
  })

  it("shows no Check again while the lease is held", () => {
    bar({ state: { phase: "dirty", baseSha: BASE }, dirty: true })
    expect(screen.queryByRole("button", { name: RECOVERY_COPY.recheck.label })).toBeNull()
  })

  it("offers start-over on a freeze and signs out on an auth pause", async () => {
    const frozen = bar({
      state: {
        phase: "conflict",
        details: { baseHeadSha: BASE, currentHeadSha: BASE, changed: new Map() },
      },
      dirty: true,
    })
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: RECOVERY_COPY.startOver.label }))
    expect(frozen.onStartOver).toHaveBeenCalledOnce()
    expect(screen.queryByRole("button", { name: ACTION_COPY.signOut })).toBeNull()

    const auth = bar({
      state: { phase: "paused", reason: "auth", waitMs: null, baseSha: BASE },
      dirty: true,
    })
    await userEvent.setup().click(screen.getByRole("button", { name: ACTION_COPY.signOut }))
    expect(auth.onSignOut).toHaveBeenCalledOnce()
  })

  it("blocks Save and explains when validation refuses the save locally", () => {
    bar({ state: { phase: "dirty", baseSha: BASE }, dirty: true }, { validationBlocked: true })
    expect(screen.getByText(VALIDATION_COPY.blockedTitle)).toBeDefined()
    const save = screen.getByRole("button", { name: ACTION_COPY.save })
    expect((save as HTMLButtonElement).disabled).toBe(true)
  })

  it("personalizes the named human in the conflict line", () => {
    bar({
      state: {
        phase: "conflict",
        details: { baseHeadSha: BASE, currentHeadSha: BASE, changed: new Map() },
      },
    })
    expect(screen.getByText(/Ask Ada to look/)).toBeDefined()
  })

  it("marks the projected status for styling and tests", () => {
    bar({ state: { phase: "dirty", baseSha: BASE }, dirty: true })
    expect(screen.getByTestId("save-bar").getAttribute("data-status")).toBe("dirty")
  })
})
