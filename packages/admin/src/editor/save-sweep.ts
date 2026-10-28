/**
 * Cross-entry sweep (P2.7 — ADR-0004 "P2.7 lease-notice + sweep advisory pins").
 * After a published save, re-read every content file at the commit sha the ref
 * was OBSERVED carrying (INV-P10 content truth) and classify what the site does
 * with it. Under the Stage-A contract the site's gate imports OUR schemas
 * zod-first (admin ≥ build gate), so an error-level issue in any content file
 * is the concrete, verifiable cause of a paused site update.
 *
 * Laws pinned here:
 *  - the tree read is FRESH (no etag on the tree call); per-file reads ride
 *    content-addressed blob shas — a 304 is bytes identity, never a stale
 *    cache. INV-P08 (fresh-binding) covers CONFLICT challenge reads only.
 *  - the sweep NEVER touches the shared React Query caches — standalone reads,
 *    so the editor is not churned mid-session.
 *  - a failure degrades to `unknown` — never a false "all clear".
 *  - an advisory NEVER gates a save (standing veto); the chip state lives
 *    outside the save-bar model entirely.
 */
import type { AdminConfig, GitBackend, ParseIssue } from "@mycms/core"
import type { EntryIndex } from "../runtime/entry-index"
import { loadEntryIndex } from "../runtime/entry-index"

/** Structural slot the classifier consumes — `IndexedEntry` satisfies it. */
export interface SweepCandidate {
  readonly path: string
  readonly collectionName: string
  readonly slug: string
  readonly title: string
  readonly issues: readonly ParseIssue[]
}

export interface SweepProblem {
  readonly path: string
  readonly collectionName: string
  readonly slug: string
  readonly title: string
  /** The first error-level issue — human copy comes from the validator itself. */
  readonly issue: ParseIssue
}

/**
 * Verdict classes (master-plan §5.2 conflict-free rescale):
 *  - `upToDate` — no other file carries error-level issues (no chip);
 *  - `advisory` — unrelated file(s) invalid; HER change still committed;
 *  - `unknown`  — reads/parse/transport failed: coverage-honest, never a
 *                 false "all clear".
 */
export type SweepVerdict =
  | { readonly kind: "upToDate" }
  | { readonly kind: "advisory"; readonly problems: readonly SweepProblem[] }
  | { readonly kind: "unknown" }

/** Pure: one problem per entry (its FIRST error); her own path never qualifies. */
export function classifySweep(
  candidates: readonly SweepCandidate[],
  ourPath: string,
): SweepVerdict {
  const problems: SweepProblem[] = []
  for (const candidate of candidates) {
    if (candidate.path === ourPath) continue // her file passed the strict gate
    const issue = candidate.issues.find((item) => item.severity === "error")
    if (issue === undefined) continue // warnings stay read-side notes
    problems.push({
      path: candidate.path,
      collectionName: candidate.collectionName,
      slug: candidate.slug,
      title: candidate.title,
      issue,
    })
  }
  return problems.length === 0 ? { kind: "upToDate" } : { kind: "advisory", problems }
}

export interface SweepSiteOptions {
  readonly config: AdminConfig
  readonly backend: GitBackend
  readonly branch: string
  /** The commit the ref was OBSERVED carrying after the publish (INV-P10). */
  readonly headSha: string
  readonly ourPath: string
}

export async function sweepSite(options: SweepSiteOptions): Promise<SweepVerdict> {
  try {
    const read = await options.backend.readTree(options.branch, options.headSha, {})
    if (read.kind !== "tree") return { kind: "unknown" }
    const index: EntryIndex = await loadEntryIndex({
      config: options.config,
      tree: read.tree,
      backend: options.backend,
      branch: options.branch,
    })
    return classifySweep(index.entries, options.ourPath)
  } catch {
    return { kind: "unknown" }
  }
}
