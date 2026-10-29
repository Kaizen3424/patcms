import { fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { RateLimitTimer } from "../rate-limit-timer"

describe("RateLimitTimer (INV-N01 countdown UI)", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("renders the initial countdown and fires manual resume on button click", () => {
    const onResume = vi.fn()
    const now = 1_700_000_000_000
    render(<RateLimitTimer waitMs={30_000} onManualResume={onResume} now={() => now} />)

    // Visual ticker contains 30 seconds
    expect(screen.getByText("Resuming in 30 seconds...")).toBeTruthy()

    // Accessible live region announces start
    const polite = screen.getByRole("status")
    expect(polite.textContent).toContain(
      "Saving is paused because the site is busy. Resuming in about 30 seconds.",
    )

    // Clicking "Try saving now" calls onResume
    fireEvent.click(screen.getByText("Try saving now"))
    expect(onResume).toHaveBeenCalledTimes(1)
  })

  it("advances seconds and announces the 10-second milestone", async () => {
    let now = 1_700_000_000_000
    render(<RateLimitTimer waitMs={15_000} onManualResume={vi.fn()} now={() => now} />)

    expect(screen.getByText("Resuming in 15 seconds...")).toBeTruthy()

    // Advance clock by 5 seconds
    now += 5000
    await vi.advanceTimersByTimeAsync(5000)

    expect(screen.getByText("Resuming in 10 seconds...")).toBeTruthy()
    expect(screen.getByRole("status").textContent).toContain("Resuming in 10 seconds.")
  })
})
