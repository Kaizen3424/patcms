/**
 * Draft resume decision for the editor. Boot adjudication (`adjudicateDraft`
 * in `patcms/advanced`) is deliberately out of scope for the example panel:
 * a draft is offered as-is, and if the branch moved underneath it the save
 * comes back as a conflict value the host already knows how to render.
 */

import type { Draft, Entry } from "patcms"

export type DraftFreshness = "current" | "stale"

export interface DraftOffer {
  readonly draft: Draft
  readonly freshness: DraftFreshness
}

/** Only the head sha matters for the decision; `Pick` keeps tests honest too. */
export function evaluateDraft(
  entry: Pick<Entry, "sha">,
  draft: Draft | undefined,
): DraftOffer | undefined {
  if (draft === undefined) return undefined
  return {
    draft,
    freshness: draft.baseSha === entry.sha ? "current" : "stale",
  }
}
