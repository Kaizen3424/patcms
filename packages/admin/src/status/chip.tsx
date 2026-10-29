/**
 * Deploy-status surfaces (ADR-0008 P2.8 appendix): a per-entry chip keyed to
 * the entry's latest published sha, and the top-bar banner carrying whole-site
 * truth for the current head.
 *
 * Never a spinner: an off feature renders the off copy (banner only), and a
 * degraded read renders the honest unavailable copy with its cause hint where
 * there is room. Detail links open the failing run or commit page, never a raw
 * dashboard. All copy comes from `./copy` (the banned-word sweep scans it).
 */

import type { DeployStatusKind, DeployStatusSnapshot } from "@mycms/core"
import {
  STATUS_CAUSE_COPY,
  STATUS_COPY,
  STATUS_DISABLED_COPY,
  STATUS_SUPERSEDED_COPY,
} from "./copy"
import { useEntryStatus, useSiteStatus } from "./provider"

export interface StatusChipProps {
  /** Entry's latest published sha (the per-commit key), if any. */
  readonly sha: string | undefined
}

const CHIP = "mt-4 inline-flex flex-wrap items-center gap-1.5 text-[11px] text-text-muted"
const BANNER =
  "inline-flex flex-wrap items-center gap-1.5 rounded-lg border border-border-soft bg-surface px-3 py-1.5 text-[11px] text-text-muted"
const DETAIL = "text-accent underline-offset-4 hover:underline"

/**
 * Per-entry truth. Renders nothing before this session published the entry,
 * and nothing when status checking is off — the banner owns the single off
 * message, so a folder of entries is not a wall of identical lines.
 */
export function StatusChip({ sha }: StatusChipProps) {
  const { snapshot, isDisabled } = useEntryStatus(sha ?? "")
  if (sha === undefined || sha.length === 0 || isDisabled || snapshot === undefined) return null
  return (
    <p className={CHIP} data-testid="deploy-status-chip" data-status-kind={snapshot.kind}>
      <StatusBody snapshot={snapshot} />
    </p>
  )
}

/** Whole-site truth for the head every visitor is served. */
export function StatusBanner() {
  const { snapshot, isDisabled } = useSiteStatus()
  if (isDisabled) {
    return (
      <p className={BANNER} data-testid="deploy-status-banner" data-status-kind="off">
        <span className="size-1.5 shrink-0 rounded-full bg-text-muted" aria-hidden="true" />
        <span>{STATUS_DISABLED_COPY}</span>
      </p>
    )
  }
  if (snapshot === undefined || snapshot.sha.length === 0) return null
  const hint = snapshot.kind === "unavailable" ? causeCopy(snapshot) : undefined
  return (
    <p
      className={BANNER}
      data-testid="deploy-status-banner"
      data-status-kind={snapshot.kind}
      role="status"
    >
      <StatusBody snapshot={snapshot} />
      {hint === undefined ? null : <span className="text-text-muted/80">{hint}</span>}
    </p>
  )
}

function StatusBody({ snapshot }: { readonly snapshot: DeployStatusSnapshot }) {
  return (
    <>
      <span
        className={`size-1.5 shrink-0 rounded-full ${toneFor(snapshot.kind)}`}
        aria-hidden="true"
      />
      <span>{STATUS_COPY[snapshot.kind]}</span>
      {snapshot.supersededBy === undefined ? null : (
        <span className="text-accent">{STATUS_SUPERSEDED_COPY}</span>
      )}
      {snapshot.detailsUrl === undefined ? null : (
        <a href={snapshot.detailsUrl} target="_blank" rel="noopener noreferrer" className={DETAIL}>
          Details
        </a>
      )}
    </>
  )
}

function toneFor(kind: DeployStatusKind): string {
  if (kind === "live") return "bg-success"
  if (kind === "building" || kind === "awaiting") return "animate-pulse bg-accent"
  if (kind === "failed") return "bg-danger"
  return "bg-text-muted"
}

function causeCopy(snapshot: DeployStatusSnapshot): string | undefined {
  return snapshot.cause === undefined ? undefined : STATUS_CAUSE_COPY[snapshot.cause]
}
