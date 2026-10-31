# Implementation Plan — MyCMS (master; per-phase task detail)

> Template per `planning-and-task-breakdown`. Phase briefs (`docs/specs/phases/`) are the working docs agents load per session; THIS file holds the task blocks. Status lives in `AGENTS.md §2` and checkboxes in `tasks/todo.md` only.

## Overview
A git-backed zero-database CMS (headless core + brandable React admin) built in 8 checkpoint-gated phases P0→P7 — spec list in `01-spec.md`, invariants in `invariants.md`, decisions in `docs/adr/`.

## Architecture decisions (summary — full: docs/adr/)
- Transactional backend (`commitChanges` + FF-CAS + capabilities) · ADR-0005
- Zod-first closed config + lenient-read/strict-save + untouched patch · ADR-0003
- rebase() value-domain-dirty/raw-domain-merge + save state machine + lease · ADR-0004
- Two registries (core field types / admin widgets) + services boundary · ADR-0009
- Compose-root DI + shared backend contract suite + exemplars · ADR-0001/0009
- Sanitize policy + media staging/worker pipeline · ADR-0006/0007
- Token persisted-opt-in w/ lifecycle conditions · ADR-0002
- Deploy-status via check-runs + honest unknown/supersede · ADR-0008

---

## Phase 0 — Foundation (see `P0-scaffold.md`)

### Task P0.1 — Repo bootstrap (S)
- Acceptance: git repo initialized; trunk-based rules recorded; empty commit hygiene.
- Verify: `git log --oneline` clean conventional history; `git status` clean.
### Task P0.2 — pnpm workspace + catalog (M)
- Acceptance: workspaces resolve; catalog versions pinned; frozen-lockfile install green.
- Verify: `pnpm install --frozen-lockfile` green from scratch; `pnpm -r typecheck` green.
### Task P0.3 — Build/security allowlist (S)
- Acceptance: `onlyBuiltDependencies` committed w/ reasons; audit-waivers schema file exists.
- Verify: fresh install issues zero prompts; `pnpm audit --json | waiver-filter` script runs green.
### Task P0.4 — Core skeleton (M)
- Acceptance: module barrels compile; echo test green; tsup build green.
- Verify: `pnpm --filter core build` + `test` green.
### Task P0.5 — Admin shell (M)
- Acceptance: vite + React19 + Tailwind v4 tokens + TanStack Router/Query + RHF scaffolded; login route renders tokens only.
- Verify: dev server + `pnpm -r build` green; route smoke screenshot.
### Task P0.6 — Playground + FakeGithub skeleton (M)
- Acceptance: MSW handler module + fixture loader + contract-suite runner stub (returns TODO suite) + env-kill guard.
- Verify: unit test refuses real-GitHub without env flag (INV-A05-adjacent).
### Task P0.7 — E2E skeleton (S)
- Acceptance: chromium-only project + smoke + catch-all origin assert wired.
- Verify: `pnpm e2e` green.
### Task P0.8 — CI pipeline (M)
- Acceptance: full gate matrix committed (see P0 file) + scheduled audit job.
- Verify: first push green on CI (owner schedule the push when finishing).
### Task P0.9 — Changesets (S)
- Acceptance: `pnpm changeset` operates; private packages are VERSIONED by changesets but never published/tagged (publish-skip only — ADR-0010; wording fixed 2026-10-27, supersedes "private-version-skip")
- Verify: doc change w/ changeset file passes CI.
### Task P0.10 — LICENSE final (XS) — ask owner for name once.
### Task P0.11 — ADR verification pass (S) — notes on 0001–0010 implementability; deviations → spec updates first.
### Task P0.12 — Commands finalization (S) — AGENTS.md §6 + spec §3 get the real wording.

**Checkpoint: Foundation** — clean-clone install → typecheck → lint → test → build → e2e green end-to-end; owner review.

## Phase 1 — Config + read path (see `P1-config-read.md`)

### P1.1 — Zod-first DSL + closed config document (M, seq)
- Acceptance: `fields.*` factories return zod schemas carrying CMS metadata; `defineCollection({schema: z.object(...)})` walks the shape; `toAdminConfig()` emits JSON-safe descriptors and `parseAdminConfig()` rejects unknown types/keys/duplicates naming collection+field; `schemaVersion` required.
- Verify: `pnpm --filter @mycms/core test -- src/config` + DSL tests.
- Files: `packages/core/src/fields/*`, `packages/core/src/config/*`.

### P1.2 — Field registry + lenient parse + strict validator (M, after 1)
- Acceptance: 12 value types registered with `{value, raw, config}` typing; parse returns `{value, issues, untouched}`; no default is ever injected; strict-save validator refuses unclean entries (including the 5 invalid drift cases); relation context validator async.
- Verify: `inv-lenient-strict.test.ts`, `inv-default-immune.test.ts`, per-type tests.
- Files: `packages/core/src/fields/parse.ts`, `validate.ts`, `__tests__/`.

