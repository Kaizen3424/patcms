import * as Dialog from "@radix-ui/react-dialog"
import type { LogRecord } from "patcms/advanced"
import { useId, useState } from "react"
import { DIAGNOSTICS_COPY, fillName } from "../editor/copy"
import { copyToClipboard } from "../editor/failure-report"
import { useLogger, useRuntime } from "../runtime/context"

export interface DiagnosticsModalProps {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
}

export function formatDiagnosticsReport(
  history: readonly LogRecord[],
  meta: {
    readonly site: string
    readonly branch: string
    readonly repo: string
    readonly supportName: string
    readonly timestamp: string
  },
): string {
  const lines: string[] = [
    `=== ${DIAGNOSTICS_COPY.title.toUpperCase()} ===`,
    `Timestamp: ${meta.timestamp}`,
    `Site: ${meta.site}`,
    `Branch: ${meta.branch}`,
    `Repository: ${meta.repo}`,
    `Support contact: ${meta.supportName}`,
    "",
    `=== LOG RECORDS (${history.length}) ===`,
  ]

  if (history.length === 0) {
    lines.push(DIAGNOSTICS_COPY.empty)
  } else {
    for (const record of history) {
      const dataStr = record.data !== undefined ? ` | ${JSON.stringify(record.data)}` : ""
      lines.push(`[${record.at}] [${record.level.toUpperCase()}] ${record.message}${dataStr}`)
    }
  }

  return lines.join("\n")
}

export function DiagnosticsModal({ open, onOpenChange }: DiagnosticsModalProps) {
  const { config, repository, support } = useRuntime()
  const logger = useLogger()
  const [copied, setCopied] = useState(false)
  const titleId = useId()
  const descId = useId()

  const history = logger.history

  const handleCopy = async () => {
    const report = formatDiagnosticsReport(history, {
      site: config.site?.name ?? "Studio",
      branch: repository.branch,
      repo: `${repository.owner}/${repository.repo}`,
      supportName: support.name,
      timestamp: new Date().toISOString(),
    })
    const ok = await copyToClipboard(report)
    if (ok) {
      setCopied(true)
      setTimeout(() => setCopied(false), 3000)
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs transition-opacity animate-in fade-in" />
        <Dialog.Content
          aria-labelledby={titleId}
          aria-describedby={descId}
          data-testid="diagnostics-modal"
          className="fixed top-1/2 left-1/2 z-50 w-full max-w-2xl -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border-strong bg-surface p-6 shadow-2xl focus:outline-none"
        >
          <div className="flex items-center justify-between border-b border-border-soft pb-3">
            <div>
              <Dialog.Title id={titleId} className="text-base font-semibold text-text-primary">
                {DIAGNOSTICS_COPY.title}
              </Dialog.Title>
              <Dialog.Description id={descId} className="mt-1 text-xs text-text-muted">
                {DIAGNOSTICS_COPY.subtitle}
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                className="rounded-lg p-1.5 text-text-muted transition-colors hover:bg-surface-raised hover:text-text-primary focus-visible:outline-2 focus-visible:outline-accent"
                aria-label={DIAGNOSTICS_COPY.close}
              >
                ✕
              </button>
            </Dialog.Close>
          </div>

          <div className="mt-4">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-text-muted">
              {DIAGNOSTICS_COPY.systemLabel}
            </h3>
            <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-text-secondary sm:grid-cols-3">
              <div className="rounded border border-border-soft bg-surface-raised p-2">
                <span className="block text-[10px] text-text-muted">Site</span>
                <span className="font-medium text-text-primary truncate block">
                  {config.site?.name ?? "Studio"}
                </span>
              </div>
              <div className="rounded border border-border-soft bg-surface-raised p-2">
                <span className="block text-[10px] text-text-muted">Branch</span>
                <span className="font-mono text-text-primary truncate block">
                  {repository.branch}
                </span>
              </div>
              <div className="rounded border border-border-soft bg-surface-raised p-2">
                <span className="block text-[10px] text-text-muted">Partner</span>
                <span className="font-medium text-text-primary truncate block">{support.name}</span>
              </div>
            </div>
          </div>

          <div className="mt-4">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-text-muted">
              Session log ({history.length})
            </h3>
            <div
              data-testid="diagnostics-log-stream"
              className="mt-2 max-h-56 overflow-y-auto rounded-lg border border-border-soft bg-bg p-3 font-mono text-[11px] text-text-muted"
            >
              {history.length === 0 ? (
                <p className="italic">{DIAGNOSTICS_COPY.empty}</p>
              ) : (
                <div className="space-y-1.5">
                  {history.map((rec, i) => (
                    <div key={`${rec.at}-${i}`} className="leading-tight">
                      <span className="text-text-muted/60">[{rec.at.slice(11, 19)}]</span>{" "}
                      <span
                        className={
                          rec.level === "error"
                            ? "text-danger"
                            : rec.level === "warn"
                              ? "text-accent"
                              : "text-text-secondary"
                        }
                      >
                        [{rec.level.toUpperCase()}]
                      </span>{" "}
                      <span className="text-text-primary">{rec.message}</span>
                      {rec.data !== undefined ? (
                        <span className="ml-1 text-text-muted">{JSON.stringify(rec.data)}</span>
                      ) : null}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="mt-6 flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-border-soft">
            <div className="text-xs">
              {copied ? (
                <span className="font-medium text-success" role="status">
                  ✓ {fillName(DIAGNOSTICS_COPY.copiedSuccess, support.name)}
                </span>
              ) : null}
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleCopy}
                data-testid="copy-diagnostics-button"
                className="rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-[#111] transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-accent"
              >
                {DIAGNOSTICS_COPY.copyButton}
              </button>
              <Dialog.Close asChild>
                <button
                  type="button"
                  className="rounded-lg border border-border-soft px-3 py-1.5 text-xs font-medium text-text-muted hover:border-border-strong hover:text-text-primary focus-visible:outline-2 focus-visible:outline-accent"
                >
                  {DIAGNOSTICS_COPY.close}
                </button>
              </Dialog.Close>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
