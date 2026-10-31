import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { ONBOARDING_COPY } from "../../editor/copy"
import { ConsentPactCard } from "../consent-pact"

describe("ConsentPactCard", () => {
  it("renders refined 3-sentence gallery copy", () => {
    render(<ConsentPactCard onTakeTour={vi.fn()} onDismiss={vi.fn()} />)

    expect(screen.getByText(ONBOARDING_COPY.pactTitle)).toBeTruthy()
    expect(screen.getByText(ONBOARDING_COPY.pactSentence1)).toBeTruthy()
    expect(screen.getByText(ONBOARDING_COPY.pactSentence2)).toBeTruthy()
    expect(screen.getByText(ONBOARDING_COPY.pactSentence3)).toBeTruthy()
  })

  it("calls onTakeTour when tour button clicked", () => {
    const onTakeTour = vi.fn()
    render(<ConsentPactCard onTakeTour={onTakeTour} onDismiss={vi.fn()} />)

    const tourBtn = screen.getByTestId("take-tour-button")
    fireEvent.click(tourBtn)
    expect(onTakeTour).toHaveBeenCalledOnce()
  })

  it("calls onDismiss when dismiss button clicked", () => {
    const onDismiss = vi.fn()
    render(<ConsentPactCard onTakeTour={vi.fn()} onDismiss={onDismiss} />)

    const dismissBtn = screen.getByTestId("dismiss-pact-button")
    fireEvent.click(dismissBtn)
    expect(onDismiss).toHaveBeenCalledOnce()
  })
})
