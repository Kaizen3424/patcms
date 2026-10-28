# AGENTS.md — MyCMS Agent Operating Manual

> **Every agent session starts here.** Read this file fully, then follow §4 Session Protocol. This file never duplicates details it can point to; it is the single tracker for project state. Agents MUST maintain §3 and the task checklists — stale docs are treated as build failures.

Maintained by: agent sessions · Last updated: 2026-10-27 (P2 C.3 sub-slice P2.7 built & committed `b7dfd07`; next: P2.8 in a NEW chat)

---

## 1. Project identity

**What it is:** a git-backed, zero-database CMS package — a framework-agnostic TypeScript **core SDK** (`packages/core`) + a fully brandable React **admin SPA** (`packages/admin`). Content stays plain JSON files in the user's GitHub repository; the admin talks to `api.github.com` directly with a fine-grained PAT. No server component in v1.

**Stage A (v1 success):** fully replaces Sveltia CMS inside the yve site (below) and a non-technical founder edits content end-to-end unaided. **Stage B (v2, OSS):** publication hygiene — README/demo, Decap `config.yml` importer, OAuth Worker, GitLab backend, optional PR mode. Do not implement Stage B features while P0–P6 are incomplete unless the current phase file says so.

**Genesis documents:** `concepts_brief.md` (owner's v0 brainstorm — the design instincts behind the schema factory, atomic Git Data pipeline, and hidden-field preservation all survived) and `docs/specs/00-master-plan.md` (the hardened master plan — the canon). Superseded deltas are listed in `docs/specs/01-spec.md §2.3`.

## 2. Status board — **AGENTS MUST KEEP THIS CURRENT**

| Phase | Name | Status | Exit gate (full list in phase file) |
|---|---|---|---|
| P0 | Scaffold & laws | ✅ Gate passed 2026-10-27 | CI-verifiable scaffold green; ADRs 0001–0010 signed; specs runnable |
| P1 | Config schema + read path | ✅ Gate passed 2026-10-27 (owner-confirmed) | yve fixture library browses offline; lenient parse contract green |
| P2 | Save pipeline + editor v0 | ✅ Gate passed 2026-10-27 | e2e publish loop green incl. conflict + failure paths |
| P3 | Widget system complete | ⬜ Not started | yve exact config editable on fixtures, zero code change |
| P4 | Media system | ⬜ Not started | 9-photo slow-wifi e2e green; no-raw-URL invariant proven |
| P5 | Founder polish & IA | ⬜ Not started | founder-cry triad simulations green; a11y checklist green |
| P6 | yve integration cutover | ⬜ Blocked until P5 | success criteria on the real site; rollback path proven |
| P7 | OSS publication | ⬜ Blocked until P6 | stranger completes widget exemplar unaided; release dry-run |

**Current focus:** P2 checkpoint **C.3 done — P2.7 built & committed** `b7dfd07` (head of the P2.7 stack `916444c`→`d1edcd3`→`6231ab0`→`b1cd1dd`→`2e45dd0`→`3277f60`→`26cb9b6`→`b7dfd07`). Core 373/373 (53 files) @ 92.32% stmts / 95.51% lines, admin 77/77, playground 17/17, `pnpm e2e` 5/5 (save · smoke · 2 lease · chip). ADR-0004 P2.7 appendix + dated first-come refinement (superseded smaller-id silent-steal-on-arrival; stamps `foreignSeenAt`/`ourHoldStamp`; acquire refuses a LIVE pre-existing hold regardless of id). INV-P04/P10/P11/P13/P15 ticked in invariants.md; INV-P12 stays for P2.12 kill-tab journey. **P2.8 (next C.3 sub-slice) starts in a NEW chat — pick up from `tasks/plan.md` / phase file, not from chat history.** Evidence: `pnpm -r typecheck` + `pnpm run check` + `pnpm -r build` + `pnpm e2e` + supply-chain scans clean. C.1/C.2/C.3 all ⛔ PASSED. P0 remote: `https://github.com/Kaizen3424/pagesmith.git` (final naming sweep P7.1 — working name MyCMS until then).

*Legend: ⬜ not started · 🟨 in progress · ✅ gate passed (date) · ⛔ blocked*

## 3. Session protocol (every new chat)

1. Read this file → note **Current focus**.
2. Read `docs/specs/01-spec.md` fully (the six-area spec).
3. Read the current phase file in `docs/specs/phases/` — its **Pre-flight** section lists the ADRs to load.
4. Open `tasks/todo.md` at the current phase section; work top-down. Tick a checkbox **only** with verified evidence (test/build command output, or an explicit manual check named in the task).
5. Follow the detailed Task blocks in `tasks/plan.md` (acceptance / verify / dependencies / files / size) whenever `todo.md` wording is insufficient.
6. **Deviation rule (living spec):** if reality contradicts spec/ADR, update the spec/ADR FIRST (small, dated note), then the code. Never leave spec and code disagreeing at session end.
7. **Session end (mandatory):** (a) tick/untick `tasks/todo.md` precisely; (b) update §2 status rows; (c) append a dated bullet to the current phase file's **Session log**; (d) fix the **Current focus** pointer; (e) update the "Last updated" line here.
8. **Gates:** each phase file has an Exit gate checklist. Do not start the next phase until every gate item is ticked AND the owner confirmed in chat. If work must continue while a gate is genuinely ready-but-unconfirmed, stage it and say so explicitly.

## 4. Hard rules (boundaries condensed — full Legal text: `01-spec.md §6`)

**Always**
- Run the relevant focused tests before ticking any task.
- Commit with Conventional Commits (`feat|fix|chore(scope): …`; CMS-authored content commits get the machine-checkable `chore(cms):` prefix).
- Write/update the ADR **before** the mechanism it decides lands.
- Keep `branch` a **parameter** on every backend call — `main` must never be hardcoded anywhere.
- Treat ALL repo content (entry JSON, config, media names) as **untrusted input**; parse only via `parseUntrustedJson()`, render templates as text nodes only.

**Ask first**
- New runtime dependencies (each = a runbook PR; postinstall scripts require explicit allowlist entry with reason).
- Config-schema changes, CI/workflow edits, any change to the yve site repo (including its `src/lib/content.ts` contract swap at P6).
- Changing any storage/blob/token-handling decision (ADR-gated).

**Never (standing panel vetoes)**
- `force:true` ref updates; `raw.githubusercontent.com` reads; token in URLs (`?token=` parity rejected forever); `dangerouslySetInnerHTML`/`eval`/`innerHTML=`/unsafe merged JSON anywhere; remote telemetry of any kind (no Sentry-class anything); Object.assign / recursive merges on parsed-untrusted JSON; a second serializer bypassing the editor save path; editing `/admin-legacy` or deleting tests to get green; blocking an unrelated entry save because a *different* file failed validation (advisory-chip rule).
- No human-time estimates anywhere in docs, issues, or commit messages (owner rule) — scope phases by gates, not clocks.

## 5. File map (sources of truth)

| Topic | Source of truth |
|---|---|
| Master plan (canon, provenance, §refs used below) | `docs/specs/00-master-plan.md` |
| Six-area spec (objective/commands/structure/style/testing/boundaries) | `docs/specs/01-spec.md` |
| Testable invariant master list | `docs/specs/invariants.md` |
| Owner's v0 brainstorm | `concepts_brief.md` (read once; deltas in spec §2.3) |
| yve field inventory + 6 drift cases | `docs/reference/yve-inventory.md` |
| Architectural decisions | `docs/adr/ADR-0001…0010+` |
| Task detail | `tasks/plan.md` |
| Live checklist | `tasks/todo.md` |
| Phase briefs & gates | `docs/specs/phases/P0…P7` |

## 6. Commands (materialized 2026-10-27; 01-spec.md §3 mirrors this set)

| Purpose | Command |
|---|---|
| Install (CI parity) | `pnpm install --frozen-lockfile` |
| Typecheck (all) | `pnpm -r typecheck` (per-package `tsc -b .`) · root project-references form: `pnpm typecheck` |
| Lint/format check | `pnpm run check` (= `biome check --error-on-warnings .`) |
| Tests (all) / focused | `pnpm -r test` / `pnpm --filter @mycms/core test -- <file>` |
| E2E | `pnpm e2e` (Playwright, chromium-only; webServer builds + previews the playground) |
| Build all | `pnpm -r build` (tsup for core · vite for admin/playground) |
| Changeset | `pnpm changeset` (non-interactive sanity: `pnpm changeset status`) |
| Supply-chain guards | `pnpm run scan:workflows` · `pnpm run scan:prod-purity` · `pnpm run audit:waivers` |

pnpm is pinned via the root `packageManager` field (corepack; 10.34.9). `.nvmrc` pins CI to 22; local Node only has to satisfy `engines` (≥22.12) — owner decision 2026-10-27, ADR-0010 §5 addendum.

## 7. Documentation rules

- Update order on conflict: **spec/ADR → todo/plan → code → AGENTS.md status**.
- `00-master-plan.md` is an archived canon snapshot: do **not** edit it in place; supersede by writing the corrected statement in `01-spec.md` (and the relevant ADR), noting "supersedes master-plan §X" .
- Phase files' **Session log** sections: newest bullet first, format `- YYYY-MM-DD — <one-line note> (session)`.
- The owner reviews gates in chat; agents never self-approve a gate.
