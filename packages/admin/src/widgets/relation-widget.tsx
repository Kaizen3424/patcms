import type { RelationFieldDescriptor } from "patcms/advanced"
import { useId, useMemo, useState } from "react"
import { inputClass, WidgetFrame } from "./chrome"
import type { WidgetProps } from "./contract"

export function RelationWidget({
  value,
  onChange,
  error,
  fieldConfig,
  services,
}: WidgetProps<RelationFieldDescriptor>) {
  const id = useId()
  const [search, setSearch] = useState("")

  const targetEntries = useMemo(
    () => services?.getEntries(fieldConfig.collection) ?? [],
    [services, fieldConfig.collection],
  )

  const isMultiple = fieldConfig.multiple === true
  const selectedSlugs = useMemo<readonly string[]>(() => {
    if (isMultiple) {
      return Array.isArray(value) ? (value as string[]) : []
    }
    return typeof value === "string" && value.length > 0 ? [value] : []
  }, [value, isMultiple])

  const filteredCandidates = useMemo(() => {
    const query = search.trim().toLowerCase()
    return targetEntries.filter((entry) => {
      // Exclude already selected
      if (selectedSlugs.includes(entry.slug)) return false
      if (query.length === 0) return true

      const searchFields = fieldConfig.searchFields ?? ["title"]
      return searchFields.some((f) => {
        const val = entry.value[f] ?? entry[f as keyof typeof entry]
        return typeof val === "string" && val.toLowerCase().includes(query)
      })
    })
  }, [targetEntries, selectedSlugs, search, fieldConfig.searchFields])

  const handleSelect = (slug: string) => {
    if (isMultiple) {
      if (!selectedSlugs.includes(slug)) {
        onChange([...selectedSlugs, slug])
      }
    } else {
      onChange(slug)
    }
    setSearch("")
  }

  const handleRemove = (slugToRemove: string) => {
    if (isMultiple) {
      const next = selectedSlugs.filter((s) => s !== slugToRemove)
      onChange(next.length > 0 ? next : undefined)
    } else {
      onChange(undefined)
    }
  }

  return (
    <WidgetFrame id={id} field={fieldConfig} error={error}>
      <div className="space-y-2">
        {/* Selected items */}
        {selectedSlugs.length > 0 ? (
          <div
            className="flex flex-wrap gap-2"
            data-testid={`relation-selected-${fieldConfig.name}`}
          >
            {selectedSlugs.map((slug) => {
              const target = services?.getEntryBySlug(fieldConfig.collection, slug)
              const title = target?.title
              const isMissing = target === undefined

              return (
                <div
                  key={slug}
                  className={`flex items-center gap-2 rounded-lg border px-2.5 py-1 text-xs transition-colors ${
                    isMissing
                      ? "border-danger/40 bg-danger/10 text-danger"
                      : "border-border-soft bg-surface text-text-primary"
                  }`}
                  data-testid={`relation-chip-${slug}`}
                >
                  <span className="font-medium">
                    {isMissing ? "Reference to a removed product" : title}
                  </span>
                  {isMissing ? (
                    <span className="font-mono text-[10px] text-text-muted/80">({slug})</span>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => handleRemove(slug)}
                    aria-label={`Remove reference ${title || slug}`}
                    className="ml-1 rounded p-0.5 text-text-muted transition-colors hover:bg-surface-raised hover:text-danger"
                  >
                    ✕
                  </button>
                </div>
              )
            })}
          </div>
        ) : null}

        {/* Candidate picker (shown if multiple or if nothing selected yet) */}
        {isMultiple || selectedSlugs.length === 0 ? (
          <div className="space-y-1.5">
            <input
              id={id}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={`Search ${fieldConfig.label.toLowerCase()}...`}
              className={inputClass(error)}
            />

            {search.trim().length > 0 || (!isMultiple && selectedSlugs.length === 0) ? (
              <div className="max-h-48 overflow-y-auto rounded-lg border border-border-soft bg-surface py-1 shadow-lg">
                {filteredCandidates.length === 0 ? (
                  <p className="px-3 py-2 text-xs italic text-text-muted">
                    No matching entries found
                  </p>
                ) : (
                  filteredCandidates.map((entry) => (
                    <button
                      key={entry.slug}
                      type="button"
                      onClick={() => handleSelect(entry.slug)}
                      className="flex w-full items-center justify-between px-3 py-1.5 text-left text-xs transition-colors hover:bg-surface-raised focus-visible:bg-surface-raised focus-visible:outline-none"
                    >
                      <span className="font-medium text-text-primary">{entry.title}</span>
                      <span className="text-[10px] text-text-muted">{entry.slug}</span>
                    </button>
                  ))
                )}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </WidgetFrame>
  )
}
