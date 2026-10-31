/**
 * Freeze panel (P2.9 — ADR-0004 P2.9 appendix).
 *
 * Renders the field-granularity conflict decisions above the field grid:
 *  - One row per frozen field path comparing "The other version" vs "Your version".
 *  - Remote values rendered strictly as plain text nodes (ADR-0006 trust policy).
 *  - Escape hatch "Start over from the latest version" available on both normal
 *    and degraded branches.
 */
import type { FieldPath } from "@mycms/core"
import { useState } from "react"
import { FREEZE_COPY, fillName, personalize, SAVE_BAR_COPY } from "./copy"
import { copyToClipboard } from "./failure-report"
import type { FreezeRow } from "./freeze-model"

export interface FreezePanelProps {
  readonly rows?: readonly FreezeRow[]
  readonly ourFieldPaths?: readonly FieldPath[]
  readonly mergeWarnings?: readonly FieldPath[]
  readonly onChoose?: (path: FieldPath, choice: "theirs" | "mine") => void
  readonly onStartOver: () => void
  readonly degraded?: boolean
  readonly supportName: string
}

export function FreezePanel({
  rows,
  ourFieldPaths,
  mergeWarnings,
  onChoose,
  onStartOver,
  degraded,
  supportName,
}: FreezePanelProps) {
  const [copiedKey, setCopiedKey] = useState<string | null>(null)

  const handleCopyDiscarded = async (row: FreezeRow) => {
    const textToCopy = row.choice === "theirs" ? row.mineRaw : row.theirsRaw
    await copyToClipboard(textToCopy)
    setCopiedKey(row.key)
    setTimeout(() => {
      setCopiedKey(null)
    }, 2000)
  }

  if (degraded || rows === undefined || rows.length === 0) {
    const conflictCopy = personalize(SAVE_BAR_COPY.conflict, supportName)
    return (
      <section
        role="alert"
        data-testid="freeze-panel-degraded"
        className="mt-6 rounded-card border border-danger/40 bg-danger/10 p-4"
      >
        <p className="text-sm font-semibold">{FREEZE_COPY.degradedTitle}</p>
        <p className="mt-1 text-xs leading-5 text-text-muted">{conflictCopy.detail}</p>
        <button
          type="button"
          className="mt-3 rounded-lg border border-border-strong bg-surface px-3 py-1.5 text-xs font-medium"
          onClick={onStartOver}
        >
          {FREEZE_COPY.startOver}
        </button>
      </section>
    )
  }

  return (
    <section
      aria-label="Field decisions"
      data-testid="freeze-panel"
      className="mt-6 rounded-card border border-warning/40 bg-warning/5 p-4 sm:p-6"
    >
      <div>
        <h2 className="text-base font-semibold text-text-primary">{FREEZE_COPY.title}</h2>
        <p className="mt-1 text-sm text-text-muted">{FREEZE_COPY.detail}</p>

        {(ourFieldPaths !== undefined && ourFieldPaths.length > 0) ||
        (mergeWarnings !== undefined && mergeWarnings.length > 0) ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {ourFieldPaths?.map((path) => {
              const fieldStr = Array.isArray(path) ? path.join(".") : String(path)
              return (
                <span
                  key={`our-${fieldStr}`}
                  data-testid={`chip-kept-our-${fieldStr}`}
                  className="inline-flex items-center rounded-full border border-border-soft bg-surface-raised px-2.5 py-1 text-xs font-medium text-text-primary"
                >
                  ✓ {FREEZE_COPY.keptYourField.replace("{field}", fieldStr)}
                </span>
              )
            })}
            {mergeWarnings?.map((path) => {
              const fieldStr = Array.isArray(path) ? path.join(".") : String(path)
              return (
                <span
                  key={`partner-${fieldStr}`}
                  data-testid={`chip-kept-partner-${fieldStr}`}
                  className="inline-flex items-center rounded-full border border-border-soft bg-surface-raised px-2.5 py-1 text-xs font-medium text-text-muted"
                >
                  ✓{" "}
                  {fillName(FREEZE_COPY.keptPartnerField, supportName).replace("{field}", fieldStr)}
                </span>
              )
            })}
          </div>
        ) : null}
      </div>

      <div className="mt-6 space-y-4">
        {rows.map((row) => (
          <div
            key={row.key}
            data-testid={`freeze-row-${row.key}`}
            className="rounded-lg border border-border bg-surface p-4"
          >
            <h3 className="text-xs font-semibold uppercase tracking-[0.1em] text-text-muted">
              {row.label}
            </h3>

            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col justify-between rounded border border-border bg-surface-raised p-3">
                <div>
                  <p className="text-xs font-medium text-text-muted">
                    {fillName(FREEZE_COPY.savedByHeader, supportName)}
                  </p>
                  <pre className="mt-1 max-h-48 overflow-auto font-mono text-xs text-text-primary whitespace-pre-wrap break-all">
                    {row.theirsRaw}
                  </pre>
                </div>
                <button
                  type="button"
                  aria-pressed={row.choice === "theirs"}
                  onClick={() => onChoose?.(row.path, "theirs")}
                  className={`mt-3 rounded px-3 py-1.5 text-xs transition-colors ${
                    row.choice === "theirs"
                      ? "bg-accent font-semibold text-[#111]"
                      : "border border-border-strong bg-surface hover:bg-surface-raised"
                  }`}
                >
                  {FREEZE_COPY.keepTheirs}
                </button>
              </div>

              <div className="flex flex-col justify-between rounded border border-border bg-surface-raised p-3">
                <div>
                  <p className="text-xs font-medium text-text-muted">
                    {FREEZE_COPY.yourVersionHeader}
                  </p>
                  <pre className="mt-1 max-h-48 overflow-auto font-mono text-xs text-text-primary whitespace-pre-wrap break-all">
                    {row.mineRaw}
                  </pre>
                </div>
                <button
                  type="button"
                  aria-pressed={row.choice === "mine"}
                  onClick={() => onChoose?.(row.path, "mine")}
                  className={`mt-3 rounded px-3 py-1.5 text-xs transition-colors ${
                    row.choice === "mine"
                      ? "bg-accent font-semibold text-[#111]"
                      : "border border-border-strong bg-surface hover:bg-surface-raised"
                  }`}
                >
                  {FREEZE_COPY.keepMine}
                </button>
              </div>
            </div>

            {row.choice !== undefined ? (
              <div className="mt-3 flex items-center justify-end">
                <button
                  type="button"
                  onClick={() => void handleCopyDiscarded(row)}
                  data-testid={`copy-discarded-${row.key}`}
                  className="text-xs text-text-muted hover:text-text-primary underline cursor-pointer"
                >
                  {copiedKey === row.key ? FREEZE_COPY.copiedDiscarded : FREEZE_COPY.copyDiscarded}
                </button>
              </div>
            ) : null}
          </div>
        ))}
      </div>

      <div className="mt-6 border-t border-border pt-4">
        <button
          type="button"
          onClick={onStartOver}
          className="text-xs text-text-muted underline hover:text-text-primary"
        >
          {FREEZE_COPY.startOver}
        </button>
      </div>
    </section>
  )
}
