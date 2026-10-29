import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { REAUTH_COPY } from "../copy"
import { ReauthSheet } from "../reauth-sheet"

describe("ReauthSheet (INV-A01 in-place re-auth)", () => {
  it("renders nothing when open is false", () => {
    const { container } = render(
      <ReauthSheet
        open={false}
        supportName="Ada"
        onReauthenticated={vi.fn()}
        onCancel={vi.fn()}
        onSignOut={vi.fn()}
      />,
    )
    expect(container.firstChild).toBeNull()
  })

  it("renders dialog elements when open is true", () => {
    render(
      <ReauthSheet
        open={true}
        supportName="Ada"
        onReauthenticated={vi.fn()}
        onCancel={vi.fn()}
        onSignOut={vi.fn()}
      />,
    )
    expect(screen.getByRole("dialog")).toBeTruthy()
    expect(screen.getByText(REAUTH_COPY.title)).toBeTruthy()
    expect(screen.getByLabelText(REAUTH_COPY.inputLabel)).toBeTruthy()
    expect(screen.getByText(REAUTH_COPY.submit)).toBeTruthy()
    expect(screen.getByText(REAUTH_COPY.signOut)).toBeTruthy()
    expect(screen.getByText(REAUTH_COPY.cancel)).toBeTruthy()
  })

  it("validates empty submission without calling reauthenticate", async () => {
    const reauth = vi.fn()
    render(
      <ReauthSheet
        open={true}
        supportName="Ada"
        onReauthenticated={vi.fn()}
        onCancel={vi.fn()}
        onSignOut={vi.fn()}
        reauthenticate={reauth}
      />,
    )

    fireEvent.click(screen.getByText(REAUTH_COPY.submit))
    expect(screen.getByRole("alert").textContent).toBe(REAUTH_COPY.errorEmpty)
    expect(reauth).not.toHaveBeenCalled()
  })

  it("handles failed re-auth with inline error", async () => {
    const reauth = vi.fn().mockRejectedValue(new Error("invalid key"))
    render(
      <ReauthSheet
        open={true}
        supportName="Ada"
        onReauthenticated={vi.fn()}
        onCancel={vi.fn()}
        onSignOut={vi.fn()}
        reauthenticate={reauth}
      />,
    )

    const input = screen.getByLabelText(REAUTH_COPY.inputLabel)
    fireEvent.change(input, { target: { value: "invalid-key" } })
    fireEvent.click(screen.getByText(REAUTH_COPY.submit))

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toBe(REAUTH_COPY.errorInvalid)
    })
    expect(reauth).toHaveBeenCalledWith("invalid-key", true)
  })

  it("calls reauthenticate and onReauthenticated on successful entry", async () => {
    const reauth = vi.fn().mockResolvedValue({ repo: "ok" })
    const onDone = vi.fn()
    render(
      <ReauthSheet
        open={true}
        supportName="Ada"
        onReauthenticated={onDone}
        onCancel={vi.fn()}
        onSignOut={vi.fn()}
        reauthenticate={reauth}
      />,
    )

    const input = screen.getByLabelText(REAUTH_COPY.inputLabel)
    fireEvent.change(input, { target: { value: "github_pat_valid123" } })
    fireEvent.click(screen.getByText(REAUTH_COPY.submit))

    await waitFor(() => {
      expect(reauth).toHaveBeenCalledWith("github_pat_valid123", true)
      expect(onDone).toHaveBeenCalledTimes(1)
    })
  })

  it("triggers onSignOut, onCancel, and Escape key", () => {
    const onSignOut = vi.fn()
    const onCancel = vi.fn()
    render(
      <ReauthSheet
        open={true}
        supportName="Ada"
        onReauthenticated={vi.fn()}
        onCancel={onCancel}
        onSignOut={onSignOut}
      />,
    )

    fireEvent.click(screen.getByText(REAUTH_COPY.signOut))
    expect(onSignOut).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByText(REAUTH_COPY.cancel))
    expect(onCancel).toHaveBeenCalledTimes(1)

    fireEvent.keyDown(window, { key: "Escape" })
    expect(onCancel).toHaveBeenCalledTimes(2)
  })
})
