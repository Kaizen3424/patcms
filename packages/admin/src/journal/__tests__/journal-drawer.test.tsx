import { createMemoryJournalStore } from "@mycms/core/web"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { fillName, JOURNAL_COPY } from "../../editor/copy"
import { JournalDrawer } from "../journal-drawer"

let mockJournalStore = createMemoryJournalStore()

vi.mock("../../runtime/context", () => ({
  useRuntime: () => ({
    support: { name: "Milan", email: "milan@example.com" },
  }),
  useJournalStore: () => mockJournalStore,
}))

describe("JournalDrawer", () => {
  beforeEach(async () => {
    mockJournalStore = createMemoryJournalStore()
  })

  it("renders empty state when there are no records", async () => {
    render(<JournalDrawer open={true} onOpenChange={vi.fn()} />)

    expect(screen.getByText(JOURNAL_COPY.title)).toBeTruthy()
    expect(screen.getByText(JOURNAL_COPY.subtitle)).toBeTruthy()

    await waitFor(() => {
      expect(screen.getByText(JOURNAL_COPY.emptyMyChanges)).toBeTruthy()
      expect(screen.getByText(fillName(JOURNAL_COPY.emptyPartnerChanges, "Milan"))).toBeTruthy()
    })
  })

  it("renders my changes and partner changes correctly", async () => {
    await mockJournalStore.append({
      entryId: "chair",
      path: "src/content/products/chair.json",
      entryTitle: "Oak Chair",
      collectionName: "products",
      commitSha: "1111111222222233333334444444555555566666",
      publishedAt: new Date(Date.now() - 60000).toISOString(),
      author: "You",
    })

    await mockJournalStore.append({
      entryId: "table",
      path: "src/content/products/table.json",
      entryTitle: "Dining Table",
      collectionName: "products",
      commitSha: "aaaaaaabbbbbbbccccccddddddeeeeeeffffff",
      publishedAt: new Date(Date.now() - 120000).toISOString(),
      author: "Milan",
    })

    render(<JournalDrawer open={true} onOpenChange={vi.fn()} />)

    await waitFor(() => {
      expect(screen.getByText("Oak Chair")).toBeTruthy()
      expect(screen.getByText("Dining Table")).toBeTruthy()
      expect(screen.getByText(/Saved by Milan/)).toBeTruthy()
    })
  })

  it("calls onOpenChange when close button is clicked", () => {
    const onOpenChange = vi.fn()
    render(<JournalDrawer open={true} onOpenChange={onOpenChange} />)

    const closeBtn = screen.getByTestId("close-journal-drawer")
    fireEvent.click(closeBtn)

    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})
