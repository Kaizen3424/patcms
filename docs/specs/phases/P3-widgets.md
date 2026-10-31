# Phase P3 — Widget system complete

> Status: ✅ Gate passed 2026-10-31 (owner-confirmed in chat) · Prev gate: P2 ✅

## Pre-flight checklist
- [x] P2 gate ✅; ADRs: **0003 (DSL shapes)**, **0009 (registry + exemplar)**, master-plan §6 + Appendix A inventory OPEN in another pane — this phase porting the yve config is 1:1
- [x] `tasks/todo.md` § P3 loaded

## Goal
Every widget yve needs — incl. the custom `swatch` reference and the trixie nested list-of-lists — plus the new-entry/hidden-field/slug lifecycle features, verified by **porting the exact yve config** and editing every field type on fixtures w/o code changes.

## Deliverables
- Widgets: list (min/max, reorder, item summaries w/ mustache-lite), object (nested, incl. list-of-lists), image (upload→draft staging handoff to P4 semantics; alt +/- objectPosition nested hidden), relation (single/multi: search via services, display "Iris No. 7", removed-product rows w/ Remove chip), hidden (repair-on-save + "Behind the scenes" drawer in human language; drawer rows state site-effect or "not shown on your site right now"), slug lifecycle (pre-publish editable chip + regeneration + collision suffix dialog; post-publish locked drawer → one-tap partner note), select w/ swatch color dots (reference widget = ADR-0009 exemplar acceptance), templates ("Start from: Iris No. 3" deep-clone+strip w/ media references + "nothing published until Save" banner — prefill one sensible row per required list; disable-remove w/ inline reasons)
- Validation UX: zod error codes → human message map (per drift case: "Price — whole euros, e.g. 1450"; "email needs @ and a dot"); never raw ids anywhere
- Editor chrome: sticky save bar finalized, unsaved guard, change-strip (before/after values list + expandable), dirty view-page relabeling
- Parity golden test: config-package output vs `docs/reference/yve-inventory.md` inventory (INV-C01 initial form)
- Tests: golden XSS suite incl. new widgets (INV-T01 extended); widget registry snapshot test (ADR-0009); drift-case message map fixtures; keyboard-only widget spreadsheet a11y pass begins ( ↑/↓ reorder + aria-live counts)

## Tasks (plan.md P3.1–P3.9, in order)
- [x] 1. list/object widget infra (drag-free reorder: buttons + aria-live; add/remove w/ inline reasons; min/max guard rails)
- [x] 2. image widget v1 (render + crop-resize modal integration against staged-tile contract from P4 — stages record now, upload path lands P4)
- [x] 3. relation widget via ServicesProvider (search/display/removed-chips)
- [x] 4. hidden repair-on-save + Behind-the-scenes drawer (copy law)
- [x] 5. slug lifecycle chip + collision dialog + partner-note drawer
- [x] 6. reference-swatch widget per ADR-0009 acceptance checklist (registry snapshot + XSS goldens)
- [x] 7. templates "Start from" data model (deep-clone+strip ADR-note in 0003 appendix) + new-entry flow screens
- [x] 8. message map module (codes→prose) per drift case + validator copy, `support.name` interpolation
- [x] 9. yve config port into playground config (`playground/config/yve.config.ts`) + parity golden (INV-C01) + e2e "edit every field type on fixtures" journey

## Gotchas
- option panels & item summaries: mustache-lite output = TEXT nodes only (re-run golden suite).
- list value domain: order significant (`fieldEquals`) — reordering marks dirty cleanly (rebase property tests must still pass; run suite).
- "exactly 4 features" list (craft.json) exercises max==min — disable remove+add correctly.
- Do not let services reach into the backend (veto) — entryIndex only.

## Exit gate
- [x] e2e: full yve product entry edit incl. choice-tabs nested lists; collection entry; craft features reorder; bespoke diameters; relation repair chip — all green
- [x] INV-T01 extended green; parity golden green; ADR-0009 exemplar acceptance signed (registry snapshot present); message map fixtures green
- [x] AGENTS/todos/logs/gates updated

## Session log
- 2026-10-31 — Phase 3 Gate CONFIRMED by owner in chat; next: Phase 4 (Media system) in a NEW chat
- 2026-10-31 — Phase 3 complete: widgets system, templates, slug lifecycle, message map, yve parity golden, and full e2e (session)