### P1.3 — Source-preserving serializer + canonical printer (M, after 2 + fixture mirror)
- Acceptance: `serializeDocument(parseDocument(raw)) === raw` for every mirrored fixture; canonical printer emits 2-space/LF/trailing newline/author key order for new/edited docs; CRLF canon-equal; no-op tree diff empty.
- Verify: `inv-noop-diff.test.ts`, `golden-byte-identity.test.ts` vs fixture manifest.
- Files: `packages/core/src/serialization/*`, fixture tests.

### P1.4 — GitBackend read ops + branch law (M, seq w/ 1)
- Acceptance: `readTree`/`readFile`/`listChangedFiles` on `GithubBackend`; `TreeEntry.path`; recursive reads assert `!truncated` with subtree fallback; ETag conditional result; branch parameter on every method; no `main` literals; contents→blob fallback >1MB.
- Verify: `inv-branch-param.test.ts`, `inv-truncation.test.ts`, transport tests vs MSW.
- Files: `packages/core/src/backend/*`.

### P1.5 — Snapshot store + ETag cache in queryFns (M, after 4)
- Acceptance: monotonic advance; tree/blob keyed by immutable sha; conditional GET returns `not-modified`; admin query keys carry `refSha`; no second UI cache.
- Verify: `inv-fresh-binding` foundation test (stale snapshot never overwrites verified head); cache unit tests.
- Files: `packages/core/src/cache/*`, `packages/admin/src/admin/queries.ts`.

### P1.6 — parseUntrustedJson + caps (S, seq w/ 2)
- Acceptance: prototype keys stripped at every depth; 2MB/depth-64/5k caps; Result-shaped failures; repo-wide sink/merge grep gate.
- Verify: `inv-prototype-pollution.test.ts`, `inv-parse-caps.test.ts`.
- Files: `packages/core/src/safety/untrusted-json.ts`.

### P1.7 — Read-side contract suite (M, after 4–5)
- Acceptance: same suite passes FakeGithub AND `reference-fixture-backend`; covers refs, tree paths, diff add/modify/delete, truncation fallback, blob reads, typed 404.
- Verify: `pnpm --filter @mycms/core test -- src/backend`.
- Files: `packages/core/src/backend/contract-suite/*`, `backends/reference-fixture-backend/*`.

### P1.8 — AuthProvider/PatProvider + capability probe (M, after 5)
- Acceptance: PAT lifecycle per ADR-0002 (remember on device / session fallback / wipe on sign-out); probe reads rate_limit/repo/protection-admin/check-runs; Checks-read missing is advisory; token never in URL; probe never persisted.
- Verify: `inv-probe.test.ts`, token hygiene tests.
- Files: `packages/core/src/auth/*`, `packages/core/src/web/*`, `packages/core/src/backend/github/*`.

### P1.9 — Admin shell + login (M, after 8)
- Acceptance: login PAT card + remember checkbox + guided probe errors; shell routes/tokens; copy through `t()` with founder vocabulary.
- Verify: admin unit tests + e2e login journey.
- Files: `packages/admin/src/screens/login-screen.tsx`, `admin/mount.tsx`, `admin/routes.tsx`, `copy/*`.

### P1.10 — Library screen (M, after 2, 5, 9)
- Acceptance: config-driven groups/search/sort/view groups; mustache-lite summaries (text nodes only); thumbnails via media resolver; preview links via `safeUrl` + `target=_blank rel=noopener noreferrer`; drift chip.
- Verify: library unit tests + e2e browse.
- Files: `packages/admin/src/screens/library-screen.tsx`, components.

### P1.11 — ServicesProvider + entryIndex + entry view (M, after 5, 10)
- Acceptance: `entryIndex` sync from Query cache with async fallback; relation display resolves target title; read-only entry view renders all field kinds incl. hidden drawer and drift banner.
- Verify: services tests + e2e open 3 entries.
- Files: `packages/admin/src/admin/services-provider.tsx`, `screens/entry-screen.tsx`.

### P1.12 — yve fixture mirror + drift fixtures (M, after 3; mirror built early)
- Acceptance: 14 content files + 24 images copied verbatim from `yve_gallery_decap@e922bbb`; manifest pins SHA-256 + git blob/tree/head shas; yve config ported to DSL; 6 drift fixtures loaded in test collection; library shows all clean entries + drift banners.
- Verify: sync script check mode + fixture tests + e2e.
- Files: `scripts/sync-yve-fixtures.mjs`, `playground/fixtures/**`, `playground/src/config/*`.

### P1.13 — Collator + money + slug-read (S, after 2)
- Acceptance: shared comparator matches nl-NL `localeCompare`; money `€ 1.475` via Intl; slug derived from filename, never stored.
- Verify: `collator.test.ts`, `money.test.ts`, `slug.test.ts`.
- Files: `packages/core/src/safety/collator.ts`, `money.ts`, `slug.ts`.

