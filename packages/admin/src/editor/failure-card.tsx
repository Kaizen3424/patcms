import { FAILURE_CARD_COPY, FAILURE_COPY, fillName, personalize } from "./copy"

export interface FailureCardTechnicalContext {
  readonly entryTitle: string
  readonly filePath: string
  readonly branch: string
  readonly repo: string
  readonly baseSha: string
  readonly changedFields?: readonly string[]
}

export interface FailureCardProps {
  readonly errorCode: string
  readonly httpStatus?: number
  readonly supportName: string
  readonly onRetry?: () => void
  readonly onCheckKey?: () => void
  readonly onStartOver?: () => void
  readonly onCopyMessage: () => void
  readonly copied: boolean
  readonly technicalContext?: FailureCardTechnicalContext
}

const PRIMARY_BUTTON =
  "rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-[#111] outline-none transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
const SECONDARY_BUTTON =
  "rounded-lg border border-border-strong bg-surface px-3 py-1.5 text-xs font-medium text-text-primary outline-none transition-colors hover:border-accent/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"

/**
 * Docked failure card (P2.10 — INV-A02 classifier matrix).
 * Renders directly above the sticky SaveBar on non-quota failure and pause states.
 * Guarantees zero banned words, human explanations, and safe technical sharing.
 */
export function FailureCard({
  errorCode,
  httpStatus,
  supportName,
  onRetry,
  onCheckKey,
  onStartOver,
  onCopyMessage,
  copied,
  technicalContext,
}: FailureCardProps) {
  const fallback = FAILURE_COPY.UNKNOWN
  const line =
    (errorCode && errorCode in FAILURE_COPY ? FAILURE_COPY[errorCode] : undefined) ?? fallback
  const copy = personalize(
    line ?? { title: "Something went wrong.", detail: "Please contact {name}." },
    supportName,
  )

  return (
    <section
      role="alert"
      aria-label="Save issue"
      data-testid="failure-card"
      data-error-code={errorCode}
      className="mb-4 rounded-xl border border-danger/40 bg-danger/10 p-4"
    >
      <div className="flex flex-col gap-1">
        <h3 className="text-sm font-semibold text-text-primary">{copy.title}</h3>
        {copy.detail ? (
          <p className="text-xs leading-relaxed text-text-muted">{copy.detail}</p>
        ) : null}
        <p className="mt-1 text-xs font-medium text-text-primary/90">
          {FAILURE_CARD_COPY.reassurance}
        </p>
      </div>

      <div className="mt-3.5 flex flex-wrap items-center gap-2">
        {errorCode === "AUTH_EXPIRED" && onCheckKey ? (
          <button type="button" className={PRIMARY_BUTTON} onClick={onCheckKey}>
            {FAILURE_CARD_COPY.checkKey}
          </button>
        ) : null}

        {onRetry && errorCode !== "AUTH_EXPIRED" ? (
          <button type="button" className={PRIMARY_BUTTON} onClick={onRetry}>
            {FAILURE_CARD_COPY.retry}
          </button>
        ) : null}

        {onStartOver ? (
          <button type="button" className={SECONDARY_BUTTON} onClick={onStartOver}>
            {FAILURE_CARD_COPY.startOver}
          </button>
        ) : null}

        <button type="button" className={SECONDARY_BUTTON} onClick={onCopyMessage}>
          {copied ? FAILURE_CARD_COPY.copied : fillName(FAILURE_CARD_COPY.copyMessage, supportName)}
        </button>
      </div>

      {technicalContext !== undefined ? (
        <details className="mt-3 border-t border-danger/20 pt-2 text-[11px] text-text-muted">
          <summary className="cursor-pointer font-medium hover:text-text-primary">
            {fillName(FAILURE_CARD_COPY.technicalDetails, supportName)}
          </summary>
          <div className="mt-1.5 space-y-0.5 font-mono text-[10px] text-text-muted/90">
            <div>
              Error: {errorCode}
              {httpStatus !== undefined ? ` (HTTP ${httpStatus})` : ""}
            </div>
            <div>Entry: {technicalContext.filePath}</div>
            <div>Branch: {technicalContext.branch}</div>
            <div>Base revision: {technicalContext.baseSha || "unknown"}</div>
            {technicalContext.changedFields && technicalContext.changedFields.length > 0 ? (
              <div>Changed fields: {technicalContext.changedFields.join(", ")}</div>
            ) : null}
          </div>
        </details>
      ) : null}
    </section>
  )
}
