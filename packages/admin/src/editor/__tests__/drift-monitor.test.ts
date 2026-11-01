import { act, renderHook } from "@testing-library/react"
import type { GitBackend, TreeEntryTuple } from "patcms/advanced"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useDriftMonitor } from "../drift-monitor"

describe("useDriftMonitor", () => {
  const BRANCH = "main"
  const BASE_SHA = "1111111111111111111111111111111111111111"
  const REMOTE_SHA = "2222222222222222222222222222222222222222"
  const ENTRY_PATH = "src/content/products/chair.json"

  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("does not report drift when ref SHA matches baseHeadSha", async () => {
    const mockBackend = {
      getRef: vi.fn(async () => ({
        ref: "refs/heads/main",
        object: { sha: BASE_SHA, type: "commit" as const },
      })),
      listChangedFiles: vi.fn(async () => new Map<string, TreeEntryTuple>()),
    } as unknown as GitBackend

    const { result } = renderHook(() =>
      useDriftMonitor({
        branch: BRANCH,
        baseHeadSha: BASE_SHA,
        entryPath: ENTRY_PATH,
        backend: mockBackend,
        pollIntervalMs: 1000,
      }),
    )

    expect(result.current.drift).toBeUndefined()

    await act(async () => {
      vi.advanceTimersByTime(1100)
    })

    expect(mockBackend.getRef).toHaveBeenCalled()
    expect(mockBackend.listChangedFiles).not.toHaveBeenCalled()
    expect(result.current.drift).toBeUndefined()
  })

  it("reports drift when remote SHA changes and entryPath is in listChangedFiles", async () => {
    const changedFiles = new Map<string, TreeEntryTuple>([
      [
        ENTRY_PATH,
        {
          path: ENTRY_PATH,
          sha: "blob-sha",
          mode: "100644",
          type: "blob",
        },
      ],
    ])

    const mockBackend = {
      getRef: vi.fn(async () => ({
        ref: "refs/heads/main",
        object: { sha: REMOTE_SHA, type: "commit" as const },
      })),
      listChangedFiles: vi.fn(async () => changedFiles),
    } as unknown as GitBackend

    const { result } = renderHook(() =>
      useDriftMonitor({
        branch: BRANCH,
        baseHeadSha: BASE_SHA,
        entryPath: ENTRY_PATH,
        backend: mockBackend,
        pollIntervalMs: 1000,
      }),
    )

    await act(async () => {
      vi.advanceTimersByTime(1100)
    })

    expect(mockBackend.getRef).toHaveBeenCalledWith(BRANCH)
    expect(mockBackend.listChangedFiles).toHaveBeenCalledWith(BRANCH, BASE_SHA, REMOTE_SHA)
    expect(result.current.drift).toBeDefined()
    expect(result.current.drift?.remoteSha).toBe(REMOTE_SHA)

    act(() => {
      result.current.clearDrift()
    })
    expect(result.current.drift).toBeUndefined()
  })

  it("ignores foreign commits if entryPath did not change", async () => {
    const otherFiles = new Map<string, TreeEntryTuple>([
      [
        "src/content/products/table.json",
        {
          path: "src/content/products/table.json",
          sha: "blob-table",
          mode: "100644",
          type: "blob",
        },
      ],
    ])

    const mockBackend = {
      getRef: vi.fn(async () => ({
        ref: "refs/heads/main",
        object: { sha: REMOTE_SHA, type: "commit" as const },
      })),
      listChangedFiles: vi.fn(async () => otherFiles),
    } as unknown as GitBackend

    const { result } = renderHook(() =>
      useDriftMonitor({
        branch: BRANCH,
        baseHeadSha: BASE_SHA,
        entryPath: ENTRY_PATH,
        backend: mockBackend,
        pollIntervalMs: 1000,
      }),
    )

    await act(async () => {
      vi.advanceTimersByTime(1100)
    })

    expect(mockBackend.listChangedFiles).toHaveBeenCalled()
    expect(result.current.drift).toBeUndefined()
  })
})
