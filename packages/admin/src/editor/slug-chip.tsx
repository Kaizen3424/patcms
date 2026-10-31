import { useState } from "react"

export interface SlugChipProps {
  readonly isNew: boolean
  readonly collection: string
  readonly slug: string
  readonly onSlugChange?: (nextSlug: string) => void
  readonly existingSlugs?: readonly string[]
  readonly supportName?: string
  readonly entryTitle?: string
}

export function SlugChip({
  isNew,
  collection,
  slug,
  onSlugChange,
  existingSlugs = [],
  supportName = "your web partner",
  entryTitle = "this item",
}: SlugChipProps) {
  const [isDrawerOpen, setIsDrawerOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [tempSlug, setTempSlug] = useState(slug)

  const hasCollision = isNew && existingSlugs.includes(slug)

  const copyNoteText = `Hi ${supportName}, could you please help me change the web address for "${entryTitle}"? It is currently /${collection}/${slug}.`

  const handleCopyNote = async () => {
    try {
      await navigator.clipboard.writeText(copyNoteText)
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    } catch {
      // Ignore clipboard write failures in test environments
    }
  }

  const handleCommitManualSlug = () => {
    const cleaned = sanitizeSlugInput(tempSlug)
    setIsEditing(false)
    if (cleaned && onSlugChange) {
      onSlugChange(cleaned)
    }
  }

  if (isNew) {
    return (
      <div className="mb-4 space-y-2" data-testid="slug-chip-new">
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border-soft bg-surface/50 px-3 py-1.5 text-xs text-text-muted">
          <span className="font-medium text-text-primary">web address:</span>
          <span className="font-mono text-text-secondary">/{collection}/</span>

          {isEditing ? (
            <div className="flex items-center gap-1.5">
              <input
                type="text"
                value={tempSlug}
                onChange={(e) => setTempSlug(e.target.value)}
                onBlur={handleCommitManualSlug}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCommitManualSlug()
                  if (e.key === "Escape") {
                    setTempSlug(slug)
                    setIsEditing(false)
                  }
                }}
                className="rounded border border-accent bg-surface px-1.5 py-0.5 font-mono text-xs text-text-primary focus:outline-none"
              />
              <button
                type="button"
                onClick={handleCommitManualSlug}
                className="rounded px-1.5 py-0.5 text-[11px] font-medium text-accent hover:bg-accent/10"
              >
                Done
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => {
                setTempSlug(slug)
                setIsEditing(true)
              }}
              title="Click to change address"
              className="rounded font-mono font-medium text-accent underline decoration-dotted underline-offset-2 hover:text-accent/80 focus-visible:outline-2 focus-visible:outline-accent"
            >
              {slug || "auto-generated"}
            </button>
          )}

          <span className="text-[11px] text-text-muted/70">— still fixable until Save</span>
        </div>

        {hasCollision ? (
          <div
            role="alert"
            className="flex items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300"
            data-testid="slug-collision-alert"
          >
            <span>
              An address with this name already exists. We recommend choosing a distinct name before
              saving.
            </span>
          </div>
        ) : null}
      </div>
    )
  }

  return (
    <div className="mb-4 space-y-2" data-testid="slug-chip-locked">
      <div className="flex items-center justify-between gap-2 rounded-lg border border-border-soft bg-surface/30 px-3 py-1.5 text-xs text-text-muted">
        <div className="flex items-center gap-2">
          <span className="text-[11px]" aria-hidden="true">
            🔒
          </span>
          <span className="font-medium text-text-primary">web address:</span>
          <span className="font-mono text-text-secondary">
            /{collection}/{slug}
          </span>
        </div>

        <button
          type="button"
          onClick={() => setIsDrawerOpen(!isDrawerOpen)}
          aria-expanded={isDrawerOpen}
          className="text-xs text-text-muted underline underline-offset-2 hover:text-text-primary focus-visible:outline-2 focus-visible:outline-accent"
        >
          {isDrawerOpen ? "Close info" : "Need to change this?"}
        </button>
      </div>

      {isDrawerOpen ? (
        <div
          className="rounded-lg border border-border-soft bg-surface p-3 text-xs text-text-muted space-y-2.5"
          data-testid="slug-locked-drawer"
        >
          <p>
            This web address is already live. Changing it directly could break bookmarks or links
            from other websites. To keep your visitors happy, address changes are best handled with
            an automatic redirect.
          </p>
          <div>
            <button
              type="button"
              onClick={handleCopyNote}
              className="rounded-lg border border-border-soft bg-surface-raised px-3 py-1.5 font-medium text-text-primary transition-colors hover:border-accent hover:text-accent focus-visible:outline-2 focus-visible:outline-accent"
            >
              {copied ? "Copied note to clipboard!" : `Copy note for ${supportName}`}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

export function sanitizeSlugInput(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

export function deriveSlugFromTitle(title: string, existingSlugs: readonly string[] = []): string {
  const base = sanitizeSlugInput(title) || "new-item"
  if (!existingSlugs.includes(base)) {
    return base
  }
  let counter = 2
  while (existingSlugs.includes(`${base}-${counter}`)) {
    counter++
  }
  return `${base}-${counter}`
}
