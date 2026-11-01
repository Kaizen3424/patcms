/**
 * Ref-counted blob preview cache and lifecycle manager — ADR-0007 §3 (INV-N03).
 *
 * Previews MUST read from the git blob API (never raw.githubusercontent.com).
 * In-flight requests for the same SHA are deduplicated.
 * Object URLs are reference-counted and revoked when all subscribers unmount.
 */

import type { GitBackend } from "patcms/advanced"
import type { ReactNode } from "react"
import { createContext, useContext, useEffect, useMemo, useState } from "react"

export interface BlobCacheEntry {
  readonly url: string
  refCount: number
  readonly bytes: Uint8Array
  readonly mimeType: string
}

export function sniffMimeType(bytes: Uint8Array): string {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return "image/png"
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg"
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp"
  }
  if (
    bytes.length >= 6 &&
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x38
  ) {
    return "image/gif"
  }

  // Sniff for SVG
  const head = new TextDecoder()
    .decode(bytes.slice(0, Math.min(bytes.length, 128)))
    .trimStart()
    .toLowerCase()
  if (head.startsWith("<svg") || head.startsWith("<?xml")) {
    return "image/svg+xml"
  }

  return "application/octet-stream"
}

export class BlobCacheManager {
  private entries = new Map<string, BlobCacheEntry>()
  private inFlight = new Map<string, Promise<string>>()
  private backend: GitBackend | undefined

  constructor(backend?: GitBackend) {
    this.backend = backend
  }

  setBackend(backend: GitBackend | undefined): void {
    this.backend = backend
  }

  getEntry(sha: string): BlobCacheEntry | undefined {
    return this.entries.get(sha)
  }

  getRefCount(sha: string): number {
    return this.entries.get(sha)?.refCount ?? 0
  }

  async acquire(sha: string): Promise<string> {
    const existing = this.entries.get(sha)
    if (existing) {
      existing.refCount++
      return existing.url
    }

    const pending = this.inFlight.get(sha)
    if (pending) {
      const url = await pending
      const entry = this.entries.get(sha)
      if (entry) {
        entry.refCount++
      }
      return url
    }

    const promise = (async () => {
      if (!this.backend) {
        throw new Error("No backend configured for blob preview fetch")
      }
      const bytes = await this.backend.readBlob(sha)
      const mimeType = sniffMimeType(bytes)
      const blob = new Blob([bytes as unknown as BlobPart], { type: mimeType })
      const url = URL.createObjectURL(blob)

      const newEntry: BlobCacheEntry = {
        url,
        refCount: 1,
        bytes,
        mimeType,
      }
      this.entries.set(sha, newEntry)
      this.inFlight.delete(sha)
      return url
    })()

    this.inFlight.set(sha, promise)
    try {
      return await promise
    } catch (err) {
      this.inFlight.delete(sha)
      throw err
    }
  }

  release(sha: string): void {
    const entry = this.entries.get(sha)
    if (!entry) return
    entry.refCount--
    if (entry.refCount <= 0) {
      URL.revokeObjectURL(entry.url)
      this.entries.delete(sha)
    }
  }

  clear(): void {
    for (const entry of this.entries.values()) {
      URL.revokeObjectURL(entry.url)
    }
    this.entries.clear()
    this.inFlight.clear()
  }
}

export const BlobCacheContext = createContext<BlobCacheManager | undefined>(undefined)

export interface BlobCacheProviderProps {
  readonly backend?: GitBackend
  readonly manager?: BlobCacheManager
  readonly children: ReactNode
}

export function BlobCacheProvider({ backend, manager, children }: BlobCacheProviderProps) {
  const instance = useMemo(() => manager ?? new BlobCacheManager(backend), [manager, backend])

  useEffect(() => {
    if (!manager && backend) {
      instance.setBackend(backend)
    }
  }, [instance, manager, backend])

  useEffect(() => {
    return () => {
      if (!manager) {
        instance.clear()
      }
    }
  }, [instance, manager])

  return <BlobCacheContext.Provider value={instance}>{children}</BlobCacheContext.Provider>
}

export function useBlobCache(): BlobCacheManager | undefined {
  return useContext(BlobCacheContext)
}

export interface BlobPreviewResult {
  readonly url: string | undefined
  readonly loading: boolean
  readonly error: string | undefined
}

export function useBlobPreview(
  sha: string | undefined,
  customCache?: BlobCacheManager,
): BlobPreviewResult {
  const contextCache = useBlobCache()
  const cache = customCache ?? contextCache

  const [state, setState] = useState<BlobPreviewResult>(() => {
    if (!sha) return { url: undefined, loading: false, error: undefined }
    const existing = cache?.getEntry(sha)
    if (existing) {
      return { url: existing.url, loading: false, error: undefined }
    }
    return { url: undefined, loading: true, error: undefined }
  })

  useEffect(() => {
    if (!sha || !cache) {
      setState({ url: undefined, loading: false, error: undefined })
      return
    }

    let active = true
    let acquired = false
    setState((prev) => (prev.url ? prev : { url: undefined, loading: true, error: undefined }))

    cache
      .acquire(sha)
      .then((url) => {
        if (!active) {
          cache.release(sha)
          return
        }
        acquired = true
        setState({ url, loading: false, error: undefined })
      })
      .catch((err) => {
        if (!active) return
        setState({
          url: undefined,
          loading: false,
          error: err instanceof Error ? err.message : "Failed to load preview",
        })
      })

    return () => {
      active = false
      if (acquired) {
        cache.release(sha)
      }
    }
  }, [sha, cache])

  return state
}
