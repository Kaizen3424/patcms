import type { CollectionDescriptor, FolderCollectionDescriptor } from "@mycms/core"
import { compareValues, formatFriendlyDate, mustacheLite, readPath } from "@mycms/core"
import type { OnboardingState } from "@mycms/core/web"
import { Link, useParams } from "@tanstack/react-router"
import { useEffect, useState } from "react"
import {
  describeTokenExpiry,
  getTokenExpiryConfig,
  type TokenExpiryState,
} from "../auth/token-expiry"
import { EXPIRY_COPY, fillName } from "../editor/copy"
import { ConsentPactCard } from "../onboarding/consent-pact"
import { ProductTourDialog } from "../onboarding/product-tour"
import { useEntryIndex, useOnboardingStore, useRuntime } from "../runtime/context"
import type { IndexedEntry } from "../runtime/entry-index"
import { issueCounts } from "../runtime/entry-index"
import { imageSource } from "../runtime/media"

interface Group {
  readonly label: string
  readonly entries: readonly IndexedEntry[]
}

export function LibraryScreen() {
  const { config, support } = useRuntime()
  const params = useParams({ strict: false }) as { readonly collection?: string }
  const collection = config.collections.find(
    (candidate) => candidate.kind !== "divider" && candidate.name === params.collection,
  )
  const index = useEntryIndex()
  const onboardingStore = useOnboardingStore()
  const [onboarding, setOnboarding] = useState<OnboardingState | undefined>(undefined)
  const [tourOpen, setTourOpen] = useState(false)
  const [expiryState, setExpiryState] = useState<TokenExpiryState | undefined>(undefined)
  const [search, setSearch] = useState("")
  const [sortField, setSortField] = useState("title")
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc")
  const [templateModalOpen, setTemplateModalOpen] = useState(false)

  useEffect(() => {
    let active = true
    const load = async () => {
      const state = await onboardingStore.get()
      if (active) setOnboarding(state)
    }
    void load()
    const unsubscribe = onboardingStore.subscribe(() => {
      void load()
    })
    return () => {
      active = false
      unsubscribe()
    }
  }, [onboardingStore])

  useEffect(() => {
    void getTokenExpiryConfig().then((cfg) => {
      if (cfg) {
        setExpiryState(describeTokenExpiry(cfg))
      }
    })
  }, [])

  if (collection === undefined || collection.kind === "divider") {
    return <EmptyState title="Folder not found" body="That folder is not part of this studio." />
  }

  if (index.isLoading) {
    return <p className="text-sm text-text-muted">Loading entries...</p>
  }

  const canCreate =
    collection.kind === "folder" && (collection as FolderCollectionDescriptor).create !== false
  const entries = index.data?.byCollection.get(collection.name) ?? []
  const sortable = collection.kind === "folder" ? sortOptions(collection) : ["title"]
  const filtered = entries.filter((entry) => matchesSearch(entry, search))
  const sorted = [...filtered].sort((left, right) =>
    compareValues(sortValue(left, sortField), sortValue(right, sortField), sortDirection),
  )
  const groups = groupEntries(sorted, collection)

  return (
    <div className="mx-auto max-w-6xl">
      <ProductTourDialog
        open={tourOpen}
        onOpenChange={setTourOpen}
        onComplete={() => void onboardingStore.update({ tourCompleted: true })}
      />
      {onboarding && !onboarding.firstPublishCompleted && !onboarding.pactDismissed ? (
        <ConsentPactCard
          onTakeTour={() => setTourOpen(true)}
          onDismiss={() => void onboardingStore.update({ pactDismissed: true })}
        />
      ) : null}
      {expiryState?.isExpiringSoon ? (
        <div
          data-testid="token-expiry-notice"
          className="mb-4 flex items-center justify-between rounded-lg border border-accent/40 bg-accent-soft/40 px-4 py-2.5 text-xs text-text-primary"
        >
          <span>
            {fillName(EXPIRY_COPY.renewNotice, support.name).replace(
              "{date}",
              formatFriendlyDate(expiryState.expiresAt),
            )}
          </span>
          <span className="font-semibold text-accent">
            {EXPIRY_COPY.renewChip.replace("{date}", formatFriendlyDate(expiryState.expiresAt))}
          </span>
        </div>
      ) : null}
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.14em] text-accent">
            {collection.label}
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">{collection.label}</h1>
          <p className="mt-2 max-w-xl text-sm leading-6 text-text-muted">
            {collection.kind === "folder"
              ? "Every file in this folder is shown, including entries that need attention."
              : "The fixed pages and settings for this site."}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {canCreate ? (
            entries.length > 0 ? (
              <button
                type="button"
                onClick={() => setTemplateModalOpen(true)}
                className="rounded-lg bg-accent px-3.5 py-1.5 text-xs font-semibold text-[#111] transition-colors hover:bg-accent/90 focus-visible:outline-2 focus-visible:outline-accent"
                data-testid="new-entry-button"
              >
                + New {(collection as FolderCollectionDescriptor).labelSingular || "item"}
              </button>
            ) : (
              <Link
                to="/c/$collection/new"
                params={{ collection: collection.name }}
                className="rounded-lg bg-accent px-3.5 py-1.5 text-xs font-semibold text-[#111] transition-colors hover:bg-accent/90 focus-visible:outline-2 focus-visible:outline-accent"
                data-testid="new-entry-button"
              >
                + New {(collection as FolderCollectionDescriptor).labelSingular || "item"}
              </Link>
            )
          ) : null}

          <div className="flex items-center gap-2 rounded-full border border-border-soft bg-surface px-3 py-2 text-xs text-text-muted">
            <span className="size-1.5 rounded-full bg-success" aria-hidden="true" />
            {entries.length} {entries.length === 1 ? "entry" : "entries"}
          </div>
        </div>
      </header>

      <div className="mt-7 flex flex-col gap-3 border-y border-border-soft py-3 sm:flex-row sm:items-center sm:justify-between">
        <label className="relative block w-full sm:max-w-xs">
          <span className="sr-only">Search {collection.label}</span>
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by title or content"
            className="w-full rounded-lg border border-border-soft bg-surface px-3.5 py-2.5 pr-9 text-sm outline-none placeholder:text-text-muted/60 focus-visible:border-accent/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          />
          <span
            aria-hidden="true"
            className="pointer-events-none absolute right-3 top-2.5 text-text-muted"
          >
            /
          </span>
        </label>
        <div className="flex items-center gap-2">
          <label htmlFor="sort-field" className="text-xs text-text-muted">
            Sort
          </label>
          <select
            id="sort-field"
            value={sortField}
            onChange={(event) => setSortField(event.target.value)}
            className="rounded-lg border border-border-soft bg-surface px-2.5 py-2 text-xs outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            {sortable.map((field) => (
              <option key={field} value={field}>
                {humanize(field)}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => setSortDirection((direction) => (direction === "asc" ? "desc" : "asc"))}
            aria-label={`Sort ${sortDirection === "asc" ? "descending" : "ascending"}`}
            className="rounded-lg border border-border-soft bg-surface px-2.5 py-2 text-xs text-text-muted transition-colors hover:text-text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            {sortDirection === "asc" ? "A to Z" : "Z to A"}
          </button>
        </div>
      </div>

      {index.isLoading ? (
        <LoadingRows />
      ) : index.isError ? (
        <EmptyState
          title="The folder could not be read"
          body="Check the connection and the access key, then try again."
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          title={search.length === 0 ? "This folder is empty" : "No matching entries"}
          body={
            search.length === 0
              ? "There is nothing to review here yet."
              : "Try a shorter search, or clear the search field."
          }
        />
      ) : (
        <div className="mt-6 space-y-8">
          {groups.map((group) => (
            <section key={group.label} aria-label={group.label}>
              {groups.length > 1 ? (
                <h2 className="mb-3 text-xs font-semibold uppercase tracking-[0.12em] text-text-muted">
                  {group.label}{" "}
                  <span className="ml-1 text-text-muted/60">{group.entries.length}</span>
                </h2>
              ) : null}
              <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {group.entries.map((entry) => (
                  <li key={entry.path}>
                    <EntryCard entry={entry} collection={collection} />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      {templateModalOpen ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="template-picker-title"
          className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-xs"
        >
          <div className="w-full max-w-lg rounded-card border border-border-soft bg-surface p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-border-soft pb-3">
              <h2 id="template-picker-title" className="text-base font-semibold text-text-primary">
                New {(collection as FolderCollectionDescriptor).labelSingular || "item"}
              </h2>
              <button
                type="button"
                onClick={() => setTemplateModalOpen(false)}
                className="rounded p-1 text-text-muted hover:text-text-primary"
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3">
              <Link
                to="/c/$collection/new"
                params={{ collection: collection.name }}
                onClick={() => setTemplateModalOpen(false)}
                className="flex items-center justify-between rounded-lg border border-border-soft bg-surface-raised p-3 text-xs transition-colors hover:border-accent hover:bg-accent/10"
                data-testid="start-from-blank"
              >
                <div>
                  <p className="font-semibold text-text-primary">Start from blank</p>
                  <p className="mt-0.5 text-text-muted">
                    Create a fresh entry with default settings
                  </p>
                </div>
                <span className="text-accent font-semibold">→</span>
              </Link>

              <div>
                <p className="text-xs font-medium text-text-muted mb-2">
                  Or start from an existing item:
                </p>
                <div className="max-h-60 overflow-y-auto divide-y divide-border-soft/60 rounded-lg border border-border-soft">
                  {entries.map((item) => (
                    <Link
                      key={item.slug}
                      to="/c/$collection/new"
                      params={{ collection: collection.name }}
                      search={{ from: item.slug }}
                      onClick={() => setTemplateModalOpen(false)}
                      className="flex items-center justify-between p-2.5 text-xs transition-colors hover:bg-surface-raised"
                      data-testid={`start-from-${item.slug}`}
                    >
                      <span className="font-medium text-text-primary">{item.title}</span>
                      <span className="text-[11px] text-accent">Use as template</span>
                    </Link>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function EntryCard({
  entry,
  collection,
}: {
  readonly entry: IndexedEntry
  readonly collection: Exclude<CollectionDescriptor, { kind: "divider" }>
}) {
  const counts = issueCounts(entry)
  const thumbnailValue =
    collection.kind === "folder" && collection.thumbnail !== undefined
      ? readPath(entry.value, collection.thumbnail)
      : readPath(entry.value, "image")
  const thumbnail = imageSource(thumbnailValue, entry.media.publicFolder)
  const summary =
    collection.kind === "folder"
      ? mustacheLite(collection.summary ?? "{{title}}", { ...entry.value, title: entry.title })
      : entry.path
  const driftLabel =
    counts.errors > 0
      ? `Drift: ${counts.errors} ${counts.errors === 1 ? "problem" : "problems"}`
      : counts.warnings > 0
        ? `Preserved: ${counts.warnings} note${counts.warnings === 1 ? "" : "s"}`
        : undefined

  return (
    <Link
      to="/c/$collection/e/$entry"
      params={{ collection: entry.collectionName, entry: entry.slug }}
      className="group flex h-full gap-3 rounded-card border border-border-soft bg-surface p-3 transition-colors hover:border-border-strong hover:bg-surface-raised focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
    >
      <div className="grid size-16 shrink-0 place-items-center overflow-hidden rounded-lg border border-border-soft bg-surface-raised text-sm font-semibold text-text-muted">
        {thumbnail === undefined ? (
          <span aria-hidden="true">{initials(entry.title)}</span>
        ) : (
          <img
            src={thumbnail}
            alt=""
            loading="lazy"
            className="size-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
          />
        )}
      </div>
      <div className="min-w-0 flex-1 py-0.5">
        <div className="flex items-start justify-between gap-2">
          <h3 className="truncate text-sm font-semibold tracking-tight">{entry.title}</h3>
          {driftLabel === undefined ? null : (
            <span
              title={driftLabel}
              className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${
                counts.errors > 0
                  ? "border-danger/40 bg-danger/10 text-danger"
                  : "border-accent/40 bg-accent-soft text-accent"
              }`}
            >
              {counts.errors > 0 ? "Drift" : "Note"}
            </span>
          )}
        </div>
        <p className="mt-1 line-clamp-2 min-h-8 text-xs leading-5 text-text-muted">{summary}</p>
        <p className="mt-1 truncate text-[11px] text-text-muted/70">{entry.path}</p>
      </div>
    </Link>
  )
}

function groupEntries(
  entries: readonly IndexedEntry[],
  collection: Exclude<CollectionDescriptor, { kind: "divider" }>,
): readonly Group[] {
  if (collection.kind !== "folder" || collection.viewGroups === undefined) {
    return [{ label: "All entries", entries }]
  }
  const groups: { label: string; entries: IndexedEntry[] }[] = collection.viewGroups.map(
    (group) => ({
      label: group.label,
      entries: [],
    }),
  )
  const other: IndexedEntry[] = []
  for (const entry of entries) {
    let matched = false
    for (const [index, group] of collection.viewGroups.entries()) {
      let matches = false
      try {
        matches = new RegExp(group.pattern).test(String(entry.value[group.field] ?? ""))
      } catch {
        matches = false
      }
      if (!matches) continue
      groups[index]?.entries.push(entry)
      matched = true
      break
    }
    if (!matched) other.push(entry)
  }
  const visible: Group[] = groups.filter((group) => group.entries.length > 0)
  if (other.length > 0) visible.push({ label: "Other", entries: other })
  return visible
}

function sortOptions(collection: FolderCollectionDescriptor): readonly string[] {
  const fields = collection.sortableFields ?? ["title"]
  return fields.includes("title") ? fields : ["title", ...fields]
}

function sortValue(entry: IndexedEntry, field: string): unknown {
  if (field === "title") return entry.title
  if (field === "slug") return entry.slug
  return entry.value[field]
}

function matchesSearch(entry: IndexedEntry, search: string): boolean {
  const needle = search.trim().toLocaleLowerCase()
  if (needle.length === 0) return true
  if (entry.title.toLocaleLowerCase().includes(needle)) return true
  if (entry.slug.toLocaleLowerCase().includes(needle)) return true
  return JSON.stringify(entry.value).toLocaleLowerCase().includes(needle)
}

function initials(title: string): string {
  const parts = title.trim().split(/\s+/).slice(0, 2)
  return parts.map((part) => part.slice(0, 1).toUpperCase()).join("")
}

function humanize(value: string): string {
  return value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/^\w/, (character) => character.toUpperCase())
}

function LoadingRows() {
  return (
    <div
      role="status"
      className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-3"
      aria-label="Loading entries"
    >
      {Array.from({ length: 6 }, (_, index) => (
        <div
          key={index}
          className="h-24 animate-pulse rounded-card border border-border-soft bg-surface/60"
        />
      ))}
    </div>
  )
}

function EmptyState({ title, body }: { readonly title: string; readonly body: string }) {
  return (
    <div className="mt-8 rounded-card border border-dashed border-border-strong bg-surface/40 px-6 py-12 text-center">
      <h2 className="text-base font-semibold">{title}</h2>
      <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-text-muted">{body}</p>
    </div>
  )
}
