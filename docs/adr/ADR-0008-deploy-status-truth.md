# ADR-0008 — Deploy-status truth: check-runs primary, graceful unknown, per-commit honesty

**Status:** Accepted · 2026-10-27

## Context
Cloudflare Workers Builds reports **GitHub check runs** (one per connected Worker; watch-path-filtered projects emit none) — NOT commit statuses; the combined statuses endpoint stays EMPTY (round-1 blocker 3: plan would read "unknown" forever). Build-skipping tokens `[skip ci]` et al. and later pushes complicate "is the site live?" truth. Round-2 UX made "Saved ✓" a terminal milestone independent of status visibility (degrades if the PAT lacks Checks read).

## Decision
1. **Poll check-runs**: `GET /repos/{owner}/{repo}/commits/{sha}/check-runs?per_page=1` on OUR exact commit sha — queued/in_progress/pending/blocked → "building"; all conclusions success → "Live"; any failure → "didn't go through" + detail URL (never raw dashboards).
2. **Fallback**: config `contexts[]` enables commit-status polling for third-party CI.
3. **Grace honesty**: no check run within 120s (5s → 10s cadence, jittered) → "Build status unavailable", NEVER "failed", with cause-hint list + `commits/{sha}` deep link.
4. **Skip-token hygiene**: generated + user-editable commit messages REJECT `[skip ci]|[ci skip]|[no ci]|[skip actions]` (the CMS must never silently suppress its own deploy).
5. **Per-commit truth under overlap**: chips keyed to per-entry `latestCommitSha`; a check run landing on C1 after C2 exists must not display stale "Live" for newer state — chip shows "Live now: €1.490 · your newest save (€1.495) is still building"; head advanced ⇒ "superseded by {sha}" annotation; top-bar banner "live site reflects current head".
6. **Pat-gen**: PAT recipes include Checks read (InvD-INV-D01 prerequisite); missing permission at probe ⇒ feature disabled gracefully ("Auto-deploy status is disabled") — never a spinner loop.
7. Milestone law (from UX): "Saved ✓ (site updating ~2 min)" persists regardless of statuses; >6 min → event-copy exit; failure screen = "your words are saved, the public site is unchanged, 9-in-10 not your text" + Copy-message for [partner] — banned words: build/commit/deploy/token (INV-founder-copies).

## Consequences
Late-arriving failures may surface under a newer chip — resolved by per-commit keys + reveal-on-journal, accepted (TR3): "Live" = per-commit truth; the banner supplies whole-site truth.
### P0 verification (2026-10-27)
- `commitStatus` encoded as an exhaustive boolean capability, shape-checked by the contract suite (per-token opt-in truth source). The check-runs consumer lands P2.8. No deviation.

### P2.8 appendix (2026-10-28) — status read surface, decision matrix, watcher ownership

Pins the mechanism behind §1–§3, §5 and §6. Where this appendix and the earlier
bullets differ, this appendix wins. The copy note at the end supersedes every
literal UI phrase in §3/§5/§6 (banned-word law).

**Read surface (backend contract).** `GitBackend` gains two REQUIRED methods —
gating is by the existing exhaustive `capabilities.commitStatus`, not by method
presence:

- `readCheckRuns(branch, sha) → { kind: "ok"; totalCount; runs } | { kind: "unsupported" }`
- `readCommitStatuses(branch, sha) → { kind: "ok"; statuses } | { kind: "unsupported" }`

`CheckRunSummary = { id, name, status, conclusion, detailsUrl? }` and
`CommitStatusSummary = { context, state, targetUrl? }`. Both carry `branch` even
though GitHub's routes are sha-scoped: branch is a parameter on EVERY backend
method (INV-P14) and Stage-B providers may scope by ref. GitHub implementations
MUST NOT use `branch` in these two URLs.

- `capabilities.commitStatus === false` ⇒ both methods resolve
  `{ kind: "unsupported" }` with zero network I/O; the contract suite asserts it.
  `true` ⇒ a truthful read using the existing classified read-error taxonomy.
- **`per_page=100`** (supersedes §1's `per_page=1`; the login probe may stay at 1
  because it only checks permission). The reader surfaces GitHub's `total_count`;
  `runs.length < totalCount` means the page is incomplete ⇒ `unavailable`, never
  Live on partial truth. Pagination is out of scope for v1.
