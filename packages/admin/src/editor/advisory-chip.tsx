/**
 * Advisory chips (P2.7 — ADR-0004 "P2.7 lease-notice + sweep advisory pins").
 * Presentational: a published save the site's content gate will pause (an
 * older problem elsewhere) becomes one chip per problem entry, with "Take me
 * there" and the minimal clipboard "Copy message for {name}" (the structured
 * composer is P2.10). NEVER gates a save: this state lives outside the
 * save-bar model entirely and nothing in the save path reads it.
 *
 * Sanitize law: all problem content renders as text nodes; no HTML of any kind.
 */
import { Link } from "@tanstack/react-router"
import { useEffect, useRef, useState } from "react"
import { ADVISORY_COPY, fillLine, fillName } from "./copy"
import type { SweepVerdict } from "./save-sweep"

const PRIMARY_LINK =
  "rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-[#111] outline-none transition-opacity focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
const SECONDARY_ACTION =
  "rounded-lg border border-border-strong bg-surface px-3 py-1.5 text-xs font-medium outline-none transition-colors hover:border-accent/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
const DISMISS =
  "rounded-lg border border-border-strong bg-surface px-2 py-1 text-[10px] font-medium outline-none transition-colors hover:border-accent/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"

export interface AdvisoryChipsProps {
  readonly verdict: SweepVerdict | undefined
  readonly supportName: string
}

export function AdvisoryChips({ verdict, supportName }: AdvisoryChipsProps) {
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set())

  if (verdict === undefined || verdict.kind === "upToDate") return null
  if (verdict.kind === "unknown") {
    return (
      <section
        role="status"
        data-testid="advisory-sweep"
        className="mt-6 rounded-card border border-accent/40 bg-accent-soft p-4"
      >
        <p className="text-sm font-semibold">{ADVISORY_COPY.unknownTitle}</p>
        <p className="mt-1 text-xs leading-5 text-text-muted">
          {fillName(ADVISORY_COPY.unknownDetail, supportName)}
        </p>
      </section>
    )
  }

  const visible = verdict.problems.filter((problem) => !dismissed.has(problem.path))
  if (visible.length === 0) return null

  return (
    <>
      {visible.map((problem) => (
        <section
          key={problem.path}
          role="status"
          data-testid="advisory-chip"
          className="mt-6 rounded-card border border-accent/40 bg-accent-soft p-4"
        >
          <div className="flex items-start justify-between gap-2">
            <p className="text-sm font-semibold">{ADVISORY_COPY.pausedTitle}</p>
            <button
              type="button"
              aria-label={ADVISORY_COPY.dismiss}
              className={DISMISS}
              onClick={() => setDismissed((current) => new Set(current).add(problem.path))}
            >
              {ADVISORY_COPY.dismiss}
            </button>
          </div>
          <p className="mt-1 text-xs leading-5 text-text-muted">
            {fillLine(ADVISORY_COPY.chipDetail, {
              title: problem.title,
              detail: problem.issue.message,
            })}
          </p>
          <p className="mt-0.5 font-mono text-[10px] text-text-muted/70">{problem.path}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link
              to="/c/$collection/e/$entry"
              params={{ collection: problem.collectionName, entry: problem.slug }}
              className={PRIMARY_LINK}
            >
              {ADVISORY_COPY.takeMeThere}
            </Link>
            <CopyMessageButton
              problem={problem}
              supportName={supportName}
              pausedTitle={ADVISORY_COPY.pausedTitle}
            />
          </div>
        </section>
      ))}
    </>
  )
}

function CopyMessageButton({
  problem,
  supportName,
  pausedTitle,
}: {
  readonly problem: {
    readonly path: string
    readonly title: string
    readonly issue: { readonly message: string }
  }
  readonly supportName: string
  readonly pausedTitle: string
}) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<number | undefined>(undefined)

  useEffect(
    () => () => {
      if (timer.current !== undefined) window.clearTimeout(timer.current)
    },
    [],
  )

  const label = copied ? ADVISORY_COPY.copied : fillName(ADVISORY_COPY.copyMessage, supportName)

  const copy = (): void => {
    // Minimal composer (superseded by P2.10): one honest paragraph (deck-owned
    // template) + the machine-checkable location. Clipboard failure stays
    // silent — the copy line is also visible on screen.
    const text = `${pausedTitle} — ${fillLine(ADVISORY_COPY.copyBody, {
      title: problem.title,
      detail: problem.issue.message,
      path: problem.path,
    })}`
    const clipboard = navigator.clipboard
    if (clipboard === undefined) return
    void clipboard
      .writeText(text)
      .then(() => setCopied(true))
      .catch(() => setCopied(false))
      .finally(() => {
        timer.current = window.setTimeout(() => setCopied(false), 2000)
      })
  }

  return (
    <button type="button" className={SECONDARY_ACTION} onClick={copy}>
      {label}
    </button>
  )
}
