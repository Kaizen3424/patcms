# ADR-0003 — Zod-first config: schema factories carrying metadata; closed validation; versioned schema

**Status:** Accepted · 2026-10-27

## Context
Genesis §2 identified the zod "metadata deficit": `z.string().min(3)` validates but carries no UI info, and `.describe()` metadata is weakly typed. Attempting pure-zod parsing also risks silently deleting dev-owned/hidden fields and can't know widget structure. The incumbent's 6 config-vs-zod drift cases prove drift kills trust.

## Decision
1. **Schema factory pattern (owner's genesis recommendation, adopted as the DSL)**: `fields.string({...})` returns a **zod schema carrying CMS metadata** (widget type + field config + identity); `z.object({...})` composes them; `defineCollection({name, folder, format, schema, view:…})` wraps collection options. Zod remains the single validation engine end-to-end (compile-time for host apps, runtime for admin/validation sweeps).
2. **Closed config schema**: config documents parse via `z.strictObject` + discriminated union of the exact registered widget types; unknown widget/type = validation error naming collection+field (never silent passthrough → never mis-typed edits). Config is **data, never code** — no TS-module configs in v1 (eliminates arbitrary code in the admin bundle).
3. **Round-trip preservation**: field types model a **projection** — parse returns `{value, issues, untouched}` where `untouched` = unmodeled raw keys, copied verbatim (genesis §2 "dev-owned fields" requirement, upgraded to the lenient read/strict save contract). **Parse is default-immune** (round-2): no key injection on open; defaults materialize only via the new-entry/template leaf-first fold.
4. **schemaVersion + unknown-value policy**: config carries a version; value-level evolution (string→select etc.) writes migration notes in commit bodies rather than destroying data; renames of fields are preserved as untouched until owner-migrated.
5. **Drift-free cutover**: host build (yve `content.ts`) imports schemas FROM this package so admin validation ≥ build gate by construction; CI fixture pins the 6 incumbent drift cases (INV-C02).
6. Metadata keys are symmetrical to the genesis sketch: `label, hint, required, default` + widget-specific (`folder, min/max, options(label→value), valueField/displayField/searchFields, itemTemplates/summaries`).
7. Supplementary primitives: `divider` = decoration-only field (no value); `slug` = hidden virtual path-derived field; cross-collection reference display resolution is provided via validator context `services{entryIndex, readEntry, siblingValues}` (async context validation accepted from genesis §2 — owned by admin's ServicesProvider, see ADR-0009 boundary).

## Consequences
- All 12 field types must be expressible in the factory pattern incl. nested list-of-list (the incumbent's "choice tabs") — verified by the parity golden test (INV-C01).
- Strict parse means the importer path (Stage B) maps unknown widgets to `text` + loud warnings, never trusted passthrough.
- Error codes, not prose, from zod → human message map (01-spec §7).
### P0 verification (2026-10-27)
- Vocabulary pinned now: `CONFIG_SCHEMA_VERSION = 1` + the 12-name `FieldTypeName` union (packages/core/src/config, packages/core/src/fields); zod schema factories + the strict/lenient duality land P1.1/P1.2. No deviation.

### P1 addendum (2026-10-27) — config document, field markers, serializer rule
- **Two representations, one source.** `defineConfig()` keeps the zod schemas for the host build gate; `toAdminConfig()` derives a JSON-safe `AdminConfig` document (no functions/schemas) that is the ONLY thing `mountAdmin()` accepts. `parseAdminConfig()` validates it with `z.strictObject` + a discriminated union of the exact field types; unknown types/keys are errors naming collection+field. This keeps "config is data, never code" honest at the admin boundary while host code still imports real schemas.
- **Field metadata carriers.** `fields.*` factories return zod schemas carrying CMS metadata via zod 4 `.meta()`; `defineCollection({schema: z.object({...})})` walks `schema.shape`. 12 value types stay as pinned (`string, text, number, boolean, select, datetime, list, object, image, relation, hidden, slug`); `divider` is a decoration declaration and `slug` is a virtual marker — both are removed from the entry schema, never stored keys.
- **Untouched bytes are not re-printed.** The yve corpus is Prettier-shaped (inline objects-in-arrays, printWidth 100); a plain `JSON.stringify(..., null, 2)` reflows 77 of 106 lines in `iris-no-7.json`. INV-S01 is therefore satisfied by a **source-preserving document**: unchanged documents return their original bytes; edited/new documents use the canonical printer (2-space, author key order, LF, trailing newline). The P6 normalization pass makes canonical formatting permanent. This supersedes any reading of "serializer" as "always re-print".
- **Drift resolution choices for the six incumbent cases** (implemented by the config port, pinned by fixtures): `category` = closed select; `people` = list `min: 1`; money/quantity integers = `int`; `contact.email` = email format; relations stay plain slug strings with cross-entry validation in the services layer; hidden defaults are metadata only and never parse-injected. Both admin and site consume the same config package at cutover.
- **Dependency approval (owner, 2026-10-27):** `zod@4.6.7` + `idb-keyval@6.3.0` are the P1 runtime additions; `fast-check` waits for P2. GitHub transport is a hand-rolled client over the injected `FetchLike` seam (no Octokit) so MSW/e2e observe the same transport.

### P2.8 addendum (2026-10-28) — optional `deploy.contexts` (additive within schemaVersion 1)

`ConfigOptions` and `ConfigDefinition` gain
`deploy?: { readonly contexts?: readonly string[] }`; `AdminConfig` carries the
same optional shape. Absent = commit-status fallback off (ADR-0008 §2); existing
configs parse unchanged, so this is additive within `CONFIG_SCHEMA_VERSION = 1`
— no version bump.

- The strict admin schema adds a `strictObject` for `deploy` with
  `contexts: z.array(z.string().min(1)).optional()`; unknown keys remain errors
  (closed config law). Semantic validation rejects duplicate contexts.
- `defineConfig` validates and copies `deploy` only when present;
  `toAdminConfig` passes it through unchanged. No field metadata, widget or
  collection descriptor is involved — status contexts are site-level config.
- It lives in config, not `AdminMountOptions`: which third-party CI contexts
  count as the site's truth travels with the repository and is visible to the
  host. It is not a credential or a per-session preference.
- An empty `contexts` array is equivalent to absent (fallback disabled); it is
  accepted so generated configs do not need to special-case emptiness.