### P1.14 — FakeGithub reads + chaos (M, after 4)
- Acceptance: MSW handlers for repo/ref/tree/blob/check-runs/protection/rate_limit; ETag 304; truncation/404/429 chaos; browser fixture loader; contract suite green.
- Verify: `pnpm --filter playground test` + e2e.
- Files: `playground/src/fake-github/*`, `playground/public/mockServiceWorker.js`.

**Checkpoint: P1** — e2e browse journey + INV-S01–S06 + P14 + A03(partial) + T01–T03 + read-side suite green.

## Phase 2 — Save pipeline (see `P2-save-pipeline.md`)
```
C.1  P2.1 commitChanges full path (M) → P2.2 error taxonomy + classifier (M) → P2.3 retries + throttling (M)
C.2  P2.4 invariant engine + rebase() + property tests (L → split if >2 session)
C.3  P2.5 state machine + lease + drafts + boot replay (L) → P2.6 editor v0 + save bar (M)
     → P2.7 sweep verdict logic + advisory chips (M) → P2.8 deploy-status service (M)
     → P2.9 conflict freeze UI field-granular (M, UX core lands here) → P2.10 failure screens + copy composer (M)
     → P2.11 recorded-fixture capture script + replay (S) → P2.12 e2e journeys (M)
```
**Checkpoint: P2 (3 mini-gates)** — every INV-P + A01/A02/N01 + D01–03 green; owner demo of publish loop.

### P2.7 — Lease-notice completion + sweep verdict classes + advisory chips (M, after P2.6)

- Acceptance (ADR-0004 P2.7 pins FIRST): `SaveLease.onFreed(key, handler)` fires exactly when an observed foreign `release` leaves the key with no live claim and we don't hold (BroadcastChannel + storage carriers); the lost-lease notice clears via re-acquire — manual "Check again" button and auto on release, NEVER a timed acquire (no stealing from live-but-throttled tabs); Save stays disabled while lost (UX serialization). After a `published` verdict (never `noop`), admin `sweepSite` re-reads all content files fresh at `verdict.commitSha` (tree without etag; file reads revalidate on content-addressed blob shas — INV-P08 applies to conflict challenge reads only) without touching React Query caches; pure `classifySweep` → `upToDate | advisory(one problem per entry, first error issue) | unknown`; advisory chips (one per problem entry, dismissible, "Take me there" route link + minimal clipboard "Copy message for {name}"; deck copy says "saved", never the banned "committed") never gate Save; any read failure → `unknown` coverage-honest chip. `AdminMountOptions.leaseTtlMs` plumbed to `createSaveLease`; playground honors `?leaseTtlMs=` for e2e determinism.
- Verify: core focused `pnpm --filter @mycms/core test -- src/pipeline/__tests__/inv-save-lease.test.ts --coverage.enabled=false`; admin `pnpm --filter @mycms/admin test`; `pnpm -r typecheck && pnpm run check && pnpm -r build`; `pnpm e2e` 4/4 (save + smoke + lease-journey + advisory-chip); INV-P15 row ticked with evidence; INV-P13 row gains the notice-clear note.
- Dependencies: ADR-0004 P2.7 addendum commit lands before any mechanism commit.
- Files: `packages/core/src/pipeline/save-lease.ts` (+ `__tests__/inv-save-lease.test.ts`), `packages/admin/src/admin/types.ts`, `packages/admin/src/runtime/context.tsx`, `playground/src/main.ts`, `packages/admin/src/editor/{save-bar-model,save-bar,copy,entry-editor,save-sweep,advisory-chip}.{ts,tsx}` + `__tests__/`, `e2e/specs/{lease,advisory-chip}.spec.ts`.
- Size: M — sliced as 7 commits (ADR docs → core onFreed → ttl plumb → notice UI → sweep → chips → e2e).

### P2.8 — Deploy-status service: check-runs, grace, supersede, per-entry chip + site banner (M, after P2.7)

