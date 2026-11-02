# Configuration

Config is TypeScript plus zod, written on the host side. The client never sees your schemas — only
the projected, JSON-safe descriptors — so config can import anything your build can, and the
browser bundle stays small.

## The three shapes

| Shape | Produced by | Contains | Consumed by |
|---|---|---|---|
| `ConfigDefinition` | `defineConfig()` | collections with **live zod schemas** | `createCMS({ config })`, `toAdminConfig()` |
| `AdminConfig` | `toAdminConfig(config)` | collections with **field descriptors** (JSON-safe) | `createCMS({ config })`, your UI |

`createCMS()` accepts either and auto-detects which one it got. Pass the definition during normal
operation; pass a projected `AdminConfig` when descriptors travel (e.g. generated at build time).

```ts
import { toAdminConfig } from "patcms"
import type { ConfigDefinition } from "patcms"

declare const config: ConfigDefinition

// JSON-safe projection — drops the zod schemas, keeps the descriptors.
const adminConfig = toAdminConfig(config)
```

## `defineConfig`

```ts
import { defineConfig } from "patcms"

export const config = defineConfig({
  site: { name: "Travel Blog", url: "https://example.com" },
  deploy: { contexts: ["Cloudflare Pages"] },
  media: { folder: "public/images", publicFolder: "/images" },
  collections: [
    /* collections, files collections, and dividers */
  ],
})
```

| Option | Type | Notes |
|---|---|---|
| `site` | `{ name?, url? }` | Cosmetic; surfaced to your UI via `cms.config.site` |
| `deploy` | `{ contexts? }` | Commit-status fallback for deploy status. Absent/empty = statuses are ignored, check-runs only (see [deploy-status.md](./deploy-status.md)) |
| `media` | `{ folder, publicFolder }` | The **root** media mapping: repo folder ⇄ public URL path |
| `collections` | array | `defineCollection()`, `defineFiles()`, and `collectionDivider()` results |

`defineConfig` validates media paths and rejects duplicate collection names immediately — config
errors fail at construction, not at first save.

## `defineCollection` — folder collections

One JSON document per entry, stored under `folder`:

```ts
import { defineCollection } from "patcms"
import * as fields from "patcms"

export const posts = defineCollection({
  name: "posts",
  label: "Posts",
  labelSingular: "Post",
  folder: "content/posts",
  identifierField: "title",
  summary: "{{title}} — {{excerpt}}",
  previewPath: "/blog/{{slug}}",
  sortableFields: ["title", "date"],
  thumbnail: "hero",
  schema: fields.object({
    label: "Post",
    fields: {
      title: fields.string({ label: "Title" }),
      date: fields.datetime({ label: "Date", dateOnly: true }),
      hero: fields.image({ label: "Hero image", required: false }),
      excerpt: fields.text({ label: "Excerpt", required: false }),
    },
  }),
})
```

| Option | Default | Notes |
|---|---|---|
| `name` | — | Used in API calls (`entries.list("posts")`) |
| `label`, `labelSingular`, `icon` | — | For your UI |
| `folder` | — | Repo directory holding the JSON documents |
| `format` | `"json"` | JSON only in v1 |
| `create` | `true` | `false` disables `entries.create` (`UNSUPPORTED`) |
| `delete` | `true` | `false` disables `entries.delete` (`UNSUPPORTED`) |
| `identifierField` | — | Field used to derive slugs and titles |
| `summary` | — | `{{field}}` template for list rows (`mustacheLite` syntax) |
| `previewPath` | — | `{{slug}}` template for the "view on site" link |
| `sortableFields` | — | Top-level field names your UI may sort by |
| `thumbnail` | — | Image field name shown as the row thumbnail |
| `viewGroups` | — | `{ name, label, field, pattern }` groups for your UI |
| `media` | root media | Per-collection media override (see [media.md](./media.md)) |
| `schema` | — | `fields.object({ label, fields })` — every property must carry field metadata |
| `decorations` | — | `fields.divider({ before, label? })` entries for form sectioning |

## `defineFiles` — singleton documents

For settings-style documents that are one file, not a folder of entries:

```ts
import { defineConfig, defineFile, defineFiles } from "patcms"
import * as fields from "patcms"

const siteSettings = defineFiles({
  name: "settings",
  label: "Site settings",
  files: [
    defineFile("settings", {
      name: "testing",
      label: "Testing page",
      file: "content/settings/testing.json",
      schema: fields.object({
        label: "Testing page",
        fields: {
          headline: fields.string({ label: "Headline" }),
        },
      }),
    }),
  ],
})

export const config = defineConfig({
  media: { folder: "public/images", publicFolder: "/images" },
  collections: [siteSettings],
})
```

Files collections have no `create`/`delete` — the file set is fixed by config. `entries.list` on a
files collection returns its files; `entries.get` uses the file `name` as the slug.

## Dividers

Two kinds, both cosmetic:

- `collectionDivider("Content")` in `defineConfig.collections` — separates groups in your sidebar.
- `fields.divider({ before: "date", label: "Metadata" })` in a collection's `decorations` —
  separates sections inside the entry form. A divider targets an existing field name.

## The 12 field types

Every factory takes `BaseFieldOptions` plus type-specific options, and returns a zod schema with
metadata attached. `required` defaults to **true**; `defaultValue` is metadata for your UI (see
"Defaults" below).

