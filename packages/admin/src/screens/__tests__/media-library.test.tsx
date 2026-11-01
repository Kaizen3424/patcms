import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import type { AdminConfig, GitBackend, TreeEntryTuple } from "patcms/advanced"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { BlobCacheManager, BlobCacheProvider } from "../../runtime/blob-cache"
import type { EntryIndex } from "../../runtime/entry-index"
import { MediaLibraryScreen, MediaPickerModal } from "../media-library-screen"

const MOCK_CONFIG: AdminConfig = {
  schemaVersion: 1,
  collections: [
    {
      name: "products",
      label: "Products",
      kind: "folder",
      folder: "src/content/products",
      format: "json",
      fields: [],
    },
    {
      name: "site",
      label: "Site Settings",
      kind: "files",
      files: [],
    },
  ],
  media: {
    folder: "public/images",
    publicFolder: "/images",
  },
}

const MOCK_TREE_ENTRIES: TreeEntryTuple[] = [
  {
    path: "public/images/products/iris-1.jpg",
    type: "blob",
    mode: "100644",
    sha: "sha-iris-1",
    size: 1024,
  },
  {
    path: "public/images/site/logo.png",
    type: "blob",
    mode: "100644",
    sha: "sha-logo",
    size: 2048,
  },
]

const MOCK_ENTRY_INDEX = {
  byCollection: new Map([
    [
      "products",
      [
        {
          collectionName: "products",
          slug: "iris-1",
          title: "Iris No 1",
          path: "src/content/products/iris-1.json",
          value: {
            images: [
              {
                image: "/images/products/iris-1.jpg",
                alt: "Beautiful Iris flower",
              },
            ],
          },
        },
      ],
    ],
  ]),
  bySlug: new Map(),
} as unknown as EntryIndex

let mockEntries: TreeEntryTuple[] = MOCK_TREE_ENTRIES
let mockCoordinator = {
  save: vi.fn(async () => ({ kind: "published", commitSha: "trash-sha" }) as const),
}
const mockBackend = {
  readBlob: vi.fn(async () => new Uint8Array([0x89, 0x50, 0x4e, 0x47])),
}

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    to,
    params,
    className,
  }: {
    children: React.ReactNode
    to: string
    params?: Record<string, unknown>
    className?: string
  }) => (
    <a href={to} data-params={JSON.stringify(params)} className={className}>
      {children}
    </a>
  ),
}))

vi.mock("../../runtime/context", () => ({
  useRuntime: () => ({
    config: MOCK_CONFIG,
    support: { name: "Alice" },
    repository: { repo: "test-repo", branch: "main" },
    backend: mockBackend,
    coordinator: mockCoordinator,
  }),
  useRuntimeSafe: () => ({
    config: MOCK_CONFIG,
    support: { name: "Alice" },
    repository: { repo: "test-repo", branch: "main" },
    backend: mockBackend,
    coordinator: mockCoordinator,
  }),
  useSnapshot: () => ({
    data: {
      head: "sha-head",
      tree: { sha: "tree-sha", entries: mockEntries },
    },
  }),
  useEntryIndex: () => ({
    data: MOCK_ENTRY_INDEX,
  }),
}))