- Acceptance (ADR-0008 P2.8 appendix + ADR-0005/0003 addenda FIRST): `GitBackend` gains required `readCheckRuns(branch, sha)` / `readCommitStatuses(branch, sha)`, both gated by `capabilities.commitStatus` (`unsupported` with no network when false), `per_page=100` with `totalCount` honesty (incomplete page ⇒ unavailable), and the classified read-error path (403 + rate-limit header ⇒ RATE_LIMIT; any read error ⇒ unavailable + stop, never failed). `FakeGithubServer` gains stateful check-runs/statuses with setters and branch-or-sha route resolution; the contract suite grows `STATUS_READ_CHECK`; the playground MSW adapter delegates these routes to the core model (replacing the static check-runs stub) and keeps the single-branch fallback. Core `src/status/` ships pure classifiers + `createStatusWatcher` with injected `now`/`schedulePoll`/`random`: failure-first matrix, neutral/skipped never Live, 5 s → 10 s jittered, 120 s grace ⇒ unavailable, 10 min max ⇒ stale stop, terminal stop, head-read supersede, statuses fallback only through `deploy.contexts`. Admin: session-only publish store (`entryId → latestCommitSha`), sha-keyed refcounted registry + `useSyncExternalStore`, gate on `capabilities.commitStatus && probe.checksRead === "ok"` (off copy, no spinner loop), per-entry chip + top-bar site banner, `STATUS_COPY` added to the banned-word sweep; timing overrides via `AdminMountOptions.statusTiming` and the six playground URL params. `deploy.contexts` added to `ConfigOptions`/`ConfigDefinition`/`AdminConfig` + strict schema + duplicate rejection (absent/empty = fallback off).
- Verify: core focused `pnpm --filter @mycms/core test -- src/status src/backend/__tests__/contract-suite.test.ts --coverage.enabled=false`, then full core tests with `src/status/**` in the coverage gate; admin `pnpm --filter @mycms/admin test`; `pnpm -r typecheck && pnpm run check && pnpm -r build`; `pnpm e2e` (existing 5 + live · grace-unavailable · failed-link · supersede journeys, zero regressions); `pnpm run scan:workflows && pnpm run scan:prod-purity && pnpm run audit:waivers`; INV-D01/D03 rows ticked with evidence; INV-P14 scan extended to `src/status`.
- Dependencies: the three ADR addenda land before any mechanism commit.
- Files: `packages/core/src/backend/{types,fake-github-server}.ts`, `packages/core/src/backend/contract-suite/index.ts`, `packages/core/src/backends/{github,reference-fixture-backend}/index.ts`, `packages/core/src/config/{types,schema,document}.ts`, `packages/core/src/status/**`, `packages/core/src/backend/__tests__/inv-branch-param.test.ts`, `packages/admin/src/status/**`, `packages/admin/src/runtime/context.tsx`, `packages/admin/src/admin/types.ts`, `packages/admin/src/editor/{copy,entry-editor}.{ts,tsx}`, `packages/admin/src/screens/{entry-screen,app-shell}.tsx`, `playground/src/{main.ts,fake-github/handlers.ts}`, `e2e/specs/deploy-status.spec.ts`.
- Size: M — commit slider: ADR docs → config → backend reads → fake/contract/probe → status core → watcher tests → admin registry/store → chip → banner → e2e → docs sync.

### P2.9 — Conflict freeze UI: field-granular rows, save-gate, explicit resolve, auto-merge base adoption (M, after P2.8)

- Acceptance (ADR-0004 P2.9 appendix FIRST): Freeze panel renders above the field grid for both in-flight CAS conflicts and boot-time draft conflicts; per-field comparison rows (minimal common nodes) display remote ("the other version") vs local ("my version") subtrees as plain text; Save is blocked (`canSave: false`) while any row is undecided; decisions edit the form value only (explicit save law preserved); degraded branch renders with "Start over from the latest version" when merge preview is unavailable; SaveReconciliation on published/noop verdicts preserves partner's disjoint auto-merge bytes and replays late keystrokes; boot draft partial resolution preserves disjoint unconflicted edits.
- Verify: core unit tests (`field-path-writers.test.ts`, `save-controller.test.ts`, `boot-replay.test.ts`); admin jsdom unit tests (`freeze-model.test.ts`, `freeze-panel.test.tsx`, `copy.test.ts`, `save-bar.test.ts`, `form-value.test.ts`); `pnpm -r typecheck && pnpm run check && pnpm -r build`; `pnpm e2e` 11/11 (save · smoke · 2 lease · chip · live · grace · failed-link · supersede · 2 conflict); `pnpm run scan:workflows && pnpm run scan:prod-purity && pnpm run audit:waivers`; INV-P16/P17 ticked.
- Dependencies: ADR-0004 P2.9 appendix committed before code.
- Files: `packages/core/src/pipeline/{field-paths,save-controller,boot-replay,types}.ts`, `packages/core/src/safety/index.ts`, `packages/core/src/index.ts`, `packages/admin/src/editor/{freeze-model,freeze-panel,copy,save-bar-model,form-value,entry-editor}.{ts,tsx}`, `playground/src/{main.ts,fake-github/foreign-commit.ts,fake-github/handlers.ts}`, `e2e/specs/conflict.spec.ts`.
- Size: M — 10 commits: ADR docs → path writers → core preview widenings & SaveReconciliation → freeze model → FREEZE_COPY → freeze panel → editor wiring → playground seams → e2e journeys → docs & invariant sync.

### P2.10 — Failure screens, in-place re-auth sheet, rate countdown, structured copy composer (M, after P2.9)

