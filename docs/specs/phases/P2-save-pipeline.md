# Phase P2 — Save pipeline + editor v0

> Status: 🟨 · Prev gate: P1 ✅ · **C.1 ⛔ PASSED — owner-confirmed in chat, strictly scoped (INV-P01/02/03/09/14)** · next slice: C.2 (new chat)

## Pre-flight checklist
- [x] P1 gate ✅; `01-spec.md` §5 state law read; ADRs to load now: **0004 (rebase + state machine + lease) — THE phase ADR**, **0005 (transactional backend)**, **0008 (status truth)**, plus 0002 (token lifecycle edges) (loaded 2026-10-27)
- [x] `invariants.md` INV-P*/A01/A02/N01/D01–03 fully internalized (P01–P03/P09/P14+A02/N01/D02 subset exercised in C.1)
- [x] Checkpoint plan: implement in C.1 → C.2 → C.3 slices, each with its own mini-gate (below) — never bulk-build this phase in one session block

## Goal
The full **publish loop**: edit → validate → squash-commit → FF ref update → per-entry build status, with typed failure taxonomy and the conflict machinery — the riskiest code in the project, built behind property tests.

## Deliverables
- Core: `commitChanges` transactional pipeline (blobs→tree(base_tree)→commit→updateRef FF) w/ fresh `getRef` before every commit · verify-then-rebuild retry · invariant engine (tuple+canon predicate, fresh-binding) · `rebase()` pure fn + 11 property tests · GitError union + classifier · save state machine + one-flight queue + self-rebase + BroadcastChannel lease (TTL+steal+storage-fallback) · drafts (IDB, pre-network-write assert, post-ref-verify delete) · boot recovery replay
- Admin: entry editor v0 (basic widgets via registry: string/text/number/boolean/select/datetime) + save bar w/ milestone law · deploy-status service (check-runs polling, grace, supersede, contexts fallback) · cross-entry sweep verdict classes + advisory chips + coverage-honest copy · conflict field-granularity freeze UI · failure screens + Copy-message composer w/ `support.name` interpolation
- Tests: INV-P01–P14 green; INV-A01/A02; INV-N01; INV-D01–03; contract suite extended (full commit side vs FakeGithub chaos modes); GithubBackend recorded-fixture capture script (sandbox repo) + first replay fixtures

## Checkpoint slices (mini-gates)
- [x] **C.1 backend commit** — transactional call path + INV-P01/02/03/09/14 green vs FakeGithub chaos hooks (**⛔ gate PASSED 2026-10-27 — owner-confirmed in chat, strictly scoped**)
- [ ] **C.2 invariant engine + rebase()** — INV-P05/06/07/08 + rebase property tests green; conflict decision matrix documented in ADR-0004 appendix
- [ ] **C.3 state machine + UI loop** — INV-P04/10/11/12/13 + editor save bar + status service green; e2e full publish loop (incl. conflict + throttle-park) green

## Gotchas (panel)
- Never trust cached reads in conflict decisions (fresh-binding!) — cache poisoning test is mandatory.
- Do not conflate "Saved ✓" with status verdicts; w/o Checks read the status pre-degrades (copy exists).
- Lease steal must FULLY rebaseline; no blind re-dispatch on resume (paused reasons table).
- Commit messages: `chore(cms): …` prefix, skip-token stripping, user-editable w/ code-free default.

## Exit gate (owner-confirmed)
- [ ] All INV-P/ A01/A02/N01/D01-03 green in CI; e2e publish loop + conflict + parked-tx + token-death journeys green
- [ ] Recorded fixtures captured from sandbox repo + replay test committed; contract suite README short "how to run"
- [ ] Docs: ADR-0004/0005 "verified" notes updated; AGENTS.md status/logs updated

## Session log
- 2026-10-27 — **C.2 built (⛔ pending owner confirmation).** ADR-0004 appendix FIRST (fieldPath segment arrays, fieldEquals value domain, dirty granularity incl. whole-list unit rule, rebase() formal semantics + Result shape, 9-row file-level decision matrix, sameFilePredicateSatisfied = ∀our-paths ∈ {clean-reapply, adopt-remote, mode-restore}). Landmarks: `invariant-engine.ts` (resolveConflictPaths — headEntries input so foreign deletions catch resurrection; injected readFreshBlob seam; notes[] for commit-body warnings), `rebase.ts` (raw-domain splice over a parse of newBaseRaw, verbatim no-op law, conflicts at minimal common node, convergent edits silent, unknowns only from new raw, STALE_BASE guard), `field-paths.ts`/`field-equals.ts`, fast-check wired via catalog (already pinned at P0). Tests: rebase-properties 29 assertions over ALL 11 ADR properties + Result guards; INV-P05/06/07/08 green vs the REAL transport (conflict-fixtures push foreign commits through harness.fetch; P08 conflict-epoch = ref-free foreign commit + moveRefBefore, replayed deterministically via content-addressing). C.2 deviations recorded: FakeGithubServer +/contents route + gitlink tree-POST acceptance + request-header logging (safe — Authorization stripped in the harness adapter); **ADR-0005 P2/C.2 addendum** — recursive reads now surface blob+commit tuples (the blobs-only filter made submodule swaps invisible, turning type-change blocks into phantom resurrections; INV-P06 tuple truth required the read-layer fix). Core 280/280 (+40) · playground 17/17 · coverage gate held · typecheck + biome clean. (session)
- 2026-10-27 — **C.1 ⛔ PASSED** — owner-confirmed in chat, strictly scoped to INV-P01/02/03/09/14 (A02/N01/D02 remain partial evidence in invariants.md). Bookkeeping synced (todo + invariants + AGENTS.md). C.2 (invariant engine + rebase() + property tests) starts in a NEW chat per one-slice-per-chat law. (session)
- 2026-10-27 — **C.1 built (⛔ pending owner confirmation).** ADR-0005 P2 addendum first (`commitChanges options.message`, driver protocol, BackendWriteError vocabulary, hook seam). Landmarks: `FakeGithubServer` truthful git-data model (chaos lives in the harness adapters only; `force:true` honored but logged for INV-P01); `git-sha.ts` WebCrypto SHA-1 framing; `GithubBackend.commitChanges` (≤5 blob pool → base_tree → canonical commit → `force:false` ref PATCH, classified failures, no body leaks); FixtureBackend in-memory CAS; `runSave` driver (skip-token refusal → fresh ref → zero-diff noop → commit → CAS-verdict → rebuild ≤2 → published w/ content-confirm). Contract suite extended with WRITE_COMMIT_CHECK + WRITE_CAS_CHECK, green vs both backends; playground MSW handlers now delegate all git-data endpoints to the core model (write endpoints added, ETag/truncation/auth chaos retained). INV green this session: P01, P02, P03, P09 (+P10 partial), P14, A02 (matrix; screens owed P2.10), A03 (hook seam; re-probe wires at P2.5), N01 (policy math; UI owed P2.5+), D02, S02 (C.1 scope). Core 240/240 · playground 17/17 · typecheck + biome clean. Focused-run note: vitest coverage thresholds fail on single-file runs — focused INV runs use `--coverage.enabled=false`. Open question carried: whether C.1's gate folds A02/N01/D02 evidence or stays strictly P01/02/03/09/14. (session)