- Parsing uses `parseUntrustedJson` + explicit field projection. Unknown check
  status values count as non-completed; unknown conclusions count as not-success;
  detail URLs are kept only when `https:` (rendered per ADR-0006). Response
  bodies never leak into errors (ADR-0005 classifier law).
- Errors: 403 WITH any `x-ratelimit-reset` header classifies `RATE_LIMIT`, not
  `SCOPE` (already the read-path rule). ANY read error degrades the watcher to
  `unavailable` and STOPS it. A read error is NEVER `failed`; `failed` exists only
  when a run/status conclusion says so.

**Check-run matrix (our exact sha).** Applied in order:
1. any conclusion `failure | timed_out | cancelled | action_required | stale` → `failed` (a failure outranks a still-running sibling);
2. else any run with `status !== "completed"` (queued / in_progress / pending / requested / waiting / unknown) → `building`;
3. else any conclusion `success` → `live` (neutral/skipped never mask a real success);
4. else (no runs, or only neutral/skipped) → no decisive result — fallback/grace.

**Commit-statuses fallback.** Consulted only when the check-run set has no
decisive result (empty or neutral/skipped-only) and `deploy.contexts` is
non-empty: filter statuses to exact context matches, then any `error|failure` →
`failed`, else any `pending`/unknown → `building`, else any `success` → `live`,
else no decisive result. A decisive check-run state always wins. With no
`contexts`, the statuses endpoint is never called.

**Grace + cadence.** `createStatusWatcher` starts in `awaiting`. Fast poll 5 s
for the first 60 s, then 10 s; each delay is multiplied by
`1 + jitterRatio * (2*random() − 1)` (default 0.2, delay clamped ≥ 0). No
decisive result within 120 s of watch start → `unavailable` (cause `grace`) and
stop — NEVER `failed`. `maxWatchMs` (default 600 s) stops a still-active watch
and preserves the last state with `stale: true`. Terminal states (`live`,
`failed`, `unavailable`) stop polling. Timing is injected: `now`,
`schedulePoll(delay, fn) → cancel`, `random`; the core module owns no global
timers, `Date.now`, or `Math.random`.

**Head + supersede.** Every poll also reads the branch head through the injected
`readHead` (`backend.getRef(branch)` in admin). If `head !== watchedSha`, the
snapshot gains `supersededBy: head` and the watcher stops — never a stale "Live"
for a newer head. `sha` stays the per-commit key: a chip is keyed to the entry's
`latestCommitSha`, so a late check run on C1 can never repaint C2. The banner
uses whole-site truth: one shared watcher on the current head says whether the
public site reflects it.

**Ownership + admin wiring.** Core: pure status module (`classifyCheckRuns`,
`classifyStatuses`, `createStatusWatcher`) with injected seams and no React.
Admin: a sha-keyed refcounted registry (`acquire(sha) → release`) feeds one
watcher per sha, exposed via `useSyncExternalStore`; N entries published in one
sweep share one poller. `AdminMountOptions.statusTiming` overrides the defaults;
the playground honors `statusFastPollMs`, `statusSlowPollMs`,
`statusFastWindowMs`, `statusGraceMs`, `statusMaxWatchMs`, `statusJitterRatio`.
The feature runs only when `capabilities.commitStatus === true` AND the login
probe reports `checksRead === "ok"`; otherwise no watcher is created and the UI
says status checking is off (never a spinner loop). Publish state is a
session-only map (`entryId → latestCommitSha`) filled from the `published`
verdict; a reload starts empty. A persistent publish journal is P5.2 work and an
explicit non-goal here.

**Copy supersession (2026-10-28).** The literal phrases in §3/§5/§6 are semantic
intent, not shippable strings: "Build status unavailable", "Live now … is still
building", "superseded by {sha}" and "Auto-deploy status is disabled" contain
banned words (INV-founder-copies). The admin `STATUS_COPY` deck is the only
source of user-visible strings and must pass `copy.test.ts`. Semantics map to:
awaiting → "Waiting for the public site to start updating."; building → "The
public site is updating."; live → "The public site is up to date."; failed →
"The public site did not update."; unavailable → "Status unavailable — your
words are saved."; superseded annotation → "A newer save is live."; disabled →
"Status checking is off." Detail links open the failing run (its `detailsUrl`)
or the commit page built from the admin repository target; never a raw
dashboard.

**Non-goals.** Webhooks/App auth, PR/staging mode, polling after every consumer
releases, persistent publish journal (P5.2), and commit-status polling without
`deploy.contexts`.
