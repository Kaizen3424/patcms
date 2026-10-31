import * as Dialog from "@radix-ui/react-dialog"
import { useNavigate } from "@tanstack/react-router"
import type React from "react"
import { useEffect, useId, useMemo, useRef, useState } from "react"
import { fillLine, SEARCH_COPY } from "../editor/copy"
import { useEntryIndex, useRuntime } from "../runtime/context"
import { type SearchResult, searchIndex } from "./search-index"

export interface GlobalSearchModalProps {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
}

export function GlobalSearchModal({ open, onOpenChange }: GlobalSearchModalProps) {
  const { config } = useRuntime()
  const entryIndex = useEntryIndex()
  const navigate = useNavigate()
  const [query, setQuery] = useState("")
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const descriptionId = useId()

  const entries = entryIndex.data?.entries ?? []
  const groups = useMemo(() => searchIndex(query, entries, config), [query, entries, config])

  const flattenedResults = useMemo(() => {
    const list: SearchResult[] = []
    for (const group of groups) {
      for (const item of group.results) {
        list.push(item)
      }
    }
    return list
  }, [groups])

  // Reset selection index when query changes
  useEffect(() => {
    setSelectedIndex(0)
  }, [query])

  // Auto-focus input when modal opens
  useEffect(() => {
    if (open) {
      setQuery("")
      setSelectedIndex(0)
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [open])

  // Scroll selected item into view
  useEffect(() => {
    if (!listRef.current) return
    const activeEl = listRef.current.querySelector<HTMLElement>('[aria-selected="true"]')
    if (activeEl) {
      activeEl.scrollIntoView({ block: "nearest" })
    }
  }, [selectedIndex])

  const handleSelect = (item: SearchResult) => {
    onOpenChange(false)
    void navigate({
      to: "/c/$collection/e/$entry",
      params: { collection: item.collectionName, entry: item.slug },
    })
  }

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowDown") {
      event.preventDefault()
      if (flattenedResults.length > 0) {
        setSelectedIndex((prev) => (prev + 1) % flattenedResults.length)
      }
    } else if (event.key === "ArrowUp") {
      event.preventDefault()
      if (flattenedResults.length > 0) {
        setSelectedIndex((prev) => (prev - 1 + flattenedResults.length) % flattenedResults.length)
      }
    } else if (event.key === "Enter") {
      event.preventDefault()
      if (flattenedResults.length > 0 && flattenedResults[selectedIndex]) {
        handleSelect(flattenedResults[selectedIndex])
      }
    }
  }

  const isOffline = typeof navigator !== "undefined" && !navigator.onLine

  let runningIndex = 0

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs transition-opacity animate-in fade-in" />
        <Dialog.Content
          aria-labelledby={titleId}
          aria-describedby={descriptionId}
          data-testid="global-search-modal"
          onKeyDown={handleKeyDown}
          className="fixed top-[15%] left-1/2 z-50 w-full max-w-2xl -translate-x-1/2 overflow-hidden rounded-xl border border-border-strong bg-surface p-0 shadow-2xl focus:outline-none"
        >
          <Dialog.Title id={titleId} className="sr-only">
            {SEARCH_COPY.promptTitle}
          </Dialog.Title>
          <Dialog.Description id={descriptionId} className="sr-only">
            {SEARCH_COPY.promptDetail}
          </Dialog.Description>

          <div className="flex items-center border-b border-border-soft px-4 py-3">
            <span aria-hidden="true" className="mr-3 text-text-muted">
              🔍
            </span>
            <input
              ref={inputRef}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={SEARCH_COPY.placeholder}
              data-testid="global-search-input"
              className="flex-1 bg-transparent text-sm text-text-primary outline-none placeholder:text-text-muted"
            />
            {query ? (
              <button
                type="button"
                onClick={() => setQuery("")}
                className="ml-2 rounded px-1.5 py-0.5 text-xs text-text-muted hover:text-text-primary"
                aria-label="Clear search"
              >
                Clear
              </button>
            ) : null}
          </div>

          <div
            ref={listRef}
            data-testid="search-results-list"
            className="max-h-[60vh] overflow-y-auto p-2"
          >
            {query.trim().length === 0 ? (
              <div
                data-testid="search-zero-state"
                className="py-10 text-center text-xs leading-relaxed text-text-muted"
              >
                <p className="font-medium text-text-primary">{SEARCH_COPY.promptTitle}</p>
                <p className="mx-auto mt-1 max-w-md">{SEARCH_COPY.promptDetail}</p>
              </div>
            ) : flattenedResults.length === 0 ? (
              <div
                data-testid="search-empty-state"
                className="py-10 text-center text-xs leading-relaxed text-text-muted"
              >
                <p className="font-medium text-text-primary">{SEARCH_COPY.emptyTitle}</p>
                <p className="mx-auto mt-1 max-w-md">
                  {fillLine(SEARCH_COPY.emptyDetail, { query })}
                </p>
              </div>
            ) : (
              groups.map((group) => (
                <div key={group.collectionName} className="mb-3">
                  <div className="flex items-center justify-between px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-accent">
                    <span>{group.collectionLabel}</span>
                    <span className="text-[11px] font-normal text-text-muted">
                      {group.results.length}
                    </span>
                  </div>
                  <div role="listbox" className="space-y-1">
                    {group.results.map((item) => {
                      const itemIndex = runningIndex++
                      const isSelected = itemIndex === selectedIndex

                      return (
                        <button
                          type="button"
                          key={item.id}
                          role="option"
                          aria-selected={isSelected}
                          data-testid={`search-result-${item.slug}`}
                          onClick={() => handleSelect(item)}
                          className={`group flex w-full cursor-pointer items-start justify-between rounded-lg px-3 py-2 text-left text-xs transition-colors ${
                            isSelected
                              ? "bg-accent/15 text-text-primary"
                              : "text-text-muted hover:bg-surface-raised hover:text-text-primary"
                          }`}
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-text-primary">{item.title}</span>
                              <span className="rounded bg-surface-raised px-1.5 py-0.5 text-[10px] text-text-muted">
                                {item.matchedField}
                              </span>
                            </div>
                            {item.snippetParts ? (
                              <p className="mt-1 truncate text-xs text-text-muted">
                                {item.snippetParts.map((part, i) =>
                                  part.isMatch ? (
                                    <mark
                                      key={i}
                                      className="rounded bg-accent/25 px-0.5 font-medium text-accent"
                                    >
                                      {part.text}
                                    </mark>
                                  ) : (
                                    <span key={i}>{part.text}</span>
                                  ),
                                )}
                              </p>
                            ) : null}
                          </div>
                          <span
                            aria-hidden="true"
                            className="ml-2 text-text-muted opacity-0 group-hover:opacity-100"
                          >
                            ↵
                          </span>
                        </button>
                      )
                    })}
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="flex items-center justify-between border-t border-border-soft px-4 py-2 text-[11px] text-text-muted">
            <span>{SEARCH_COPY.shortcuts}</span>
            {isOffline ? (
              <span className="rounded bg-surface-raised px-2 py-0.5 text-accent">
                {SEARCH_COPY.offlineBadge}
              </span>
            ) : null}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
