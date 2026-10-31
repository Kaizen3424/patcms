import { createMemoryJournalStore } from "@mycms/core/web"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { HEARTBEAT_COPY } from "../../editor/copy"
import { LoginHeartbeat, TopBarHeartbeat } from "../heartbeat"

let mockJournalStore = createMemoryJournalStore()

vi.mock("../../runtime/context", () => ({
  useRuntimeSafe: () => ({
    support: { name: "Milan", email: "milan@example.com" },
  }),
  useJournalStore: () => mockJournalStore,
}))

vi.mock("../provider", () => ({
  useSiteStatus: () => ({
    kind: "live",
    message: "Site content is live",
  }),
}))

describe("Heartbeats", () => {
  beforeEach(() => {
    mockJournalStore = createMemoryJournalStore()
  })

  describe("TopBarHeartbeat", () => {
    it("renders default live indicator when journal is empty", async () => {
      const onOpen = vi.fn()
      render(<TopBarHeartbeat onOpenJournal={onOpen} />)

      const button = screen.getByTestId("top-bar-heartbeat")
      expect(button).toBeTruthy()
      expect(button.textContent).toContain(HEARTBEAT_COPY.liveTitle)

      fireEvent.click(button)
      expect(onOpen).toHaveBeenCalledOnce()
    })

    it("displays friendly relative time for user's own save", async () => {
      await mockJournalStore.append({
        entryId: "chair",
        path: "src/content/products/chair.json",
        entryTitle: "Oak Chair",
        collectionName: "products",
        commitSha: "1111111222222233333334444444555555566666",
        publishedAt: new Date(Date.now() - 30000).toISOString(),
        author: "You",
      })

      render(<TopBarHeartbeat />)

      await waitFor(() => {
        const button = screen.getByTestId("top-bar-heartbeat")
        expect(button.textContent).toContain("Last edit yours")
      })
    })

    it("displays partner name for team save", async () => {
      await mockJournalStore.append({
        entryId: "table",
        path: "src/content/products/table.json",
        entryTitle: "Dining Table",
        collectionName: "products",
        commitSha: "aaaaaaabbbbbbbccccccddddddeeeeeeffffff",
        publishedAt: new Date(Date.now() - 120000).toISOString(),
        author: "Milan",
      })

      render(<TopBarHeartbeat />)

      await waitFor(() => {
        const button = screen.getByTestId("top-bar-heartbeat")
        expect(button.textContent).toContain("Last edit Milan")
      })
    })
  })

  describe("LoginHeartbeat", () => {
    it("renders default connection state when no lastConnected given", () => {
      render(<LoginHeartbeat />)
      const el = screen.getByTestId("login-heartbeat")
      expect(el.textContent).toContain(HEARTBEAT_COPY.loginConnected)
    })

    it("renders relative time when lastConnected is provided", () => {
      const pastTime = new Date(Date.now() - 60000).toISOString()
      render(<LoginHeartbeat lastConnected={pastTime} />)
      const el = screen.getByTestId("login-heartbeat")
      expect(el.textContent).toContain("Last connected")
    })
  })
})
