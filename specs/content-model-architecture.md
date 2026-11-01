# Content model

> Parent: [`specs/CMS.md`](CMS.md)

Config is TypeScript plus zod on the host, content is JSON in the repo, and the client only ever
exposes JSON-safe descriptors. Three different shapes, one direction of travel.

## The three shapes

| Shape | Lives | Contains | Never contains |
|---|---|---|---|
| `ConfigDefinition` | host code | zod schemas, factories, decorations | — |
| `AdminConfig` | passed to `createCMS()` / `mountAdmin`, JSON-safe | field **descriptors**, collection metadata | zod instances, functions |
| Entry document | the repo | plain JSON | defaults that were never written, the virtual slug |

`toAdminConfig()` (`packages/core/src/config/document.ts`) performs the projection.
`parseAdminConfig` (`packages/core/src/config/schema.ts`) validates it with a **strict, closed**
schema — an unknown key is an error, not a silent pass. A config that fails this schema is a host bug
and should fail loudly at mount.

## Field factories

Twelve value types plus one decoration. Each factory returns a zod schema carrying metadata via
`.meta({mycms})`; `required: false` wraps it with `.optional()`.

- `fields.string`, `text`, `number`, `boolean`, `select`, `datetime`, `list`, `object`, `image`,
  `relation`, `hidden`, `slug` (`packages/core/src/fields/factories.ts`).
- `slug` declares the **virtual** key derived from the filename.
- `divider` is a `decoration`, not a value: it groups fields in the editor and has no JSON
  representation.

**Default values are metadata only.** `parseEntry` never injects them. They materialise in exactly one
place — the new-entry fold (`foldFieldDefaults` / `createBlankEntryValue` in
`packages/core/src/fields/defaults.ts`, exported from `patcms/advanced`; the reference admin's
`cloneEntryAsTemplate` builds on it) — plus the hidden-field repair-on-save backfill.
Anywhere else, injecting a default is a data change the user did not make.

## Parse is lenient, save is strict

Two functions, deliberately different:

| Function | File | Contract |
|---|---|---|
| `parseEntry` | `packages/core/src/fields/parse.ts` | Never throws. Returns `{value, issues, untouched}`. Missing optional keys stay missing; bad values become issues. |
| `validateEntryForSave` | `packages/core/src/fields/validate.ts` | Refuses any error-level issue. Relation checks run here because they need the index. Warnings never block. |

Issue codes are exhaustive: `TYPE_MISMATCH`, `MISSING_REQUIRED`, `INVALID_OPTION`, `OUT_OF_RANGE`,
`PATTERN_MISMATCH`, `INVALID_DATE`, `INVALID_PATH`, `LIST_TOO_SHORT`, `LIST_TOO_LONG`,
`VIRTUAL_KEY_IGNORED`, `UNMODELED_KEY`, `UNKNOWN_FIELD_TYPE`, `RELATION_UNKNOWN`,
`RELATION_CHECK_FAILED`.

This split is why a half-broken repo still browses: reading tolerates, writing refuses.

**Severity is a product decision.** A drift case — unknown select option, missing relation target —
surfaces as an advisory chip and must never block saving a *different* entry. That is the advisory-chip
rule; blocking unrelated saves is a standing veto.

## Untouched preservation

Any key the field set does not model is kept verbatim as a JSON Pointer → value map in `untouched`.

The save path composes bytes from **both** halves of the document (`composeEntryDocument` in
`packages/core/src/serialization/entry-document.ts`):

1. Merge `untouched` pointers back into the modeled value.
2. Drop every declared `slug` field — it is virtual and must never be written.
3. Serialise; if nothing was edited, return the original bytes.

Skipping step 1 makes every unmodeled key look deleted to the rebase, which is silent data loss.
Skipping step 2 writes a key the parser will ignore on the next read (`VIRTUAL_KEY_IGNORED`).

`serialize(parse(raw)) === raw` is the invariant that makes "no phantom diffs" true. The corpus is
Prettier-shaped, so re-printing an untouched file would produce a diff the user did not make.

## Serialisation

`packages/core/src/serialization/document.ts`:

- `parseJsonDocument` captures `{raw, value, newline, strippedKeys}`.
- Untouched input → return `raw` unchanged.
- Edited or new input → canonical printer: 2-space indent, author key order, LF, trailing newline.
- `strippedKeys` records keys removed at parse time (dangerous shapes) so they cannot be silently
  reintroduced.

Only one serialiser exists. A second one bypassing the editor save path is a standing veto.

## Collections and media

| Collection kind | Entry identity | Media |
|---|---|---|
| `folder` | slug from the filename | `config.media`, or `collection.media` override |
| `files` | `files[].name` | same |
| `divider` | none | none |