- Acceptance (ADR-0004 P2.10 appendix FIRST): `GithubBackend` supports dynamic token accessor `token: string | (() => string | undefined)` and `setToken(token)` so in-place re-auth does not recreate coordinators or drop in-flight save jobs (INV-A01); mid-save 401 pauses the coordinator, preserves drafts on device, and displays the In-Place Re-auth Sheet; valid access key entry re-probes capabilities, updates backend token in place, and calls `coordinator.resumeAuth()` to complete the save; `FAILURE_COPY`, `REAUTH_COPY`, and `RATE_COPY` decks are strictly free of the 9 banned words; primary rate limit exhaustion renders a live countdown timer calculated from target epoch (`Date.now() + waitMs`) with `aria-hidden` ticker and milestone-only `aria-live` announcements (INV-N01); manual "Try saving now" override calls `coordinator.resume(draftKey)`; `composeFailureReport` composes dual-audience diagnostic payloads (founder plain text + partner technical diagnostic bullets) and copies via `navigator.clipboard.writeText` with visual feedback; docked `FailureCard` renders above SaveBar on non-quota failures; `EntryScreen` displays classified read error screens with re-auth prompt on 401.
- Verify: core unit tests (`github-backend.test.ts`, `inv-error-taxonomy.test.ts`, `inv-rate-policy.test.ts`); admin jsdom unit tests (`copy.test.ts`, `failure-report.test.ts`, `reauth-sheet.test.tsx`, `failure-card.test.tsx`, `rate-limit-timer.test.tsx`); full workspace `pnpm -r typecheck && pnpm run check && pnpm -r build`; `pnpm e2e` (all 11 existing + `token-death.spec.ts` + `rate-limit.spec.ts`, 13/13 green); supply-chain scans (`scan:workflows`, `scan:prod-purity`, `audit:waivers`); INV-A01 ticked, INV-A02 and INV-N01 updated.
- Dependencies: ADR-0004 P2.10 appendix committed before code.
- Files: `packages/core/src/backends/github/index.ts`, `packages/core/src/backends/github/__tests__/github-backend.test.ts`, `packages/admin/src/runtime/context.tsx`, `packages/admin/src/editor/{copy,failure-report,reauth-sheet,rate-limit-timer,failure-card,entry-editor,advisory-chip}.{ts,tsx}`, `packages/admin/src/screens/entry-screen.tsx`, `packages/admin/src/editor/__tests__/{copy,failure-report,reauth-sheet,failure-card}.test.{ts,tsx}`, `playground/src/{main.ts,fake-github/handlers.ts}`, `e2e/specs/{token-death,rate-limit}.spec.ts`.
- Size: M — 8 commits: ADR docs → core dynamic token seam → copy decks & scanner → structured copy composer → rate limit timer → reauth sheet → failure card & editor wiring → e2e & invariant sync.

### P2.11 — Recorded-fixture capture script + replay transport (S, after P2.10)

- Acceptance (ADR-0005 P2.11 addendum FIRST): `createReplayFetch` implements in-memory `FetchLike` replaying recorded HTTP traffic via Keyed-Endpoint FIFO Queue matching (incorporating method, normalized URL, If-None-Match ETag, and body SHA-1 hash to eliminate concurrency races while supporting monotonic state transitions); case-insensitive header lookup (`response.headers.get`); descriptive diagnostic errors on mismatch; `scripts/capture-recorded-fixtures.mjs` runs natively on Node 22 (`fetch`, `crypto`, `fs`) supporting both live GitHub sandbox recording and synthetic seed generation via `FakeGithubServer`; redaction pipeline scrubs Authorization tokens (`Bearer [token]`), strips personal emails (`cms-contract-bot@example.com`), allowlists functional response headers (`etag`, `content-type`, `x-ratelimit-*`, `retry-after`), preserves 422 CAS fast-forward error bodies, parameterizes repository identity, and enforces a pre-write fail-closed regex scan; `GithubBackend` driven by `createReplayFetch` passes `CORE_CONTRACT_SUITE` (8/8 checks, 42/42 interactions drained); `packages/core/src/backend/contract-suite/README.md` documents contract checks and sandbox recording runbook.
- Verify: core unit tests (`recorded-replay.test.ts`, `github-backend-replay.test.ts`, `inv-branch-param.test.ts`, `repo-bans.test.ts`); full core tests `pnpm --filter @mycms/core test` (coverage ≥90% stmts and lines held); `node scripts/capture-recorded-fixtures.mjs --check`; `pnpm -r typecheck && pnpm run check && pnpm -r build && pnpm e2e`; supply-chain scans (`scan:workflows`, `scan:prod-purity`, `audit:waivers`).
- Dependencies: ADR-0005 P2.11 addendum committed before code.
- Files: `docs/adr/ADR-0005-transactional-backend.md`, `packages/core/src/backends/github/recorded-replay.ts`, `packages/core/src/backends/github/__tests__/recorded-replay.test.ts`, `packages/core/src/backends/github/__tests__/github-backend-replay.test.ts`, `packages/core/src/backends/github/__tests__/fixtures/recorded-contract-tape.json`, `packages/core/src/backends/github/index.ts`, `packages/core/src/index.ts`, `scripts/capture-recorded-fixtures.mjs`, `package.json`, `packages/core/src/backend/contract-suite/README.md`.
- Size: S — 5 commits: ADR addendum → replay transport → capture script → golden tape & replay tests → contract README & docs sync.

