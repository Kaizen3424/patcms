import type { GitBackend } from "@mycms/core"
import { render, renderHook, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { BlobCacheManager, BlobCacheProvider, sniffMimeType, useBlobPreview } from "../blob-cache"

describe("sniffMimeType", () => {
  it("detects PNG from magic bytes", () => {
    const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    expect(sniffMimeType(pngBytes)).toBe("image/png")
  })

  it("detects JPEG from magic bytes", () => {
    const jpegBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0])
    expect(sniffMimeType(jpegBytes)).toBe("image/jpeg")
  })

  it("detects WebP from magic bytes", () => {
    const webpBytes = new Uint8Array([
      0x52, 0x49, 0x46, 0x46, 0x20, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
    ])
    expect(sniffMimeType(webpBytes)).toBe("image/webp")
  })

  it("detects GIF from magic bytes", () => {
    const gifBytes = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61])
    expect(sniffMimeType(gifBytes)).toBe("image/gif")
  })

  it("detects SVG from XML or svg tag", () => {
    const svgBytes = new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'></svg>")
    expect(sniffMimeType(svgBytes)).toBe("image/svg+xml")

    const xmlBytes = new TextEncoder().encode("<?xml version='1.0'?><svg></svg>")
    expect(sniffMimeType(xmlBytes)).toBe("image/svg+xml")
  })

  it("falls back to application/octet-stream for unknown bytes", () => {
    const randomBytes = new Uint8Array([0x00, 0x01, 0x02, 0x03])
    expect(sniffMimeType(randomBytes)).toBe("application/octet-stream")
  })
})

describe("BlobCacheManager", () => {
  let createdUrls: string[]
  let revokedUrls: string[]
  let originalCreateObjectUrl: typeof URL.createObjectURL
  let originalRevokeObjectUrl: typeof URL.revokeObjectURL

  beforeEach(() => {
    createdUrls = []
    revokedUrls = []
    originalCreateObjectUrl = URL.createObjectURL
    originalRevokeObjectUrl = URL.revokeObjectURL

    let id = 0
    URL.createObjectURL = vi.fn((_blob: Blob) => {
      const url = `blob:mock-url-${++id}`
      createdUrls.push(url)
      return url
    })

    URL.revokeObjectURL = vi.fn((url: string) => {
      revokedUrls.push(url)
    })
  })

  afterEach(() => {
    URL.createObjectURL = originalCreateObjectUrl
    URL.revokeObjectURL = originalRevokeObjectUrl
  })

  function mockBackend(mockBytes: Uint8Array = new Uint8Array([0x89, 0x50, 0x4e, 0x47])) {
    const readBlob = vi.fn(async (_sha: string) => mockBytes)
    const backend: Partial<GitBackend> = {
      readBlob,
    }
    return { backend: backend as GitBackend, readBlob }
  }

  it("fetches blob, creates object URL, and returns it", async () => {
    const { backend, readBlob } = mockBackend()
    const manager = new BlobCacheManager(backend)

    const url = await manager.acquire("sha-1")
    expect(url).toBe("blob:mock-url-1")
    expect(readBlob).toHaveBeenCalledWith("sha-1")
    expect(manager.getRefCount("sha-1")).toBe(1)
  })

  it("deduplicates concurrent in-flight requests for the same SHA", async () => {
    const { backend, readBlob } = mockBackend()
    const manager = new BlobCacheManager(backend)

    const [url1, url2] = await Promise.all([
      manager.acquire("sha-shared"),
      manager.acquire("sha-shared"),
    ])

    expect(url1).toBe(url2)
    expect(readBlob).toHaveBeenCalledTimes(1)
    expect(manager.getRefCount("sha-shared")).toBe(2)
  })

  it("manages ref-counted lifecycle and calls URL.revokeObjectURL only on zero subscribers", async () => {
    const { backend } = mockBackend()
    const manager = new BlobCacheManager(backend)

    const url = await manager.acquire("sha-lifecycle")
    expect(manager.getRefCount("sha-lifecycle")).toBe(1)

    // Acquire second reference
    await manager.acquire("sha-lifecycle")
    expect(manager.getRefCount("sha-lifecycle")).toBe(2)
    expect(revokedUrls.length).toBe(0)

    // Release first reference
    manager.release("sha-lifecycle")
    expect(manager.getRefCount("sha-lifecycle")).toBe(1)
    expect(revokedUrls.length).toBe(0)

    // Release second reference (hits 0)
    manager.release("sha-lifecycle")
    expect(manager.getRefCount("sha-lifecycle")).toBe(0)
    expect(revokedUrls).toEqual([url])
    expect(manager.getEntry("sha-lifecycle")).toBeUndefined()
  })

  it("clear() revokes all active URLs", async () => {
    const { backend } = mockBackend()
    const manager = new BlobCacheManager(backend)

    const url1 = await manager.acquire("sha-a")
    const url2 = await manager.acquire("sha-b")

    expect(createdUrls).toHaveLength(2)
    expect(revokedUrls).toHaveLength(0)

    manager.clear()
    expect(revokedUrls).toContain(url1)
    expect(revokedUrls).toContain(url2)
  })
})

