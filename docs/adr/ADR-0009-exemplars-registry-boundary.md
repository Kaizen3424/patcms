# ADR-0009 — Reference exemplars + registry/validator boundary (how strangers extend MyCMS)

**Status:** Accepted · 2026-10-27

## Context
Round-1 major: the Day-1 custom-widget author — the Sveltia gap this project exists to fix — would hit an underspecified contract; round-2 added that relation display needs cross-entry reads yet widgets must never touch the transport. OSS readiness requires copyable exemplars with objective acceptance.

## Decision
1. **Two registries, clean seam** (master-plan §4.2): core `defineFieldType({parse, serialize, validate, default, meta})` (pure, no React/IO) ↔ admin `defineWidget(fieldTypeName, Component)` joined **by name**. Custom contract = `WidgetProps{ value, onChange, error, fieldConfig, useField(), services{ entryIndex(coll), readEntry(ref), siblingValues() } }` — **`backend`/token access in WidgetProps is a standing veto** (kills DI, testing, blast radius in one stroke).
2. **Async/related-data**: relation display/search resolution owned by admin `ServicesProvider` built at the composition root; sync from the Query cache keyed by `refSha` w/ async fallback; core defines relation as pure data `{target, valueField, display, search}`. THIS is the async-context-validation slot genesis §2 anticipated.
3. **Exemplar 1 — custom widget**: `packages/admin/src/widgets/reference-swatch/` — enum-color-dot widget mirroring incumbent `swatch: accent|muted|secondary`. Acceptance: registers in the widget registry · renders in playground fixtures · passes the XSS golden suite · registry snapshot test updated · docblock walks the contract (config → validate → serialize → render).
4. **Exemplar 2 — backend**: `packages/core/src/backends/reference-fixture-backend/` — zero-network `GitBackend` over fixture trees. Acceptance: passes the SAME shared contract suite as GithubBackend (ADR-0001) — the suite is the acceptance and the first-contributor magnet.
5. **Widget integration UX is config-only**: host apps register their own widgets via the admin bundle (peer versions aligned to a pinned internal matrix — declaration-merging keeps types honest); registry snapshot test prevents silent contract drift.

## Consequences
Exemplar acceptance criteria are P3 (widget) and P1 (backend) gate items — not polish; the contract suite version bumps = breaking-change discipline via changesets.
### P0 verification (2026-10-27)
- Both registries exist as seams joined by name: `FieldTypeName` (core, 12 names) + the admin `WidgetBinding { fieldTypeName }` placeholder; the `reference-fixture-backend` exemplar stub ships and passes the shared suite (exemplar-acceptance posture). Registry mechanics land P1.2/P3. No deviation.

### P2.6 verification (2026-10-27)

- `defineWidget` + `createWidgetRegistry` land as the join-by-name seam: the binding carries
  `fieldTypeName` and the component receives `WidgetProps { value, onChange, error, fieldConfig }`.
  No `backend`, no token, no transport in `WidgetProps` — the standing veto is honoured.
- **Recorded deviation (scope, not contract):** the async half of the pinned contract — `useField()` and
  `services { entryIndex, readEntry, siblingValues }` — is NOT part of the six v0 widgets (string, text,
  number, boolean, select, datetime). It arrives with the list/object/relation widgets (P3.1/P3.3), which
  are the only consumers that need cross-entry reads. The full contract above remains the target and the
  reference-swatch exemplar (P3.6) still owns its acceptance.
- Registry snapshot test stays a P3.6 exemplar acceptance item, as scheduled.

### P3 addendum (2026-10-30) — custom widget exemplar, registry context, and widget services

1. **Custom Widget Registration Seam**:
   - `WidgetBinding.fieldTypeName` is widened to `WidgetTypeName = FieldDescriptor["type"] | (string & {})`, allowing third parties and custom exemplars (e.g. `swatch`) to register custom widget components while preserving closed core field types.
   - `WidgetRegistryContext` and `useWidgetRegistry()` provide dynamic widget resolution across recursive containers (`ObjectWidget`, `ListWidget`), ensuring custom widgets are accessible at any depth.
2. **Widget Services**:
   - `WidgetServices` is attached to `WidgetProps`: `{ getEntries, getEntryBySlug, searchEntries }`, powered by admin's `EntryIndex`.
   - The standing veto stands: no `backend`, no credentials, no raw GitHub transport inside `WidgetProps`.
3. **Reference Swatch Exemplar Acceptance**:
   - `packages/admin/src/widgets/reference-swatch/` proves the custom widget authoring pathway: color dots for enum values (`accent`, `muted`, `secondary`), docblock detailing the contract (config → validate → serialize → render).
   - Enforced by: widget registry snapshot test, extended `INV-T01` golden XSS test, and live playground fixture rendering.