### P2.12 — E2E journeys: kill-tab recovery, parked tx recovery, final publish-loop demo (M, after P2.11)

- Acceptance (ADR-0004/0005 verification notes FIRST): Typed IndexedDB inspector `e2e/support/idb.ts` safe for Node TS; playground `?bootDraftDemo=equal` query seam pre-seeding matching draft and commit in `mycms` IndexedDB; `e2e/specs/kill-tab.spec.ts` proving `INV-P12` (kill tab mid-commit triggers boot offer on canon-diff, equal draft auto-discards without toast, and draft persists across network fault before ref-verify then gets cleaned up only post-ref-verify); `e2e/specs/parked-tx.spec.ts` proving `INV-P11` (429 quota park tab closed/reopened, draft restored via boot offer, clean publish); `e2e/specs/publish-loop.spec.ts` proving full publish loop demo (authentication, multi-field edit, value-domain dirtiness tracking, atomic commit, `deploy-status-chip` polling/live transition, post-save advisory sweep `allClear`, IDB draft deletion, and immediate second save on observed base); `test.slow()` on rate-limit tests for parallel worker headroom.
- Verify: `pnpm -r typecheck && pnpm run check && pnpm -r build`; full unit tests `pnpm -r test` (core 454/454 @ ≥90% stmts & lines, admin 126/126, playground 18/18); `pnpm e2e` (all 19 tests across all 10 specs pass in parallel); supply-chain scans (`scan:workflows`, `scan:prod-purity`, `audit:waivers`); INV-P12 row ticked with evidence; Phase 2 Exit gate checklist verified.
- Dependencies: ADR-0004/0005 verification notes committed.
- Files: `docs/adr/ADR-0004-rebase-state-machine-lease.md`, `docs/adr/ADR-0005-transactional-backend.md`, `playground/src/main.ts`, `e2e/support/idb.ts`, `e2e/specs/kill-tab.spec.ts`, `e2e/specs/parked-tx.spec.ts`, `e2e/specs/publish-loop.spec.ts`, `e2e/specs/rate-limit.spec.ts`, `docs/specs/invariants.md`, `docs/specs/phases/P2-save-pipeline.md`.
- Size: M — completed 2026-10-30.


## Phase 3 — Widgets (see `P3-widgets.md`)

Tasks P3.1–P3.9 in the phase file; sizes S/M; parity golden (INV-C01 initial) is the phase goal.

**Checkpoint: P3** — "yve exact config editable, zero code change" demonstrated.

## Phase 4 — Media (see `P4-media.md`) — Tasks P4.1–P4.9; INV-M/T04/T05/N03.

### P4.1 — Media service: path bijection, collection overrides, and budget math (M)
- Acceptance: ADR-0007 / ADR-0005 P4 addenda FIRST; `TreeEntryTuple` widened with optional `size?: number`; `GitBackend` widened with required `readBlob(sha: string): Promise<Uint8Array>`; `GithubBackend`, `FakeGithubServer`, and `ReferenceFixtureBackend` updated with contract suite `BLOB_READ_CHECK`; `resolveMediaFolders(config, collectionName?)` resolves collection-level override or root `config.media`; `publicPathToRepoPath(publicPath, media)` and `repoPathToPublicPath(repoPath, media)` validate paths via `safePath()` (no traversal, no backslashes, absolute public paths, relative repo paths) using longest-prefix matching; bijection identity holds: `repoPathToPublicPath(publicPathToRepoPath(p)) === p` (INV-M01); `calculateMediaBudget(treeEntries, media)` computes total media bytes and file count from tree entries in $O(N)$ with zero network calls, warning at $\ge 800\text{MB}$ or $\ge 2,500$ files, and identifying single-file client blocks at $>90\text{MiB}$.
- Verify: `pnpm --filter @mycms/core test -- src/media/__tests__/inv-media-bijection.test.ts src/backend/__tests__/contract-suite.test.ts --coverage.enabled=false`.
- Files: `docs/adr/ADR-0007-media-pipeline.md`, `docs/adr/ADR-0005-transactional-backend.md`, `packages/core/src/backend/types.ts`, `packages/core/src/backends/github/index.ts`, `packages/core/src/backend/fake-github-server.ts`, `packages/core/src/backends/reference-fixture-backend/index.ts`, `packages/core/src/backend/contract-suite/index.ts`, `packages/core/src/media/{types,bijection,budget}.ts`, `packages/core/src/media/__tests__/inv-media-bijection.test.ts`, `packages/core/src/index.ts`.
- Size: M.