| Factory | Value in JSON | Type-specific options |
|---|---|---|
| `fields.string` | `string` | `format?: "email" \| "url"`, `minLength?`, `maxLength?`, `pattern?: RegExp` |
| `fields.text` | `string` (multiline) | `minLength?`, `maxLength?` |
| `fields.number` | `number` | `int?`, `min?`, `max?` |
| `fields.boolean` | `boolean` | — |
| `fields.select` | `string` or `string[]` | `options` (required, non-empty, unique), `multiple?` |
| `fields.datetime` | ISO string | `dateOnly?` — `YYYY-MM-DD` vs full ISO datetime with offset |
| `fields.image` | public path string | `pattern?`, `extensions?` (default `jpg jpeg png webp avif svg`) |
| `fields.relation` | `string` or `string[]` | `collection` (required), `multiple?`, `valueField?` (default `"slug"`), `displayFields?`, `searchFields?` |
| `fields.hidden` | any | `siteEffect?` — not shown in forms; `required` defaults to **false** |
| `fields.slug` | — (virtual) | `label?`, `hint?`, `width?` — derived from the filename, never stored |
| `fields.list` | `unknown[]` | exactly one of `fields` (object items) or `field: { name, schema }` (scalar items), `min?`, `max?`, `summary?` |
| `fields.object` | nested record | `fields` (required) — nests recursively |

```ts
import * as fields from "patcms"

export const demoFields = {
  // strings
  title: fields.string({ label: "Title", minLength: 1, maxLength: 80 }),
  email: fields.string({ label: "Email", format: "email", required: false }),
  // select — options are `{ label, value }` or plain strings
  status: fields.select({ label: "Status", options: ["draft", "live"] }),
  tags: fields.select({ label: "Tags", options: ["a", "b", "c"], multiple: true }),
  // datetime
  published: fields.datetime({ label: "Published", dateOnly: true }),
  // image — value is the PUBLIC path ("/images/..."), not the repo path
  hero: fields.image({ label: "Hero", required: false }),
  // relation — value is the referenced entry's valueField (default "slug")
  destination: fields.relation({ label: "Destination", collection: "destinations" }),
  // list of objects
  days: fields.list({
    label: "Itinerary",
    summary: "{{title}}",
    fields: {
      title: fields.string({ label: "Day title" }),
      note: fields.text({ label: "Note", required: false }),
    },
  }),
  // list of scalars
  keywords: fields.list({
    label: "Keywords",
    field: { name: "keyword", schema: fields.string({ label: "Keyword" }) },
  }),
  // nested object
  meta: fields.object({
    label: "Meta",
    fields: { description: fields.text({ label: "Meta description", required: false }) },
  }),
  // hidden — written by tooling, not by editors
  revision: fields.hidden({ label: "Revision", required: false }),
}
```

`fields.slug` is special: the slug lives in the **filename**, so a `slug` field is read-only in
forms and a stored `slug` key in the JSON is treated as unmodeled (see below).

## Defaults

`defaultValue` is **metadata only** — parsing never injects it. Defaults materialise when a host
creates a blank entry value:

```ts
import { createBlankEntryValue, foldFieldDefaults } from "patcms"
import type { FieldDescriptor } from "patcms"

declare const fields: readonly FieldDescriptor[]

// New-entry template: every leaf gets its defaultValue; required lists are
// padded to their `min` with starter items.
const blank = createBlankEntryValue(fields)

// Fold defaults into an existing (possibly partial) value, leaf-first.
const value: Record<string, unknown> = {}
foldFieldDefaults(fields, value)
```

Optional lists with no value stay absent — an empty array is not invented for you.

## Lenient parse, strict save

The same field descriptors drive two different validators:

| | Parse (on read) | Save validation |
|---|---|---|
| Throws | Never | On the first invalid save |
| Wrong type | `ParseIssue` (severity error), value dropped | Refuses the save |
| Missing required | `MISSING_REQUIRED` issue | Refuses the save |
| Unmodeled key | Kept in `entry.untouched` + `UNMODELED_KEY` warning | Preserved verbatim |
| Stored `slug` key | `VIRTUAL_KEY_IGNORED` warning, moved to `untouched` | Same |
| Missing `hidden` with `defaultValue` | — | Backfilled (repair-on-save) |

Read with `entries.list`/`entries.get` and render from `entry.issues`; gate saves with
`entries.validate` (returns issues as a value) — `entries.save`/`create` throw a `CMSError` with
`issues` attached when validation fails (see [errors.md](./errors.md)).

## Untouched preservation

Keys present in the JSON but not declared in the schema (or removed from it later) are collected
into `entry.untouched`, keyed by JSON Pointer, and re-attached at exactly their old paths on the
next save. Consequences:

- Removing a field from the config does **not** delete data — it becomes unmodeled.
- Your form only needs to render the modeled fields; the rest survives round-trips.
- Dangerous keys (`__proto__`, `constructor`, `prototype`) are stripped, never preserved.

## Config validation

`defineConfig`/`defineCollection` validate as you build. The projected `AdminConfig` is validated
again by `parseAdminConfig` (strict, unknown keys are errors) — useful when descriptors cross a
trust boundary:

```ts
import { parseAdminConfig, safeParseAdminConfig } from "patcms"

declare const incoming: unknown

// Throws ConfigValidationError with `.issues: { path, message }[]`:
const config = parseAdminConfig(incoming)

// Or handle it as a value:
const parsed = safeParseAdminConfig(incoming)
if (parsed.ok) {
  console.log(parsed.config.collections.length)
} else {
  console.log(parsed.issues)
}
```

Semantic checks include: relation targets exist, `identifierField`/`sortableFields`/view-group
fields exist, select `defaultValue` is one of the options, regex patterns compile, scalar lists
have exactly one child, media paths are valid, deploy contexts are non-blank and unique.

## Where to next

- [media.md](./media.md) — the `media` option, per-collection overrides, and the path bijection
- [reading-content.md](./reading-content.md) — what `entries.list` returns and how issues surface
- `specs/content-model-architecture.md` — why parse is lenient and save is strict