describe("MediaLibraryScreen", () => {
  let blobCache: BlobCacheManager
  let queryClient: QueryClient

  beforeEach(() => {
    mockEntries = [...MOCK_TREE_ENTRIES]
    mockCoordinator = {
      save: vi.fn(async () => ({ kind: "published", commitSha: "trash-sha" }) as const),
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

  it("renders repository images and library header", () => {
    render(
      <QueryClientProvider client={queryClient}>
        <BlobCacheProvider manager={blobCache}>
          <MediaLibraryScreen />
        </BlobCacheProvider>
      </QueryClientProvider>,
    )

    expect(screen.getByText("Media Library")).toBeDefined()
    expect(screen.getByTestId("media-tile-iris-1.jpg")).toBeDefined()
    expect(screen.getByTestId("media-tile-logo.png")).toBeDefined()
  })

  it("filters items by search query", () => {
    render(
      <QueryClientProvider client={queryClient}>
        <BlobCacheProvider manager={blobCache}>
          <MediaLibraryScreen />
        </BlobCacheProvider>
      </QueryClientProvider>,
    )

    const searchInput = screen.getByPlaceholderText("Search images by name or path...")
    fireEvent.change(searchInput, { target: { value: "logo" } })

    expect(screen.queryByTestId("media-tile-iris-1.jpg")).toBeNull()
    expect(screen.getByTestId("media-tile-logo.png")).toBeDefined()
  })

  it("opens details drawer on image click and displays referential usage and CDN honesty warning", () => {
    render(
      <QueryClientProvider client={queryClient}>
        <BlobCacheProvider manager={blobCache}>
          <MediaLibraryScreen />
        </BlobCacheProvider>
      </QueryClientProvider>,
    )

    // Click on iris-1.jpg tile
    fireEvent.click(screen.getByTestId("media-tile-iris-1.jpg"))

    const drawer = screen.getByTestId("media-details-drawer")
    expect(drawer).toBeDefined()
    expect(screen.getByDisplayValue("/images/products/iris-1.jpg")).toBeDefined()

    // Referential integrity check: iris-1 is used in products / iris-1
    expect(screen.getByText("Iris No 1")).toBeDefined()

    // Alt text prefill check
    const altNote = screen.getByTestId("alt-prefill-note")
    expect(altNote.textContent).toContain("Beautiful Iris flower")

    // In-place replacement warning check (1h CDN honesty)
    const replaceButton = screen.getByText("Replace image file")
    fireEvent.click(replaceButton)

    const warning = screen.getByTestId("replace-cdn-honesty-warning")
    expect(warning.textContent).toContain("visitors may see the old image for up to 1 hour")
  })

  it("disables delete button and shows blocked reason when image is referenced", () => {
    render(
      <QueryClientProvider client={queryClient}>
        <BlobCacheProvider manager={blobCache}>
          <MediaLibraryScreen />
        </BlobCacheProvider>
      </QueryClientProvider>,
    )

    fireEvent.click(screen.getByTestId("media-tile-iris-1.jpg"))
    expect(screen.getByTestId("media-delete-button-disabled")).toBeDefined()
    expect(screen.getByTestId("delete-blocked-reason").textContent).toContain(
      "Cannot delete: this image is used in entries.",
    )
  })

  it("allows deletion and dispatches soft-delete to trash when image is unreferenced", async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <BlobCacheProvider manager={blobCache}>
          <MediaLibraryScreen />
        </BlobCacheProvider>
      </QueryClientProvider>,
    )

    // logo.png is unreferenced
    fireEvent.click(screen.getByTestId("media-tile-logo.png"))

    const deleteBtn = screen.getByTestId("media-delete-button")
    fireEvent.click(deleteBtn)

    const confirmBtn = screen.getByTestId("media-delete-confirm-button")
    fireEvent.click(confirmBtn)

    await waitFor(() => {
      expect(mockCoordinator.save).toHaveBeenCalledWith(
        expect.objectContaining({
          changes: {
            adds: [
              {
                path: "_trash/public/images/site/logo.png",
                bytes: expect.any(Uint8Array),
              },
            ],
            deletes: ["public/images/site/logo.png"],
          },
        }),
      )
    })
  })

  it("displays budget warning when repository media exceeds threshold", () => {
    // 800MB threshold = 838,860,800 bytes
    mockEntries = [
      {
        path: "public/images/huge.jpg",
        type: "blob",
        mode: "100644",
        sha: "huge-sha",
        size: 900_000_000,
      },
    ]

    render(
      <QueryClientProvider client={queryClient}>
        <BlobCacheProvider manager={blobCache}>
          <MediaLibraryScreen />
        </BlobCacheProvider>
      </QueryClientProvider>,
    )

    const budgetBanner = screen.getByTestId("media-budget-warning")
    expect(budgetBanner).toBeDefined()
    expect(budgetBanner.textContent).toContain("Alice")
  })
})

describe("MediaPickerModal", () => {
  let blobCache: BlobCacheManager

  beforeEach(() => {
    mockEntries = [...MOCK_TREE_ENTRIES]
    const backend: Partial<GitBackend> = {
      readBlob: vi.fn(async () => new Uint8Array([0x89, 0x50, 0x4e, 0x47])),
    }
    blobCache = new BlobCacheManager(backend as GitBackend)
    URL.createObjectURL = vi.fn(() => "blob:test-preview")
    URL.revokeObjectURL = vi.fn()
  })

  it("selects an item and calls onSelect with path and alt text", () => {
    const onSelect = vi.fn()
    const onClose = vi.fn()

    render(
      <BlobCacheProvider manager={blobCache}>
        <MediaPickerModal open={true} onClose={onClose} onSelect={onSelect} />
      </BlobCacheProvider>,
    )

    const tile = screen.getByTestId("picker-tile-iris-1.jpg")
    fireEvent.click(tile)

    expect(onSelect).toHaveBeenCalledWith("/images/products/iris-1.jpg", "Beautiful Iris flower")
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
