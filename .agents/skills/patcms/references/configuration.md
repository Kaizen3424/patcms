# patcms configuration reference

Config is TypeScript plus zod on the host side. The client never sees the schemas — only projected,
JSON-safe field descriptors — so config can import anything the build can.

## Shapes

- `defineConfig(...)` → `ConfigDefinition` (collections carry live zod schemas).
- `toAdminConfig(config)` → `AdminConfig` (collections carry `FieldDescriptor[]`, JSON-safe).
- `createCMS({ config })` accepts either and auto-detects.
- `parseAdminConfig(value)` / `safeParseAdminConfig(value)` — strict validation when descriptors
  cross a trust boundary; throws/returns `ConfigValidationError` with `issues: { path, message }[]`.

## `defineConfig`

```ts
import { defineConfig } from "patcms"

export const config = defineConfig({
  site: { name: "Travel Blog", url: "https://example.com" },
  deploy: { contexts: ["Cloudflare Pages"] }, // commit-status fallback for deploy status; empty/absent = off
  media: { folder: "public/images", publicFolder: "/images" }, // root mapping: repo folder ⇄ public URL path
  collections: [],
})
```

Config errors fail at construction, never at first save.

## `defineCollection` (folder collections — one JSON document per entry)

```ts
import { defineCollection } from "patcms"
import * as fields from "patcms"

export const posts = defineCollection({
  name: "posts",
  label: "Posts",
  folder: "content/posts",
  identifierField: "title", // derives slugs and titles
  summary: "{{title}} — {{excerpt}}", // mustacheLite template for list rows
  previewPath: "/blog/{{slug}}",
  sortableFields: ["title", "date"],
  thumbnail: "hero",
  schema: fields.object({
    label: "Post",
    fields: {
      title: fields.string({ label: "Title" }),
      excerpt: fields.text({ label: "Excerpt", required: false }),
      hero: fields.image({ label: "Hero", required: false }),
      date: fields.datetime({ label: "Date", dateOnly: true }),
    },
  }),
})
```

| Option | Default | Notes |
|---|---|---|
| `name` / `label` / `labelSingular` / `icon` | — | `name` is used in API calls |
| `folder` | — | Repo directory of the JSON documents |
| `format` | `"json"` | JSON only in v1 |
| `create` / `delete` | `true` | `false` makes `entries.create`/`delete` throw `UNSUPPORTED` |
| `identifierField` | — | Slug + title source |
| `summary` / `previewPath` / `thumbnail` / `viewGroups` | — | UI hints your admin reads from `cms.config` |
| `sortableFields` | — | Top-level field names the UI may sort by |
| `media` | root media | Per-collection media override |
| `schema` | — | `fields.object({ label, fields })`; every property must carry field metadata |
| `decorations` | — | `fields.divider({ before, label? })` form sectioning |

## `defineFiles` + `defineFile` (singleton documents)

```ts
import { defineFile, defineFiles } from "patcms"
import * as fields from "patcms"

export const settings = defineFiles({
  name: "settings",
  label: "Site settings",
  files: [
    defineFile("settings", {
      name: "testing",
      label: "Testing page",
      file: "content/settings/testing.json",
      schema: fields.object({
        label: "Testing page",
        fields: { headline: fields.string({ label: "Headline" }) },
      }),
    }),
  ],
})
```

Fixed file set (no create/delete); the file `name` is the slug.

## Dividers

`collectionDivider("Content")` separates sidebar groups; `fields.divider({ before: "date" })` in
`decorations` separates form sections. Both are cosmetic.

## The 12 field types

Every factory takes the base options plus type-specific ones and returns a zod schema with
metadata attached.

Base options: `label` (required), `hint?`, `required?` (default **true**), `defaultValue?`
(metadata only — parsing never injects it), `width?: "full" | "half"`.

| Factory | JSON value | Type-specific options |
|---|---|---|
| `fields.string` | `string` | `format?: "email" \| "url"`, `minLength?`, `maxLength?`, `pattern?: RegExp` |
| `fields.text` | `string` | `minLength?`, `maxLength?` |
| `fields.number` | `number` | `int?`, `min?`, `max?` |
| `fields.boolean` | `boolean` | — |
| `fields.select` | `string` or `string[]` | `options` (required, non-empty, unique; strings or `{ label, value }`), `multiple?` |
| `fields.datetime` | ISO string | `dateOnly?` — `YYYY-MM-DD` vs full ISO datetime with offset |
| `fields.image` | public path | `pattern?`, `extensions?` (default `jpg jpeg png webp avif svg`); value is `/images/…`, not the repo path |
| `fields.relation` | `string` or `string[]` | `collection` (required), `multiple?`, `valueField?` (default `"slug"`, `{{expr}}` template), `displayFields?`, `searchFields?` |
| `fields.hidden` | any | `siteEffect?`; `required` defaults **false**; not rendered in forms |
| `fields.slug` | — (virtual) | `label?`, `hint?`, `width?`; derived from the filename, never stored |
| `fields.list` | `unknown[]` | exactly one of `fields` (object items) or `field: { name, schema }` (scalar items); `min?`, `max?`, `summary?` |
| `fields.object` | nested record | `fields` (required); nests recursively |

Escape hatch: `defineField(schema, meta)` attaches metadata to a custom zod schema.

## Defaults

- `defaultValue` is metadata for host UIs — **parse never injects it**.
- `createBlankEntryValue(fields)` builds the new-entry template (leaf defaults; required lists
  padded to `min` with starter items).
- `foldFieldDefaults(fields, target)` folds defaults into an existing partial value, leaf-first.
- Optional lists with no value stay absent — an empty array is not invented.

## Lenient parse, strict save

| Situation | Parse (on read) | Save validation |
|---|---|---|
| Wrong type / missing required | `ParseIssue` in `entry.issues`, value dropped or flagged | Refuses the save |
| Unmodeled key | Kept in `entry.untouched` + `UNMODELED_KEY` warning | Preserved verbatim at its JSON-Pointer path |
| Stored `slug` key | `VIRTUAL_KEY_IGNORED` warning → `untouched` | Same |
| Missing `hidden` with `defaultValue` | — | Backfilled (repair-on-save) |
| Dangerous keys (`__proto__`, `constructor`, `prototype`) | Stripped | Stripped |

Consequence: removing a field from config does **not** delete data — it becomes unmodeled and
survives every save. Gate saves with `entries.validate` (issues as a value); `save`/`create` throw
`CMSError` `VALIDATION` with `issues` attached.

## Config validation rules (projected config)

Relation targets exist; `identifierField` / `sortableFields` / view-group fields exist; select
`defaultValue` is one of the options; regex patterns compile; scalar lists have exactly one child;
media paths are valid; deploy contexts are non-blank and unique; duplicate collection names are
rejected; files collections need at least one file; objects need at least one field.