describe("useBlobPreview hook", () => {
  let originalCreateObjectUrl: typeof URL.createObjectURL
  let originalRevokeObjectUrl: typeof URL.revokeObjectURL
  let revokedUrls: string[]

  beforeEach(() => {
    revokedUrls = []
    originalCreateObjectUrl = URL.createObjectURL
    originalRevokeObjectUrl = URL.revokeObjectURL

    let id = 0
    URL.createObjectURL = vi.fn((_blob: Blob) => `blob:test-${++id}`)
    URL.revokeObjectURL = vi.fn((url: string) => {
      revokedUrls.push(url)
    })
  })

  afterEach(() => {
    URL.createObjectURL = originalCreateObjectUrl
    URL.revokeObjectURL = originalRevokeObjectUrl
  })

  it("acquires on mount and releases on unmount", async () => {
    const readBlob = vi.fn(async (_sha: string) => new Uint8Array([0xff, 0xd8, 0xff]))
    const backend = { readBlob } as unknown as GitBackend
    const manager = new BlobCacheManager(backend)

    const { result, unmount } = renderHook(() => useBlobPreview("sha-hook", manager))

    expect(result.current.loading).toBe(true)

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
      expect(result.current.url).toBe("blob:test-1")
    })

    expect(manager.getRefCount("sha-hook")).toBe(1)

    unmount()
    expect(manager.getRefCount("sha-hook")).toBe(0)
    expect(revokedUrls).toEqual(["blob:test-1"])
  })

  it("shares reference between multiple components", async () => {
    const readBlob = vi.fn(async (_sha: string) => new Uint8Array([0xff, 0xd8, 0xff]))
    const backend = { readBlob } as unknown as GitBackend
    const manager = new BlobCacheManager(backend)

    function PreviewDisplay({ testId }: { testId: string }) {
      const { url, loading } = useBlobPreview("shared-sha")
      if (loading) return <div>loading</div>
      return <img data-testid={testId} src={url} alt="preview" />
    }

    const { unmount, rerender } = render(
      <BlobCacheProvider manager={manager}>
        <PreviewDisplay testId="img-1" />
        <PreviewDisplay testId="img-2" />
      </BlobCacheProvider>,
    )

    await waitFor(() => {
      expect(screen.getByTestId("img-1").getAttribute("src")).toBe("blob:test-1")
      expect(screen.getByTestId("img-2").getAttribute("src")).toBe("blob:test-1")
    })

    expect(readBlob).toHaveBeenCalledTimes(1)
    expect(manager.getRefCount("shared-sha")).toBe(2)

    // Remove one component
    rerender(
      <BlobCacheProvider manager={manager}>
        <PreviewDisplay testId="img-1" />
      </BlobCacheProvider>,
    )

    expect(manager.getRefCount("shared-sha")).toBe(1)
    expect(revokedUrls).toHaveLength(0)

    // Unmount all
    unmount()
    expect(manager.getRefCount("shared-sha")).toBe(0)
    expect(revokedUrls).toEqual(["blob:test-1"])
  })
})
