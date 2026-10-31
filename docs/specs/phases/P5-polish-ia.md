# Phase P5 — Founder polish & IA

> Status: ✅ Gate passed 2026-10-31 (owner-confirmed) · Prev gate: P4 ✅

## Pre-flight checklist
- [x] P4 gate ✅; ADRs: 0008 (status honesty), 0002 (bootstrap/restore UX), master-plan §7 (UX law FULL read); founder-cry triad briefs (master-plan §7)
- [x] `tasks/todo.md` § P5 loaded

## Goal
Everything non-structural that makes the founder safe-unaided: global IA surfaces (search/journal/heartbeat/recently-deleted), first-run consent + tour, drift chip, conflict freeze UX completion, copy-law audit, a11y + zoom/keyboard hardening, diagnostics. Ship-blocking rule: **nothing in v1 leaks jargon or raw ids.**

## Deliverables
- IA: global ⌘K search (titles/numbers/material/alt/descriptions across IDB cache, grouped by collection; zero-results teaching) · "My changes" journal v1 (client commit log filtered by author + partner section; entry/sha/time/"See on site") · persistent top-bar heartbeat (site ✓ live · last edit date) · login heartbeat (known-good state)
- First-run: consent pact card (3 sentences, gallery typography, until first publish) · 60-second read-only tour of one real product
- Drift monitor: If-None-Match HEAD poll while-visible/60s, reserved 24px line (no layout jump), 3 visual states + slide-over "what changed" field list / Keep-looking / Reload / "changes will meet your typing when you press Save — we'll guide you" (wording rules: names never "someone", no red until data risk, never sound/popup mid-typing)
- Conflict freeze completion: classify→announce auto-merge list ("Kept [partner]'s caption · Kept your description"); per-field choice rows ("saved by [Milan], 3:05 PM" vs "yours"); 30-day archived discarded version w/ visible copy; attribution from commit author w/ `support.name` fallback
- Copy law audit: ALL chrome strings via `t()` + token interpolation; founder ban-list scan (build/commit/deploy/token/slug→web address/repository/draft) — automated ensure-green; zod codes fully mapped (message map completed)
- Journal/diagnostics: ring buffer + "copy diagnostics" (masked preview + user-initiated only); token expiry kit from ADR-0002 (handover card incl. expiry chosen by owner; expiring-chip "renew after Tue 2 Feb"; three landing screens w/ distinct copy: library bar / editor re-auth sheet / login card w/ prewritten partner note)
- A11y/form-factor sweep: gold-as-accent token audit (≥4.5:1 body, gold ≥18px/semibold/2px ring), focus traps + Escape returns, ↑/↓ reorder + aria-live everywhere, 1280-effective-px + rem tests, keyboard-only e2e journey, `scroll-padding-bottom` under sticky bar
- Tests: founder-cry triad e2e simulations (reported in phase file as script list); a11y axe scans in e2e; copy-rule scanner unit test; INV-A01 full journey re-run in persisted-token mode

## Tasks (plan.md P5.1–P5.10)
- [x] 1. Global search + zero-state teaching
- [x] 2. Journal v1 + login heartbeat + top-bar heartbeat
- [x] 3. Consent pact + tour flow (dismissible-until-first-publish)
- [x] 4. Drift chip + slide-over (INV-fresh re-use; monitor only when visible)
- [x] 5. Conflict freeze field-granularity UI completion (round-2 §3 spec)
- [x] 6. t() extraction + copy ban-list scanner + message-map completion
- [x] 7. Token expiry kit (three screens + handover card + recorded expiry chip)
- [x] 8. A11y pass 1: tokens/contrast audit + reorder aria-live + focus management
- [x] 9. A11y/e2e pass 2: keyboard-only journey + 125% zoom layout + axe scans
- [x] 10. Diagnostics ring buffer + copy-diagnostics + masking tests re-run (INV-A05)

## Gotchas
- Journal is NOT a merge/history browser — v1 = list + links only; field-delta lines are explicitly v2 (scope guard).
- Search reads the IDB/Query cache — it must degrade honestly offline ("last seen copy").
- No new backend calls in this phase without a probe/capability guard.

## Exit gate
- [x] Founder-cry triad simulations scripted + green (triad-conflict-fear.spec.ts, triad-broken-site-fear.spec.ts, triad-lost-work-fear.spec.ts)
- [x] Copy scanner + a11y suite + keyboard journey green; INV-A01 persisted-mode re-run green
- [x] Owner demo of: consent → tour → edit → conflict → failure → recover loop; AGENTS/todos/logs updated (OWNER CONFIRMED in chat 2026-10-31)

## Session log
- 2026-10-31 — Phase 5 exit gate passed: OWNER CONFIRMED in chat; all 10 tasks, 3 triad simulations, and full test/e2e/a11y/guard suites verified green (session)
- 2026-10-31 — Complete implementation of P5 (P5.1–P5.10) verified green: 739 unit tests, 31/31 Playwright E2E tests incl. 3 Founder-Cry Triad simulations, 125% zoom layout, mouse-free keyboard journey, full DOM a11y audit, zero-banned-word AST scans, token expiry kit, diagnostics ring buffer, and supply-chain guards clean (session)
- 2026-10-31 — Comprehensive P5 planning completed: 3-way EGM audit (Codebase details, Hostile design critic, Implementation readiness) synthesized; tasks/plan.md P5.1–P5.10 hardened with exact Acceptance & Verify blocks; IDB unified storage, drift idle backoff, zero-network attribution, and 3 Founder-Cry Triad E2E specs detailed (session)
