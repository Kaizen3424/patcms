/**
 * Media library screen and picker modal — ADR-0007 §4, §5 (INV-N03, INV-M01, INV-M03).
 *
 * Browses all repository media assets, calculates budget health, inspects referential
 * usage via findReferences, and allows in-place asset replacement with 1h CDN honesty.
 */

import { useQueryClient } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import {
  calculateMediaBudget,
  createTrashChanges,
  findReferences,
  repoPathToPublicPath,
  resolveMediaFolders,
  type SearchableEntry,
} from "patcms/advanced"
import { useMemo, useState } from "react"
import { fillName, MEDIA_COPY, TRASH_COPY } from "../editor/copy"
import { useBlobPreview } from "../runtime/blob-cache"
import { useEntryIndex, useRuntime, useRuntimeSafe, useSnapshot } from "../runtime/context"

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg"])

export interface MediaItem {
  readonly repoPath: string
  readonly publicPath: string
  readonly filename: string
  readonly size: number
  readonly sha: string
  readonly collectionName?: string
}

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

export function MediaThumbnail({
  sha,
  alt,
  className = "size-full object-cover",
}: {
  readonly sha: string
  readonly alt: string
  readonly className?: string
}) {
  const { url, loading, error } = useBlobPreview(sha)

  if (loading) {
    return (
      <div className="grid size-full place-items-center bg-surface-raised text-text-muted">
        <span className="size-4 animate-spin rounded-full border-2 border-accent border-t-transparent" />
      </div>
    )
  }

  if (error || !url) {
    return (
      <div className="grid size-full place-items-center bg-surface-raised text-[10px] text-text-muted">
        Error
      </div>
    )
  }

  return <img src={url} alt={alt} className={className} loading="lazy" />
}