### P4.2 — findReferences engine: cross-collection and single-file referential integrity (M)
- Acceptance: Pure function `findReferences(query, entries, config)` in `@mycms/core` with zero DOM dependencies; recursively walks all JSON data structures (objects, arrays, strings) across all loaded folder collections and single-file documents; matches image public paths and relation target slugs; extracts companion `altText` where sibling properties exist in object items (e.g. `{ image, alt }`); returns structured `readonly ReferenceLocation[]` with exact fieldPath breadcrumbs (e.g. `images.0.image`, `featuredProducts.1`, `studyProduct`).
- Verify: `pnpm --filter @mycms/core test -- src/media/__tests__/find-references.test.ts --coverage.enabled=false` verifying exact fixture matches on `home.studyProduct`, `featuredProducts`, and shared image paths (`craft.json` and `bespoke.json`).
- Files: `packages/core/src/media/references.ts`, `packages/core/src/media/__tests__/find-references.test.ts`, `packages/core/src/index.ts`.
- Size: M.

### P4.3 — Web Worker raster pipeline: binary header bomb guard, caps, and EXIF strip (M)
- Acceptance: Node-safe `header-sniffer.ts` parses binary headers (PNG IHDR at offset 16, JPEG SOF0/SOF2 markers, WebP VP8 chunks) to extract natural dimensions before any bitmap allocation; rejects decompression bombs where `width * height > 24,000,000` or max dimension $>8,192\text{px}$; rejects `.svg` uploads and disguised SVGs via magic byte sniffing (`<svg`, `<?xml`) (INV-T04); auto-sanitizes filenames visibly ("écu bad.jpg" $\rightarrow$ "ecu-bad.webp"); Web Worker (`raster.worker.ts`) decodes via `createImageBitmap(blob, { imageOrientation: 'from-image' })`, clamps bounds, draws to `OffscreenCanvas`, and re-encodes to `image/webp` (or `image/jpeg`) targeting $\sim 400\text{KB}$, stripping EXIF by construction while preserving orientation (INV-T05).
- Verify: `pnpm --filter @mycms/admin test -- src/workers/__tests__/raster-pipeline.test.ts`.
- Files: `packages/admin/src/workers/{header-sniffer,raster-types,raster.worker}.ts`, `packages/admin/src/workers/__tests__/raster-pipeline.test.ts`.
- Size: M.

### P4.4 — Staged tile records & atomic commit-with-entry integration (M)
- Acceptance: `DraftStore` interface widened with `deletePrefix(prefix: string): Promise<void>` implemented in `IdbDraftStore` and `MemoryDraftStore`; staged tiles stored under `${repo}/${collection}/${slug}/media/${tileId}`; WebCrypto precomputed `gitBlobSha(bytes)` deduplication; `entry-editor.tsx` discovers staged tiles via `drafts.list("${draftKey}/media/")` and bundles them as `FileWrite { path, bytes }` into `request.changes.adds`; `SaveCoordinator` commits all media blobs + entry JSON in **ONE Git commit, ONE ref PATCH** (INV-M02 batch integrity); post-ref-verify cleanup invokes `await options.drafts.delete(job.key)` AND `await options.drafts.deletePrefix(`${job.key}/media/`)`; boot replay preserves staged tiles on `offer` ("recovered before your last save") and cleans them on `discard`.
- Verify: `pnpm --filter @mycms/core test -- src/pipeline/__tests__/inv-batch-integrity.test.ts --coverage.enabled=false`.
- Files: `packages/core/src/drafts/index.ts`, `packages/core/src/web/idb-draft-store.ts`, `packages/core/src/pipeline/save-controller.ts`, `packages/core/src/pipeline/boot-replay.ts`, `packages/admin/src/editor/memory-draft-store.ts`, `packages/admin/src/editor/entry-editor.tsx`, `packages/core/src/pipeline/__tests__/inv-batch-integrity.test.ts`.
- Size: M.

### P4.5 — Blob API preview cache: ref-counted lifecycle & zero raw URLs (M)
- Acceptance: Central ref-counted `BlobCache` in `packages/admin/src/runtime/blob-cache.tsx`; queries authed `backend.readBlob(sha)` (Git Data API, visibility-agnostic); strictly zero network traffic to `raw.githubusercontent.com` (INV-N03); magic-byte MIME sniffing for Blob instantiation; `URL.createObjectURL(blob)` shared across subscribers with in-flight request deduplication; ref-counted tracking calls `URL.revokeObjectURL(url)` on zero subscribers or component unmount to eliminate memory leaks.
- Verify: `pnpm --filter @mycms/admin test -- src/runtime/__tests__/blob-cache.test.ts`.
- Files: `packages/admin/src/runtime/blob-cache.tsx`, `packages/admin/src/runtime/__tests__/blob-cache.test.ts`.
- Size: M.

