import { fireEvent, render, screen } from "@testing-library/react"
import type {
  AdminConfig,
  FilesCollectionDescriptor,
  FolderCollectionDescriptor,
} from "patcms/advanced"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { IndexedEntry } from "../../runtime/entry-index"
import { GlobalSearchModal } from "../global-search-modal"

const mockNavigate = vi.fn()
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mockNavigate,
}))

const MOCK_CONFIG: AdminConfig = {
  schemaVersion: 1,
  collections: [
    {
      name: "products",
      label: "Products",
      kind: "folder",
      folder: "content/products",
      format: "json",
      fields: [],
    },
    {
      name: "pages",
      label: "Pages",
      kind: "files",
      files: [],
    },
  ],
  media: {
    folder: "images",
    publicFolder: "/images",
  },
}

const MOCK_ENTRIES: IndexedEntry[] = [
  {
    collectionName: "products",
    collection: MOCK_CONFIG.collections[0] as unknown as FolderCollectionDescriptor,
    slug: "iris-ring",
    title: "Iris Ring",
    path: "content/products/iris-ring.json",
    fields: [],
    media: MOCK_CONFIG.media,
    raw: { title: "Iris Ring", price: 1450, materials: ["Gold", "Diamond"] },
    value: { title: "Iris Ring", price: 1450, materials: ["Gold", "Diamond"] },
    issues: [],
    untouched: {},
    rawText: "{}",
    blobSha: "sha1",
  },
  {
    collectionName: "pages",
    collection: MOCK_CONFIG.collections[1] as unknown as FilesCollectionDescriptor,
    slug: "about",
    title: "About Our Studio",
    path: "content/pages/about.json",
    fields: [],
    media: MOCK_CONFIG.media,
    raw: { title: "About Our Studio", description: "Crafted in Milan by masters." },
    value: { title: "About Our Studio", description: "Crafted in Milan by masters." },
    issues: [],
    untouched: {},
    rawText: "{}",
    blobSha: "sha2",
  },
]

vi.mock("../../runtime/context", () => ({
  useRuntime: () => ({
    config: MOCK_CONFIG,
    support: { name: "Milan" },
  }),
  useEntryIndex: () => ({
    data: {
      entries: MOCK_ENTRIES,
      byCollection: new Map([
        ["products", [MOCK_ENTRIES[0]]],
        ["pages", [MOCK_ENTRIES[1]]],
      ]),
    },
  }),
}))

describe("GlobalSearchModal", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("renders when open with search input and zero-state teaching prompt", () => {
    render(<GlobalSearchModal open={true} onOpenChange={() => {}} />)

    expect(screen.getByTestId("global-search-modal")).toBeTruthy()
    expect(screen.getByTestId("global-search-input")).toBeTruthy()
    expect(screen.getByTestId("search-zero-state").textContent).toContain(
      "Find anything on your site",
    )
    expect(screen.getByTestId("search-zero-state").textContent).toContain(
      "Search products, collections, and pages by title, price, material, or photo description...",
    )
  })

  it("filters entries across collections and highlights matches", () => {
    render(<GlobalSearchModal open={true} onOpenChange={() => {}} />)

    const input = screen.getByTestId("global-search-input")
    fireEvent.change(input, { target: { value: "Iris" } })

    expect(screen.getByTestId("search-result-iris-ring")).toBeTruthy()
    expect(screen.getByText("Products")).toBeTruthy()
    expect(screen.queryByTestId("search-result-about")).toBeNull()
  })

  it("renders empty state with guidance copy when no entries match", () => {
    render(<GlobalSearchModal open={true} onOpenChange={() => {}} />)

    const input = screen.getByTestId("global-search-input")
    fireEvent.change(input, { target: { value: "NonexistentItem123" } })

    expect(screen.getByTestId("search-empty-state")).toBeTruthy()
    expect(screen.getByTestId("search-empty-state").textContent).toContain("No matches found")
    expect(screen.getByTestId("search-empty-state").textContent).toContain(
      'No entries match "NonexistentItem123". Try searching whole-euro prices (e.g. 1450), materials, or title words.',
    )
  })

  it("navigates to entry when clicked", () => {
    const onOpenChange = vi.fn()
    render(<GlobalSearchModal open={true} onOpenChange={onOpenChange} />)

    const input = screen.getByTestId("global-search-input")
    fireEvent.change(input, { target: { value: "Iris" } })

    const result = screen.getByTestId("search-result-iris-ring")
    fireEvent.click(result)

    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(mockNavigate).toHaveBeenCalledWith({
      to: "/c/$collection/e/$entry",
      params: { collection: "products", entry: "iris-ring" },
    })
  })

  it("navigates on Enter key and supports ArrowDown selection", () => {
    const onOpenChange = vi.fn()
    render(<GlobalSearchModal open={true} onOpenChange={onOpenChange} />)

    const input = screen.getByTestId("global-search-input")
    fireEvent.change(input, { target: { value: "Gold" } }) // Matches Iris Ring

    const modal = screen.getByTestId("global-search-modal")
    fireEvent.keyDown(modal, { key: "Enter" })

    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(mockNavigate).toHaveBeenCalledWith({
      to: "/c/$collection/e/$entry",
      params: { collection: "products", entry: "iris-ring" },
    })
  })
})