export function MediaLibraryScreen() {
  const { config, support, backend, coordinator } = useRuntime()
  const snapshot = useSnapshot()
  const entryIndex = useEntryIndex()
  const queryClient = useQueryClient()

  const [selectedCategory, setSelectedCategory] = useState<string>("all")
  const [searchQuery, setSearchQuery] = useState<string>("")
  const [selectedItem, setSelectedItem] = useState<MediaItem | undefined>(undefined)
  const [copied, setCopied] = useState<boolean>(false)
  const [showReplaceWarning, setShowReplaceWarning] = useState<boolean>(false)
  const [confirmingDelete, setConfirmingDelete] = useState<boolean>(false)
  const [deleting, setDeleting] = useState<boolean>(false)

  const entries = useMemo(() => snapshot.data?.tree?.entries ?? [], [snapshot.data?.tree?.entries])

  // Media Budget calculation (INV-M01)
  const budget = useMemo(() => {
    return calculateMediaBudget(entries, config.media)
  }, [entries, config.media])

  // Extract all media items from git tree entries
  const mediaItems = useMemo<MediaItem[]>(() => {
    const items: MediaItem[] = []
    const rootMedia = resolveMediaFolders(config)

    for (const entry of entries) {
      if (entry.type !== "blob") continue
      if (entry.path.startsWith("_trash/")) continue // Managed by trash rung
      if (!isImageFile(entry.path)) continue

      // Resolve collection-specific or root media configuration
      let itemMedia = rootMedia
      let itemCollection: string | undefined

      for (const coll of config.collections) {
        if (coll.kind === "divider") continue
        const collMedia = resolveMediaFolders(config, coll.name)
        if (entry.path.startsWith(collMedia.folder.replace(/^\/+/, ""))) {
          itemMedia = collMedia
          itemCollection = coll.name
          break
        }
      }

      const publicPathResult = repoPathToPublicPath(entry.path, itemMedia)
      const publicPath = publicPathResult.ok ? publicPathResult.value : `/${entry.path}`
      const filename = entry.path.split("/").pop() ?? entry.path

      items.push({
        repoPath: entry.path,
        publicPath,
        filename,
        size: entry.size ?? 0,
        sha: entry.sha,
        collectionName: itemCollection,
      })
    }
    return items
  }, [entries, config])

  // Category filter tabs
  const categories = useMemo(() => {
    const set = new Set<string>()
    for (const coll of config.collections) {
      if (coll.kind !== "divider") set.add(coll.name)
    }
    return ["all", ...Array.from(set)]
  }, [config.collections])

  // Filtered media items
  const filteredItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    return mediaItems.filter((item) => {
      if (selectedCategory !== "all" && item.collectionName !== selectedCategory) {
        return false
      }
      if (q.length > 0) {
        return item.filename.toLowerCase().includes(q) || item.publicPath.toLowerCase().includes(q)
      }
      return true
    })
  }, [mediaItems, selectedCategory, searchQuery])

  // Flattened searchable entries for findReferences
  const searchableEntries = useMemo<SearchableEntry[]>(() => {
    if (!entryIndex.data) return []
    const list: SearchableEntry[] = []
    for (const entries of entryIndex.data.byCollection.values()) {
      for (const e of entries) {
        list.push({
          collection: e.collectionName,
          slug: e.slug,
          title: e.title,
          value: e.value,
        })
      }
    }
    return list
  }, [entryIndex.data])

  // References for currently selected item (INV-M03)
  const references = useMemo(() => {
    if (!selectedItem) return []
    return findReferences({ targetPath: selectedItem.publicPath }, searchableEntries, config)
  }, [selectedItem, searchableEntries, config])

  // Alt text companion prefill if found in any reference
  const altPrefill = useMemo(() => {
    for (const ref of references) {
      if (ref.altText && ref.altText.trim().length > 0) {
        return ref.altText
      }
    }
    return undefined
  }, [references])

  const copyPath = () => {
    if (!selectedItem) return
    navigator.clipboard.writeText(selectedItem.publicPath)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleDelete = async () => {
    if (!selectedItem || !backend || !coordinator || !snapshot.data?.head) return
    setDeleting(true)
    try {
      const bytes = await backend.readBlob(selectedItem.sha)
      const changes = createTrashChanges(selectedItem.repoPath, bytes)
      const verdict = await coordinator.save({
        draftKey: `trash/delete/${selectedItem.filename}`,
        changes,
        baseSha: snapshot.data.head,
        message: `chore(cms): trash ${selectedItem.repoPath}`,
      })
      if (verdict.kind === "published") {
        await queryClient.invalidateQueries({ queryKey: ["snapshot"] })
        setSelectedItem(undefined)
        setConfirmingDelete(false)
      }
    } catch {
      // Keep state
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="flex flex-1 overflow-hidden">
      <div className="flex flex-1 flex-col overflow-y-auto px-5 py-6 md:px-8">
        {/* Header & Budget Warning */}
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-text-primary">
              {MEDIA_COPY.title}
            </h1>
            <p className="mt-1 text-xs text-text-muted">
              {mediaItems.length} images · {formatBytes(budget.totalBytes)} total
            </p>
          </div>
        </div>

        {budget.warning && (
          <div
            data-testid="media-budget-warning"
            className="mb-6 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3.5 text-xs text-amber-200"
          >
            {fillName(MEDIA_COPY.budgetWarning, support.name)}
          </div>
        )}

        {/* Filters and Search Bar */}
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-1">
            {categories.map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setSelectedCategory(cat)}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                  selectedCategory === cat
                    ? "bg-surface-raised text-text-primary"
                    : "text-text-muted hover:text-text-primary"
                }`}
              >
                {cat === "all" ? MEDIA_COPY.filterAll : cat}
              </button>
            ))}
          </div>

          <div className="w-full sm:w-64">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={MEDIA_COPY.searchPlaceholder}
              aria-label={MEDIA_COPY.searchPlaceholder}
              className="w-full rounded-lg border border-border-soft bg-surface px-3 py-1.5 text-xs text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none"
            />
          </div>
        </div>

        {/* Media Grid */}
        {filteredItems.length === 0 ? (
          <div className="grid flex-1 place-items-center rounded-lg border border-dashed border-border-soft p-12 text-center text-xs text-text-muted">
            {searchQuery ? MEDIA_COPY.emptySearch : MEDIA_COPY.emptyState}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
            {filteredItems.map((item) => {
              const isSelected = selectedItem?.repoPath === item.repoPath
              return (
                <button
                  key={item.repoPath}
                  type="button"
                  data-testid={`media-tile-${item.filename}`}
                  onClick={() => {
                    setSelectedItem(item)
                    setShowReplaceWarning(false)
                  }}
                  className={`group relative flex flex-col overflow-hidden rounded-lg border text-left transition-all ${
                    isSelected
                      ? "border-accent ring-2 ring-accent/30"
                      : "border-border-soft hover:border-border-strong bg-surface"
                  }`}
                >
                  <div className="aspect-square w-full overflow-hidden bg-surface-raised">
                    <MediaThumbnail sha={item.sha} alt={item.filename} />
                  </div>
                  <div className="p-2">
                    <p
                      className="truncate text-xs font-medium text-text-primary"
                      title={item.filename}
                    >
                      {item.filename}
                    </p>
                    <p className="text-[10px] text-text-muted">{formatBytes(item.size)}</p>
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* Selected Item Details Drawer */}
      {selectedItem && (
        <aside
          data-testid="media-details-drawer"
          className="w-80 shrink-0 border-l border-border-soft bg-surface p-5 overflow-y-auto"
        >
          <div className="flex items-center justify-between pb-3 border-b border-border-soft">
            <h2 className="text-sm font-semibold text-text-primary">{MEDIA_COPY.detailsTitle}</h2>
            <button
              type="button"
              onClick={() => setSelectedItem(undefined)}
              className="text-xs text-text-muted hover:text-text-primary"
            >
              Close
            </button>
          </div>

          {/* Large Preview */}
          <div className="mt-4 aspect-video w-full overflow-hidden rounded-lg border border-border-soft bg-surface-raised">
            <MediaThumbnail
              sha={selectedItem.sha}
              alt={selectedItem.filename}
              className="size-full object-contain"
            />
          </div>

          {/* Properties */}
          <div className="mt-4 space-y-3 text-xs">
            <div>
              <span className="text-[11px] font-medium text-text-muted">Filename</span>
              <p className="truncate text-text-primary font-mono">{selectedItem.filename}</p>
            </div>

            <div>
              <span className="text-[11px] font-medium text-text-muted">
                {MEDIA_COPY.publicPath}
              </span>
              <div className="mt-1 flex items-center gap-1.5">
                <input
                  readOnly
                  value={selectedItem.publicPath}
                  aria-label={MEDIA_COPY.publicPath}
                  className="w-full rounded border border-border-soft bg-surface-raised px-2 py-1 font-mono text-[11px] text-text-primary"
                />
                <button
                  type="button"
                  onClick={copyPath}
                  className="shrink-0 rounded bg-accent px-2 py-1 text-[11px] font-medium text-text-primary hover:bg-accent/80 transition-colors"
                >
                  {copied ? MEDIA_COPY.copied : MEDIA_COPY.copyPath}
                </button>
              </div>
            </div>

            <div>
              <span className="text-[11px] font-medium text-text-muted">{MEDIA_COPY.fileSize}</span>
              <p className="text-text-primary">{formatBytes(selectedItem.size)}</p>
            </div>

            {/* Companion Alt Text Prefill */}
            {altPrefill && (
              <div
                data-testid="alt-prefill-note"
                className="rounded bg-surface-raised p-2 text-[11px]"
              >
                <span className="text-text-muted">{MEDIA_COPY.altPrefillPrefix}</span>
                <p className="mt-0.5 font-medium text-text-primary">&ldquo;{altPrefill}&rdquo;</p>
              </div>
            )}

            {/* Referential Integrity Section (INV-M03) */}
            <div className="border-t border-border-soft pt-3">
              <span className="text-[11px] font-medium text-text-muted">
                {MEDIA_COPY.usedIn} ({references.length})
              </span>
              {references.length === 0 ? (
                <p className="mt-1 text-text-muted">{MEDIA_COPY.noReferences}</p>
              ) : (
                <ul className="mt-2 space-y-1.5">
                  {references.map((ref, idx) => (
                    <li key={`${ref.collection}-${ref.slug}-${ref.fieldPath}-${idx}`}>
                      <Link
                        to="/c/$collection/e/$entry"
                        params={{ collection: ref.collection, entry: ref.slug }}
                        className="block rounded bg-surface-raised p-2 hover:bg-surface-raised/80 transition-colors"
                      >
                        <p className="font-medium text-accent">{ref.title ?? ref.slug}</p>
                        <p className="text-[10px] text-text-muted">
                          {ref.collection} · field: {ref.fieldPath}
                        </p>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Replace In-Place CDN Honesty Section */}
            <div className="border-t border-border-soft pt-3">
              <button
                type="button"
                onClick={() => setShowReplaceWarning(!showReplaceWarning)}
                className="w-full rounded border border-border-soft px-3 py-1.5 text-xs font-medium text-text-muted hover:border-border-strong hover:text-text-primary transition-colors"
              >
                {MEDIA_COPY.replaceTitle}
              </button>

              {showReplaceWarning && (
                <div
                  data-testid="replace-cdn-honesty-warning"
                  className="mt-2 rounded bg-amber-500/10 p-2.5 text-[11px] leading-relaxed text-amber-200 border border-amber-500/20"
                >
                  {MEDIA_COPY.replaceWarning}
                </div>
              )}
            </div>

            {/* Delete Rung Section (INV-M03) */}
            <div className="border-t border-border-soft pt-3">
              {references.length > 0 ? (
                <div className="space-y-1.5">
                  <button
                    type="button"
                    disabled
                    data-testid="media-delete-button-disabled"
                    className="w-full rounded border border-border-soft px-3 py-1.5 text-xs font-medium text-text-muted/50 cursor-not-allowed bg-surface-raised/40"
                  >
                    {MEDIA_COPY.deleteButton}
                  </button>
                  <p data-testid="delete-blocked-reason" className="text-[11px] text-amber-300">
                    {TRASH_COPY.deleteBlocked}
                  </p>
                </div>
              ) : confirmingDelete ? (
                <div className="space-y-2">
                  <p className="text-[11px] text-red-400 font-medium">{TRASH_COPY.confirmDelete}</p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={deleting}
                      onClick={handleDelete}
                      data-testid="media-delete-confirm-button"
                      className="flex-1 rounded bg-red-500/20 text-red-400 border border-red-500/30 px-3 py-1.5 text-xs font-medium hover:bg-red-500/30 transition-colors disabled:opacity-50"
                    >
                      {deleting ? "Moving..." : "Yes, move to trash"}
                    </button>
                    <button
                      type="button"
                      disabled={deleting}
                      onClick={() => setConfirmingDelete(false)}
                      className="rounded border border-border-soft px-3 py-1.5 text-xs font-medium text-text-muted hover:text-text-primary transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmingDelete(true)}
                  data-testid="media-delete-button"
                  className="w-full rounded border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-xs font-medium text-red-400 hover:bg-red-500/20 transition-colors"
                >
                  {MEDIA_COPY.deleteButton}
                </button>
              )}
            </div>
          </div>
        </aside>
      )}
    </div>
  )
}

export interface MediaPickerModalProps {
  readonly open: boolean
  readonly onClose: () => void
  readonly onSelect: (publicPath: string, altText?: string) => void
  readonly filterCollection?: string
}

export function MediaPickerModal({
  open,
  onClose,
  onSelect,
  filterCollection,
}: MediaPickerModalProps) {
  const runtime = useRuntimeSafe()
  const config = runtime?.config
  const snapshot = useSnapshot()
  const entryIndex = useEntryIndex()
  const [search, setSearch] = useState("")

  const entries = useMemo(() => snapshot.data?.tree?.entries ?? [], [snapshot.data?.tree?.entries])

  const mediaItems = useMemo<MediaItem[]>(() => {
    if (!config) return []
    const items: MediaItem[] = []
    const rootMedia = resolveMediaFolders(config)

    for (const entry of entries) {
      if (entry.type !== "blob" || entry.path.startsWith("_trash/") || !isImageFile(entry.path)) {
        continue
      }

      let itemMedia = rootMedia
      let itemCollection: string | undefined

      for (const coll of config.collections) {
        if (coll.kind === "divider") continue
        const collMedia = resolveMediaFolders(config, coll.name)
        if (entry.path.startsWith(collMedia.folder.replace(/^\/+/, ""))) {
          itemMedia = collMedia
          itemCollection = coll.name
          break
        }
      }

      const publicPathResult = repoPathToPublicPath(entry.path, itemMedia)
      const publicPath = publicPathResult.ok ? publicPathResult.value : `/${entry.path}`
      const filename = entry.path.split("/").pop() ?? entry.path

      items.push({
        repoPath: entry.path,
        publicPath,
        filename,
        size: entry.size ?? 0,
        sha: entry.sha,
        collectionName: itemCollection,
      })
    }
    return items
  }, [entries, config])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return mediaItems.filter((item) => {
      if (filterCollection && item.collectionName && item.collectionName !== filterCollection) {
        return false
      }
      if (q) {
        return item.filename.toLowerCase().includes(q) || item.publicPath.toLowerCase().includes(q)
      }
      return true
    })
  }, [mediaItems, filterCollection, search])

  const searchableEntries = useMemo<SearchableEntry[]>(() => {
    if (!entryIndex.data) return []
    const list: SearchableEntry[] = []
    for (const entries of entryIndex.data.byCollection.values()) {
      for (const e of entries) {
        list.push({
          collection: e.collectionName,
          slug: e.slug,
          title: e.title,
          value: e.value,
        })
      }
    }
    return list
  }, [entryIndex.data])

  if (!open) return null

  const handlePick = (item: MediaItem) => {
    if (!config) return
    const refs = findReferences({ targetPath: item.publicPath }, searchableEntries, config)
    let altText: string | undefined
    for (const ref of refs) {
      if (ref.altText) {
        altText = ref.altText
        break
      }
    }
    onSelect(item.publicPath, altText)
    onClose()
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      data-testid="media-picker-modal"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
    >
      <div className="flex max-h-[85vh] w-full max-w-3xl flex-col rounded-xl border border-border-soft bg-surface shadow-2xl">
        <div className="flex items-center justify-between border-b border-border-soft px-5 py-4">
          <h2 className="text-sm font-semibold text-text-primary">
            {MEDIA_COPY.chooseFromLibrary}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-xs text-text-muted hover:text-text-primary"
          >
            Cancel
          </button>
        </div>

        <div className="border-b border-border-soft px-5 py-3">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={MEDIA_COPY.searchPlaceholder}
            aria-label={MEDIA_COPY.searchPlaceholder}
            className="w-full rounded-lg border border-border-soft bg-surface-raised px-3 py-1.5 text-xs text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none"
          />
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {filtered.length === 0 ? (
            <p className="py-12 text-center text-xs text-text-muted">{MEDIA_COPY.emptyState}</p>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
              {filtered.map((item) => (
                <button
                  key={item.repoPath}
                  type="button"
                  data-testid={`picker-tile-${item.filename}`}
                  onClick={() => handlePick(item)}
                  className="group flex flex-col overflow-hidden rounded-lg border border-border-soft bg-surface-raised text-left hover:border-accent transition-all"
                >
                  <div className="aspect-square w-full overflow-hidden bg-surface">
                    <MediaThumbnail sha={item.sha} alt={item.filename} />
                  </div>
                  <div className="p-2">
                    <p className="truncate text-xs font-medium text-text-primary">
                      {item.filename}
                    </p>
                    <p className="text-[10px] text-text-muted">{formatBytes(item.size)}</p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