### P4.6 — Media library screen & editor integration (M)
- Acceptance: `/media` route added to admin router and sidebar navigation; responsive thumbnail grid powered by `BlobCache`; collection folder filter buttons ("All", "Products", "Collections", "Site"); filename search; details slide-over with thumbnail, copy public path button, file size/dimensions, alt text prefill ("Last used as: ...") powered by `findReferences`; replace-in-place honest CDN cache warning ("Replacing an existing file keeps the same web address. Because public sites cache images, visitors may see the old image for up to 1 hour."); `ImageWidget` connects to staged tiles, shows progress ring, auto-sanitized filename, per-tile retry button, and "Choose from library" modal dialog.
- Verify: `pnpm --filter @mycms/admin test -- src/screens/__tests__/media-library.test.tsx src/editor/__tests__/copy.test.ts`.
- Files: `packages/admin/src/screens/media-library-screen.tsx`, `packages/admin/src/widgets/image-widget.tsx`, `packages/admin/src/admin/routes.tsx`, `packages/admin/src/screens/app-shell.tsx`, `packages/admin/src/editor/copy.ts`.
- Size: M.

### P4.7 — Delete rungs & tombstone storage (M)
- Acceptance: Three delete rungs implemented: 1) Entry Remove (clears field value, leaves media intact in library); 2) Media Library Remove (checks `findReferences(targetPath)` — blocked if referenced with deep links to referencing entries); 3) Tombstone Move (moves unreferenced file to root `_trash/media/{collection}/{filename}` in a single Git commit); tombstone root `_trash/` is strictly outside `public/` and outside all collection folders, ensuring build-invisibility; collision check before restore; `/trash` route (Recently Deleted) lists tombstoned files with restore button and honest subtitle note before the button ("Restoring puts this photo back in your library. If an entry previously used it, you will need to re-select it in that entry.").
- Verify: `pnpm --filter @mycms/core test -- src/media/__tests__/inv-referential-delete.test.ts --coverage.enabled=false`.
- Files: `packages/core/src/media/delete-ladder.ts`, `packages/admin/src/screens/recently-deleted-screen.tsx`, `packages/admin/src/admin/routes.tsx`, `packages/core/src/media/__tests__/inv-referential-delete.test.ts`.
- Size: M.

### P4.8 — Content trust & SVG safety e2e (S)
- Acceptance: Playwright E2E spec in `e2e/specs/svg-trust.spec.ts`; asserts SVG uploads are rejected in UI with explanatory copy; asserts disguised SVGs (.svg renamed to .png) are rejected by header sniffer; asserts existing repository SVGs render strictly via `<img src="blob:...">` (INV-T04; zero inline `<svg>`, `<object>`, or `<iframe>`); asserts zero network requests to `raw.githubusercontent.com` (INV-N03).
- Verify: `pnpm e2e -- e2e/specs/svg-trust.spec.ts`.
- Files: `e2e/specs/svg-trust.spec.ts`.
- Size: S.

### P4.9 — Slow-wifi 9-photo e2e journey & replace-in-place copy verify (M)
- Acceptance: Playwright E2E spec in `e2e/specs/slow-wifi.spec.ts` with `test.slow()` (90s headroom); tests playground chaos mode with simulated packet drop on tile #7; 8 photos stage cleanly, photo #7 shows retry button; clicking Retry re-sends ONLY the failed file (asserts server log has exactly 1 additional blob POST); clicking Save dispatches exactly **ONE commit, ONE ref PATCH** bundling all 9 photos and the entry JSON (INV-M02); asserts replace-in-place CDN honesty copy in the media library.
- Verify: `pnpm e2e -- e2e/specs/slow-wifi.spec.ts` + full gate check `pnpm e2e`.
- Files: `playground/src/fake-github/handlers.ts`, `e2e/specs/slow-wifi.spec.ts`.
- Size: M.

**Checkpoint: P4** — 9-photo slow-wifi journey green; tombstone restore green.

## Phase 5 — Polish + IA (see `P5-polish-ia.md`) — Tasks P5.1–P5.10; founder-cry triad scripts; copy scanner; a11y suites.
**Checkpoint: P5** — owner demo of consent→edit→conflict→failure→recover loop.

## Phase 6 — Cutover (see `P6-cutover.md`) — ordered stop-and-confirm stages 1–7; yve writes are Ask-first.
**Checkpoint: P6 = Stage A done.**

## Phase 7 — OSS (see `P7-oss.md`) — Tasks P7.1–P7.7.
**Checkpoint: P7 = published; Stage B continues via Appendix B backlog.**

## Risks & mitigations (top, from panel — full register master-plan §13)
| Risk | Mitigation |
|---|---|
| CAS/concurrency bugs corrupt content | property tests + chaos e2e + recorded fixtures; never force:true |
| Silent build failures destroy trust | milestone law, copy-message composer, check-runs truth |
| XSS via unfriendly renders | sanitize ADR set + golden suite + CI lint gates |
| Supply chain compromise | allowlist/frozen/audit/waiver-expiry + origin assertions |
| Founder-FRICE (PAT expiry/conflict/delete dread) | UX law + tombstones + expiry kit — all phase-5 gated |
| yve integration breakage | fork rehearsal first; schema swap behind fixture; /admin-legacy rollback |

## Open questions
- None blocking P0; see `01-spec.md §8`.
