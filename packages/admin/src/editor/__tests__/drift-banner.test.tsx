import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { DRIFT_COPY } from "../copy"
import { DriftBanner } from "../drift-banner"
import { DriftDrawer } from "../drift-drawer"

describe("Drift UI", () => {
  const MOCK_DRIFT = {
    remoteSha: "3333333333333333333333333333333333333333",
    detectedAt: new Date(Date.now() - 60000).toISOString(),
  }

  describe("DriftBanner", () => {
    it("reserves a 24px container when no drift is detected", () => {
      render(<DriftBanner drift={undefined} supportName="Milan" onOpenDrawer={vi.fn()} />)

      const container = screen.getByTestId("drift-banner-container")
      expect(container.className).toContain("h-6")
      expect(screen.queryByTestId("drift-banner-active")).toBeNull()
    })

    it("renders amber banner and triggers onOpenDrawer when clicked", () => {
      const onOpenDrawer = vi.fn()
      render(<DriftBanner drift={MOCK_DRIFT} supportName="Milan" onOpenDrawer={onOpenDrawer} />)

      const banner = screen.getByTestId("drift-banner-active")
      expect(banner).toBeTruthy()
      expect(banner.textContent).toContain("This page's files changed (Milan")

      const btn = screen.getByTestId("drift-what-changed-button")
      fireEvent.click(btn)
      expect(onOpenDrawer).toHaveBeenCalledOnce()
    })
  })

  describe("DriftDrawer", () => {
    it("renders slide-over content and wires actions", () => {
      const onOpenChange = vi.fn()
      const onReload = vi.fn()

      render(
        <DriftDrawer
          open={true}
          onOpenChange={onOpenChange}
          drift={MOCK_DRIFT}
          supportName="Milan"
          isDirty={true}
          onReload={onReload}
        />,
      )

      expect(screen.getByText(DRIFT_COPY.drawerTitle)).toBeTruthy()
      expect(screen.getByText(DRIFT_COPY.reloadWarning)).toBeTruthy()

      const keepBtn = screen.getByTestId("keep-editing-button")
      fireEvent.click(keepBtn)
      expect(onOpenChange).toHaveBeenCalledWith(false)

      const reloadBtn = screen.getByTestId("reload-latest-button")
      fireEvent.click(reloadBtn)
      expect(onReload).toHaveBeenCalledOnce()
    })
  })
})
