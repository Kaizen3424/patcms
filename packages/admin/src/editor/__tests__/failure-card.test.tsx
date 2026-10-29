import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { FAILURE_CARD_COPY, FAILURE_COPY, personalize } from "../copy"
import { FailureCard } from "../failure-card"

describe("FailureCard (INV-A02 docked failure card)", () => {
  it("renders classified copy, reassurance, and calls onCopyMessage", () => {
    const onCopy = vi.fn()
    const onRetry = vi.fn()
    render(
      <FailureCard
        errorCode="SCOPE"
        httpStatus={403}
        supportName="Milan"
        onRetry={onRetry}
        onCopyMessage={onCopy}
        copied={false}
      />,
    )

    const scopeCopy = FAILURE_COPY.SCOPE ??
      FAILURE_COPY.UNKNOWN ?? {
        title: "Cannot save to this place.",
        detail: "Ask {name} to check your access key permissions.",
      }
    const expected = personalize(scopeCopy, "Milan")
    expect(screen.getByText(expected.title)).toBeTruthy()
    if (expected.detail) {
      expect(screen.getByText(expected.detail)).toBeTruthy()
    }
    expect(screen.getByText(FAILURE_CARD_COPY.reassurance)).toBeTruthy()

    // Retry button calls onRetry
    fireEvent.click(screen.getByText(FAILURE_CARD_COPY.retry))
    expect(onRetry).toHaveBeenCalledTimes(1)

    // Copy message button calls onCopyMessage
    fireEvent.click(screen.getByText("Copy message for Milan"))
    expect(onCopy).toHaveBeenCalledTimes(1)
  })

  it("renders checkKey button on AUTH_EXPIRED", () => {
    const onCheckKey = vi.fn()
    render(
      <FailureCard
        errorCode="AUTH_EXPIRED"
        httpStatus={401}
        supportName="Milan"
        onCheckKey={onCheckKey}
        onCopyMessage={vi.fn()}
        copied={false}
      />,
    )

    fireEvent.click(screen.getByText(FAILURE_CARD_COPY.checkKey))
    expect(onCheckKey).toHaveBeenCalledTimes(1)
  })

  it("shows copied feedback when copied is true", () => {
    render(
      <FailureCard errorCode="NETWORK" supportName="Milan" onCopyMessage={vi.fn()} copied={true} />,
    )

    expect(screen.getByText(FAILURE_CARD_COPY.copied)).toBeTruthy()
  })

  it("renders technical details in collapsible drawer when context is provided", () => {
    render(
      <FailureCard
        errorCode="NOT_FOUND"
        httpStatus={404}
        supportName="Ada"
        onCopyMessage={vi.fn()}
        copied={false}
        technicalContext={{
          entryTitle: "Desk",
          filePath: "src/content/products/desk.json",
          branch: "main",
          repo: "shop/site",
          baseSha: "deadbeef",
          changedFields: ["title", "price"],
        }}
      />,
    )

    expect(screen.getByText("Technical details for Ada")).toBeTruthy()
    expect(screen.getByText(/Error: NOT_FOUND \(HTTP 404\)/)).toBeTruthy()
    expect(screen.getByText(/Entry: src\/content\/products\/desk\.json/)).toBeTruthy()
    expect(screen.getByText(/Changed fields: title, price/)).toBeTruthy()
  })
})
