import { createLogger } from "@mycms/core"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { DiagnosticsModal, formatDiagnosticsReport } from "../diagnostics-modal"

const testLogger = createLogger()

vi.mock("../../runtime/context", () => ({
  useRuntime: () => ({
    config: {
      collections: [],
      site: { name: "Ing & Yve Studio" },
    },
    support: { name: "Milan" },
    repository: { owner: "owner", repo: "site", branch: "main" },
  }),
  useLogger: () => testLogger,
}))

describe("DiagnosticsModal (P5.10)", () => {
  it("formats report with metadata and log entries", () => {
    const logger = createLogger()
    logger.info("Session started", { mode: "preview" })
    logger.warn("Slow query detected for github_pat_12345", { token: "secret" })

    const report = formatDiagnosticsReport(logger.history, {
      site: "Test Site",
      branch: "preview",
      repo: "org/repo",
      supportName: "Milan",
      timestamp: "2026-10-31T12:00:00.000Z",
    })

    expect(report).toContain("Site: Test Site")
    expect(report).toContain("Branch: preview")
    expect(report).toContain("Support contact: Milan")
    expect(report).toContain("Session started")
    expect(report).toContain("Slow query detected for [token]")
    // Token key is masked
    expect(report).toContain('{"token":"[masked]"}')
    expect(report).not.toContain("github_pat_12345")
  })

  it("renders modal when open and copies diagnostics on click", async () => {
    testLogger.info("Studio loaded successfully")
    testLogger.error("Failed image load", { path: "photo.jpg" })

    const onOpenChange = vi.fn()

    // Mock navigator.clipboard
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, {
      clipboard: {
        writeText,
      },
    })

    render(<DiagnosticsModal open={true} onOpenChange={onOpenChange} />)

    expect(screen.getByText("Studio diagnostics")).toBeDefined()
    expect(screen.getByText("Ing & Yve Studio")).toBeDefined()
    expect(screen.getByText("Milan")).toBeDefined()
    expect(screen.getByText("Studio loaded successfully")).toBeDefined()
    expect(screen.getByText("Failed image load")).toBeDefined()

    const copyBtn = screen.getByTestId("copy-diagnostics-button")
    fireEvent.click(copyBtn)

    await waitFor(() => {
      expect(screen.getByText(/Diagnostics copied to clipboard/)).toBeDefined()
      expect(screen.getByText(/You can paste this to Milan/)).toBeDefined()
    })
  })
})
