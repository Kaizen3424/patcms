import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { FREEZE_COPY } from "../copy"
import type { FreezeRow } from "../freeze-model"
import { FreezePanel } from "../freeze-panel"

describe("freeze-panel component", () => {
  const sampleRows: readonly FreezeRow[] = [
    {
      path: ["title"],
      key: "title",
      label: "Title",
      theirsRaw: "Remote Title <script>alert(1)</script>",
      mineRaw: "Local Title",
      theirsValue: "Remote Title <script>alert(1)</script>",
      mineValue: "Local Title",
    },
    {
      path: ["tags"],
      key: "tags",
      label: "Tags",
      theirsRaw: '[\n  "tag-remote"\n]',
      mineRaw: '[\n  "tag-local"\n]',
      theirsValue: ["tag-remote"],
      mineValue: ["tag-local"],
      choice: "theirs",
    },
  ]

  it("renders rows, preserves text safety, and routes choice clicks", () => {
    const onChoose = vi.fn()
    const onStartOver = vi.fn()

    render(
      <FreezePanel
        rows={sampleRows}
        ourFieldPaths={[["description"]]}
        onChoose={onChoose}
        onStartOver={onStartOver}
        supportName="Ada"
      />,
    )

    // Accessible container
    expect(screen.getByRole("region", { name: "Field decisions" })).toBeTruthy()

    // Title and announcement
    expect(screen.getByText(FREEZE_COPY.title)).toBeTruthy()
    expect(screen.getByText(FREEZE_COPY.otherEditsKept)).toBeTruthy()

    // Row 1 checks: text safety (no script tag executed/created as element)
    const scriptText = screen.getByText("Remote Title <script>alert(1)</script>")
    expect(scriptText.tagName).toBe("PRE")

    // Clicking "Keep my version" for row 0
    const keepMineButtons = screen.getAllByRole("button", { name: FREEZE_COPY.keepMine })
    const row0KeepMine = keepMineButtons[0]
    if (row0KeepMine === undefined) throw new Error("expected row0 keep mine button")
    fireEvent.click(row0KeepMine)
    expect(onChoose).toHaveBeenCalledWith(["title"], "mine")

    // Row 2 has choice="theirs": aria-pressed should be true
    const keepTheirsButtons = screen.getAllByRole("button", { name: FREEZE_COPY.keepTheirs })
    const row1KeepTheirs = keepTheirsButtons[1]
    if (row1KeepTheirs === undefined) throw new Error("expected row1 keep theirs button")
    expect(row1KeepTheirs.getAttribute("aria-pressed")).toBe("true")

    // Escape hatch click
    const startOverBtn = screen.getByRole("button", { name: FREEZE_COPY.startOver })
    fireEvent.click(startOverBtn)
    expect(onStartOver).toHaveBeenCalled()
  })

  it("renders degraded branch when degraded is true", () => {
    const onStartOver = vi.fn()

    render(<FreezePanel degraded={true} onStartOver={onStartOver} supportName="Ada" />)

    expect(screen.getByRole("alert")).toBeTruthy()
    expect(screen.getByText(FREEZE_COPY.degradedTitle)).toBeTruthy()
    expect(screen.getByText(/Ask Ada to look at both versions/)).toBeTruthy()

    const startOverBtn = screen.getByRole("button", { name: FREEZE_COPY.startOver })
    fireEvent.click(startOverBtn)
    expect(onStartOver).toHaveBeenCalled()
  })
})
