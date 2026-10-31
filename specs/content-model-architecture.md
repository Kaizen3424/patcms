# Content model

> Parent: [`specs/MyCMS.md`](MyCMS.md)

Config is TypeScript plus zod on the host, content is JSON in the repo, and the admin only ever sees
JSON-safe descriptors. Three different shapes, one direction of travel.

## The three shapes

| Shape | Lives | Contains | Never contains |
|---|---|---|---|
| `ConfigDefinition` | host code | zod schemas, factories, decorations | — |
| `AdminConfig` | passed to `mountAdmin`, JSON-safe | field **descriptors**, collection metadata | zod instances, functions |
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
place — the new-entry fold (`foldFieldDefaults` and `cloneEntryAsTemplate` in
`packages/admin/src/editor/template-clone.ts`) — plus the hidden-field repair-on-save backfill.
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

## Editor wiring

- Router → screen → `EntryEditor` (`packages/admin/src/editor/entry-editor.tsx`) holds the form value,
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
