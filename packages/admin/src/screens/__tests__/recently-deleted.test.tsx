import type { GitBackend, SaveCoordinator, TreeEntryTuple } from "@mycms/core"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { BlobCacheManager, BlobCacheProvider } from "../../runtime/blob-cache"
import { RecentlyDeletedScreen } from "../recently-deleted-screen"

const MOCK_TRASH_ENTRIES: TreeEntryTuple[] = [
  {
    path: "_trash/public/images/products/deleted-iris.jpg",
    type: "blob",
    mode: "100644",
    sha: "sha-deleted-iris",
    size: 2048,
  },
  {
    path: "_trash/public/images/products/colliding-ring.jpg",
    type: "blob",
    mode: "100644",
    sha: "sha-colliding",
    size: 4096,
  },
  // Active live file that collides with colliding-ring.jpg
  {
    path: "public/images/products/colliding-ring.jpg",
    type: "blob",
    mode: "100644",
    sha: "sha-live-ring",
    size: 4096,
  },
]

let mockEntries: TreeEntryTuple[] = MOCK_TRASH_ENTRIES
let mockCoordinator: Partial<SaveCoordinator>

vi.mock("../../runtime/context", () => ({
  useRuntime: () => ({
    backend: {
      readBlob: vi.fn(async () => new Uint8Array([0x89, 0x50, 0x4e, 0x47])),
    },
    coordinator: mockCoordinator,
    support: { name: "Alice" },
  }),
  useSnapshot: () => ({
    data: {
      head: "sha-head-current",
      tree: { sha: "tree-sha", entries: mockEntries },
    },
  }),
}))

describe("RecentlyDeletedScreen", () => {
  let blobCache: BlobCacheManager
  let queryClient: QueryClient

  beforeEach(() => {
    mockEntries = [...MOCK_TRASH_ENTRIES]
    mockCoordinator = {
      save: vi.fn(async () => ({ kind: "published", commitSha: "new-sha" }) as const),
    }
    const backend: Partial<GitBackend> = {
      readBlob: vi.fn(async () => new Uint8Array([0x89, 0x50, 0x4e, 0x47])),
    }
    blobCache = new BlobCacheManager(backend as GitBackend)
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    URL.createObjectURL = vi.fn(() => "blob:test-preview")
    URL.revokeObjectURL = vi.fn()
  })

  it("renders trashed items with honest subtitle copy", () => {
    render(
      <QueryClientProvider client={queryClient}>
        <BlobCacheProvider manager={blobCache}>
          <RecentlyDeletedScreen />
        </BlobCacheProvider>
      </QueryClientProvider>,
    )

    expect(screen.getByText("Recently Deleted")).toBeDefined()
    expect(
      screen.getByText(/Restoring moves the image back to its original location/i),
    ).toBeDefined()
    expect(screen.getByTestId("trash-item-deleted-iris.jpg")).toBeDefined()
    expect(screen.getByTestId("trash-item-colliding-ring.jpg")).toBeDefined()
  })

  it("blocks restoration and displays collision error when destination already has a file", async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <BlobCacheProvider manager={blobCache}>
          <RecentlyDeletedScreen />
        </BlobCacheProvider>
      </QueryClientProvider>,
    )

    const collidingItem = screen.getByTestId("trash-item-colliding-ring.jpg")
    const restoreBtn = collidingItem.querySelector("button")
    expect(restoreBtn).toBeDefined()
    if (restoreBtn) fireEvent.click(restoreBtn)

    await waitFor(() => {
      const err = screen.getByTestId("trash-error")
      expect(err.textContent).toContain(
        "Cannot restore: an image already exists at the original location.",
      )
    })
    expect(mockCoordinator.save).not.toHaveBeenCalled()
  })

  it("restores uncollided item via coordinator.save", async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <BlobCacheProvider manager={blobCache}>
          <RecentlyDeletedScreen />
        </BlobCacheProvider>
      </QueryClientProvider>,
    )

    const irisItem = screen.getByTestId("trash-item-deleted-iris.jpg")
    const restoreBtn = irisItem.querySelector("button")
    if (restoreBtn) fireEvent.click(restoreBtn)

    await waitFor(() => {
      expect(mockCoordinator.save).toHaveBeenCalledWith(
        expect.objectContaining({
          changes: {
            adds: [
              {
                path: "public/images/products/deleted-iris.jpg",
                bytes: expect.any(Uint8Array),
              },
            ],
            deletes: ["_trash/public/images/products/deleted-iris.jpg"],
          },
        }),
      )
    })
  })
})
