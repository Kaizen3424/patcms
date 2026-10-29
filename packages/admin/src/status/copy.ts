/**
 * Founder-facing copy deck for deploy-status (ADR-0008 P2.8 appendix). This
 * deck supersedes every literal phrase in the ADR's earlier bullets and is the
 * ONLY source of user-visible status strings; `copy.test.ts` walks it with the
 * banned-word sweep (whole-word, case-insensitive): build / commit / deploy /
 * token / slug / repository / draft / someone / conflict.
 *
 * Rules: say what the public site shows, never what happened internally; a
 * degraded read says the words are saved and never blames her text.
 */

import type { DeployStatusCause, DeployStatusKind } from "@mycms/core"

export const STATUS_COPY: Readonly<Record<DeployStatusKind, string>> = {
  awaiting: "Waiting for the public site to start updating.",
  building: "The public site is updating.",
  live: "The public site is up to date.",
  failed: "The public site did not update.",
  unavailable: "Status unavailable — your words are saved.",
}

/** Annotation when a newer head beat the watched sha (per-commit truth). */
export const STATUS_SUPERSEDED_COPY = "A newer save is live."

/** Feature is off: the capability is absent or the login probe said so. */
export const STATUS_DISABLED_COPY = "Status checking is off."

/** Cause hints for the `unavailable` state. */
export const STATUS_CAUSE_COPY: Readonly<Record<DeployStatusCause, string>> = {
  grace: "We have not seen a result yet — give it a little longer.",
  error: "A status read failed — trying again shortly.",
  incomplete: "Only part of the status set is visible right now.",
  unsupported: STATUS_DISABLED_COPY,
  "watch-timeout": "We kept trying for as long as we reasonably could.",
}
