/**
 * Recently deleted media screen — ADR-0007 §5 (INV-M03).
 *
 * Browses soft-deleted tombstones in _trash/, detects restoration collisions,
 * and restores media assets with honest founder-facing copy.
 */

import { createRestoreChanges, restoreMediaPath } from "@mycms/core"
import { useQueryClient } from "@tanstack/react-query"
import { useMemo, useState } from "react"
import { TRASH_COPY } from "../editor/copy"
import { useRuntime, useSnapshot } from "../runtime/context"
import { MediaThumbnail } from "./media-library-screen"

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg"])

function isImageFile(path: string): boolean {
  const dot = path.lastIndexOf(".")
  if (dot === -1) return false
  const ext = path.slice(dot).toLowerCase()
  return IMAGE_EXTENSIONS.has(ext)
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export interface TrashedItem {
  readonly trashPath: string
  readonly originalPath: string
  readonly filename: string
  readonly size: number
  readonly sha: string
}

export function RecentlyDeletedScreen() {
  const { backend, coordinator } = useRuntime()
  const snapshot = useSnapshot()
  const queryClient = useQueryClient()

  const [restoringPath, setRestoringPath] = useState<string | undefined>(undefined)
  const [errorMessage, setErrorMessage] = useState<{ path: string; message: string } | undefined>(
    undefined,
  )

  const entries = useMemo(() => snapshot.data?.tree?.entries ?? [], [snapshot.data?.tree?.entries])
  const headSha = snapshot.data?.head

  const trashedItems = useMemo<TrashedItem[]>(() => {
    const list: TrashedItem[] = []
    for (const entry of entries) {
      if (entry.type !== "blob") continue
      if (!entry.path.startsWith("_trash/")) continue
      if (!isImageFile(entry.path)) continue

      list.push({
        trashPath: entry.path,
        originalPath: restoreMediaPath(entry.path),
        filename: entry.path.split("/").pop() ?? entry.path,
        size: entry.size ?? 0,
        sha: entry.sha,
      })
    }
    return list
  }, [entries])

  const handleRestore = async (item: TrashedItem) => {
    if (!backend || !coordinator || !headSha) return
    setRestoringPath(item.trashPath)
    setErrorMessage(undefined)

    try {
      // 1. Check collision before reading blob
      const probeCollision = createRestoreChanges(item.trashPath, new Uint8Array(0), entries)
      if (!probeCollision.ok) {
        setErrorMessage({ path: item.trashPath, message: TRASH_COPY.collisionError })
        return
      }

      // 2. Fetch blob bytes
      const bytes = await backend.readBlob(item.sha)

      // 3. Compose atomic restore changes
      const restoreChanges = createRestoreChanges(item.trashPath, bytes, entries)
      if (!restoreChanges.ok) {
        setErrorMessage({ path: item.trashPath, message: TRASH_COPY.collisionError })
        return
      }

      // 4. Commit restore
      const verdict = await coordinator.save({
        draftKey: `trash/restore/${item.filename}`,
        changes: restoreChanges.changes,
        baseSha: headSha,
        message: `chore(cms): restore ${restoreChanges.destination}`,
      })

      if (verdict.kind === "published") {
        await queryClient.invalidateQueries({ queryKey: ["snapshot"] })
      } else {
        setErrorMessage({
          path: item.trashPath,
          message: "Restore did not go through. Try again in a moment.",
        })
      }
    } catch (err) {
      setErrorMessage({
        path: item.trashPath,
        message: err instanceof Error ? err.message : "Failed to restore image",
      })
    } finally {
      setRestoringPath(undefined)
    }
  }

  return (
    <div className="flex flex-1 flex-col overflow-y-auto px-5 py-6 md:px-8">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-xl font-semibold tracking-tight text-text-primary">
          {TRASH_COPY.title}
        </h1>
        <p className="mt-1 max-w-2xl text-xs leading-relaxed text-text-muted">
          {TRASH_COPY.subtitle}
        </p>
      </div>

      {/* List */}
      {trashedItems.length === 0 ? (
        <div className="grid flex-1 place-items-center rounded-lg border border-dashed border-border-soft p-12 text-center text-xs text-text-muted">
          {TRASH_COPY.emptyState}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {trashedItems.map((item) => {
            const isRestoring = restoringPath === item.trashPath
            const hasError = errorMessage?.path === item.trashPath
            return (
              <div
                key={item.trashPath}
                data-testid={`trash-item-${item.filename}`}
                className="flex flex-col overflow-hidden rounded-lg border border-border-soft bg-surface"
              >
                <div className="aspect-video w-full overflow-hidden bg-surface-raised">
                  <MediaThumbnail
                    sha={item.sha}
                    alt={item.filename}
                    className="size-full object-contain"
                  />
                </div>

                <div className="flex flex-1 flex-col justify-between p-3.5">
                  <div className="space-y-1">
                    <p
                      className="truncate text-xs font-medium text-text-primary font-mono"
                      title={item.filename}
                    >
                      {item.filename}
                    </p>
                    <p
                      className="truncate text-[11px] text-text-muted font-mono"
                      title={item.originalPath}
                    >
                      Original: {item.originalPath}
                    </p>
                    <p className="text-[10px] text-text-muted">{formatBytes(item.size)}</p>
                  </div>

                  {hasError && (
                    <div
                      data-testid="trash-error"
                      className="mt-2 rounded bg-red-500/10 p-2 text-[11px] text-red-400 border border-red-500/20"
                    >
                      {errorMessage.message}
                    </div>
                  )}

                  <div className="mt-3.5 pt-3 border-t border-border-soft">
                    <button
                      type="button"
                      disabled={isRestoring}
                      onClick={() => void handleRestore(item)}
                      className="w-full rounded bg-surface-raised px-3 py-1.5 text-xs font-medium text-text-primary hover:bg-surface-raised/80 disabled:opacity-50 transition-colors"
                    >
                      {isRestoring ? TRASH_COPY.restoring : TRASH_COPY.restoreButton}
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