`resolveMediaFolders(config, collectionName?)` (`packages/core/src/media/bijection.ts`) is the only
place an override is applied. Do not re-implement the fallback.

## Editor wiring (reference admin)

The frozen admin's editor shows how a host wires the pieces; the primitives it uses all come from
`patcms/advanced`:

- `EntryEditor` (`packages/admin/src/editor/entry-editor.tsx`) holds the form value,
  `untouched`, `dirtyPaths`, and `baseSha`.
- Dirtiness is computed in the **value domain** (`computeDirtyPaths`, `fieldEquals`), never by
  comparing serialised strings.
- The save bar is a pure model (`save-bar-model.ts`) rendered by `save-bar.tsx`. It owns no save logic
  and never talks to the transport.
- Widgets bind by field type through `createWidgetRegistry` (`packages/admin/src/widgets/contract.ts`);
  the default set is `WIDGETS` in `packages/admin/src/widgets/index.ts`. Adding a widget type means
  registering it there and adding the descriptor variant — no screen changes.

**Config drift rule:** config changes are additive and lenient on read. Removing a field does not
delete its data; it becomes unmodeled and joins `untouched`. Renaming a field without a migration is a
data-visible change — call it out in the change.

## Decisions and claims

### Decisions

| ID | The rule that still binds |
|---|---|
| ADR-0003 | Config is zod schema factories carrying CMS metadata: one validation engine, compile-time for the host and runtime for the admin. `AdminConfig` is data, never code — a `strictObject` plus a discriminated union of the exact field types, so an unknown key or type is a named error, never a silent pass. Parse is default-immune; defaults materialise only in the new-entry fold. |
| ADR-0006 | Repository content is untrusted. Templates render as text nodes (`{{key}}` → `String(value)`), never through an HTML sink. `safePath()` guards every media path on read and write, `safeUrl()` allowlists schemes, SVG uploads are rejected, and existing SVGs render only via `<img src=blob:>`. `parseUntrustedJson()` is the only entry/config parser; `Object.assign` and deep merges on parsed JSON are banned repo-wide. Caps: entry ≤ 2 MB, depth ≤ 64, list ≤ 5 000. |
| ADR-0009 | Two registries joined by name: core `defineFieldType` (pure — no React, no IO) and admin `defineWidget(fieldTypeName, Component)`. `WidgetProps` carries `value`, `onChange`, `error`, `fieldConfig`, `useField()` and `services` — never a backend or a token. Relation display and search resolve through the admin entry index; core models relation as pure data. A registry snapshot test makes contract drift fail loudly. |

### Claims

| ID | Claim | Enforcing test |
|---|---|---|
| INV-S01 | Untouched files round-trip byte-identically: `serialize(parse(raw)) === raw` across the yve corpus | `packages/core/src/cache/__tests__/golden-byte-identity.test.ts` |
| INV-S02 | A no-op save produces a zero-diff commit (equal tree sha); CRLF and ETag variants never fake a change | `packages/core/src/cache/__tests__/inv-noop-diff.test.ts` |
| INV-S03 | Reads are lenient and saves strict: all six drift fixtures render with a banner, save refuses an unclean entry, and untouched unmodeled keys survive verbatim | `packages/core/src/fields/__tests__/inv-lenient-strict.test.ts` |
| INV-S04 | Parsing never injects a default; defaults arrive only through the new-entry/template fold | `packages/core/src/fields/__tests__/inv-default-immune.test.ts` |
| INV-S05 | Prototype pollution is impossible: `__proto__` and nested `constructor.prototype` parse harmlessly, and a grep gate keeps unsafe merges out | `packages/core/src/safety/__tests__/inv-prototype-pollution.test.ts`, `packages/core/src/safety/__tests__/repo-bans.test.ts` |
| INV-S06 | Size and depth caps hold: entry ≤ 2 MB, depth ≤ 64, list ≤ 5 000 items, with a render recursion guard | `packages/core/src/safety/__tests__/inv-parse-caps.test.ts` |
| INV-T01 | Templates render as text nodes only; the golden XSS suite covers summaries, `preview_path`, alt text, and view-group patterns | `packages/core/src/safety/__tests__/inv-golden-xss.test.ts` |
| INV-T02 | `safePath()` runs on read and write and rejects `..`, backslashes, encoded separators, and prefix escapes | `packages/core/src/safety/__tests__/inv-safe-path.test.ts` |
| INV-T03 | `safeUrl()` allowlists schemes; `javascript:` and `data:` are rejected; external links carry `rel="noopener noreferrer"` | `packages/core/src/safety/__tests__/inv-safe-url.test.ts` |
