import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { ONBOARDING_COPY } from "../../editor/copy"
import { ProductTourDialog } from "../product-tour"

describe("ProductTourDialog", () => {
  it("renders step 1 when opened", () => {
    render(<ProductTourDialog open={true} onOpenChange={vi.fn()} />)

    expect(screen.getByText(ONBOARDING_COPY.step1Title)).toBeTruthy()
    expect(screen.getByText(ONBOARDING_COPY.step1Body)).toBeTruthy()
    expect(screen.queryByTestId("tour-back-button")).toBeNull()
    expect(screen.getByText(ONBOARDING_COPY.next)).toBeTruthy()
  })

  it("navigates forward and backward through all 4 steps", () => {
    const onComplete = vi.fn()
    const onOpenChange = vi.fn()
    render(<ProductTourDialog open={true} onOpenChange={onOpenChange} onComplete={onComplete} />)

    // Step 1 -> Step 2
    fireEvent.click(screen.getByTestId("tour-next-button"))
    expect(screen.getByText(ONBOARDING_COPY.step2Title)).toBeTruthy()
    expect(screen.getByTestId("tour-back-button")).toBeTruthy()

    // Step 2 -> Step 3
    fireEvent.click(screen.getByTestId("tour-next-button"))
    expect(screen.getByText(ONBOARDING_COPY.step3Title)).toBeTruthy()

    // Step 3 -> Step 4
    fireEvent.click(screen.getByTestId("tour-next-button"))
    expect(screen.getByText(ONBOARDING_COPY.step4Title)).toBeTruthy()
    expect(screen.getByText(ONBOARDING_COPY.finish)).toBeTruthy()

    // Step 4 -> Finish
    fireEvent.click(screen.getByTestId("tour-next-button"))
    expect(onComplete).toHaveBeenCalledOnce()
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it("navigates backward using back button", () => {
    render(<ProductTourDialog open={true} onOpenChange={vi.fn()} />)

    fireEvent.click(screen.getByTestId("tour-next-button"))
    expect(screen.getByText(ONBOARDING_COPY.step2Title)).toBeTruthy()

    fireEvent.click(screen.getByTestId("tour-back-button"))
    expect(screen.getByText(ONBOARDING_COPY.step1Title)).toBeTruthy()
  })

  it("navigates with arrow keys", () => {
    render(<ProductTourDialog open={true} onOpenChange={vi.fn()} />)

    const dialog = screen.getByTestId("product-tour-dialog")
    fireEvent.keyDown(dialog, { key: "ArrowRight" })
    expect(screen.getByText(ONBOARDING_COPY.step2Title)).toBeTruthy()

    fireEvent.keyDown(dialog, { key: "ArrowLeft" })
    expect(screen.getByText(ONBOARDING_COPY.step1Title)).toBeTruthy()
  })

  it("closes when close button is clicked", () => {
    const onOpenChange = vi.fn()
    render(<ProductTourDialog open={true} onOpenChange={onOpenChange} />)

    const closeBtn = screen.getByTestId("close-tour-dialog")
    fireEvent.click(closeBtn)
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})
