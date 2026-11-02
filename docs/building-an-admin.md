# Building an admin

patcms ships no UI — deliberately. This doc turns the example panel
(`playground/src/panel/`) into a blueprint: what a working admin needs, the shapes it uses, and
what to copy versus rebuild. The panel is the reference implementation; every pattern below is
live code.

## The adoption template

The panel's `mount.tsx` is the whole adoption story in one call — build the client, pick the
persistence stores, render, and tear down in reverse order:

```ts
import { createCMS } from "patcms"
import { createIdbDraftStore, createIdbTokenStore } from "patcms/web"

declare const element: HTMLElement
declare const config: Parameters<typeof createCMS>[0]["config"]
declare const repository: Parameters<typeof createCMS>[0]["repository"]

const browser = typeof indexedDB !== "undefined"
const cms = createCMS({
  config,
  repository,
  ...(browser ? { tokenStore: createIdbTokenStore() } : {}),
  ...(browser ? { drafts: createIdbDraftStore() } : {}),
})

// Your render layer here; on teardown call cms.destroy() — it drops the cache
// and listeners but does NOT sign out, so a remembered token survives remounts.
cms.destroy()
```

## What a minimal admin needs

| Screen | SDK calls | Panel file |
|---|---|---|
| Sign-in | `auth.signIn(token, { remember })`, `auth.restore()`, `auth.onChange`, `auth.signOut()` | `screens/LoginScreen.tsx` |
| Library | `entries.list`, `drafts.list` (badges), `entry.issues` (warning badges) | `screens/LibraryScreen.tsx` |
| Editor | `entries.get`, `drafts.get` (offer), `entries.validate`, `entries.save`, `drafts.save` (debounced) | `screens/EntryScreen.tsx` |
| New entry | `createBlankEntryValue`, `entries.slugFromValue`, `entries.path`, `entries.create` | `screens/NewEntryScreen.tsx` |
| Media | `media.list/list({ includeTrash })/upload/delete/restore/references` | `screens/MediaScreen.tsx` |

No router is needed: navigation is a discriminated union in your state
(`{ kind: "library" } | { kind: "entry", collection, slug } | ...`) — see `panel/types.ts`.

## The editor loop

The core loop, exactly as the panel runs it:

1. Load `entry = await entries.get(...)`; offer `drafts.get(entry)` when present (warn when
   `draft.baseSha !== entry.sha`).
2. On edits: update local state, debounce `drafts.save(entry, value)` (600 ms in the panel).
3. On save click: `entries.validate` → render issues, or `entries.save` → handle
   `saved` (show commit sha, clear draft) / `noop` / `conflict` (per-field pick UI from
   [conflicts-and-drafts.md](./conflicts-and-drafts.md)).
4. Re-render from `result.entry` after a save — it is the fresh post-save state.

Form state is plain local state; there is no form library in the panel. Two rules keep it correct:

- **Dirtiness lives in the value domain.** Compare values field by field
  (`compareValues` from `patcms`), never serialized strings.
- **Empty string means empty.** Text inputs map `""` to `undefined` for optional fields, so
  optional keys do not accumulate as empty strings.

## Widgets bind to descriptors, not to config

The panel renders fields by walking `entry.fields` (the `FieldDescriptor[]` on every `Entry`) and
dispatching on `field.type`. The contract is three properties:

```ts
import type { FieldDescriptor } from "patcms"

interface WidgetProps {
  field: Exclude<FieldDescriptor, { type: "divider" }>
  value: unknown
  onChange(value: unknown): void
  id?: string // DOM id prefix, threaded through nesting to keep label ids unique
}
```

| Descriptor type | Panel widget | Notes |
|---|---|---|
| `string`, `text`, `number`, `boolean`, `select`, `datetime` | `widgets/primitives.tsx` | Plain controlled inputs |
| `list` (object items) | `widgets/ListWidget.tsx` | Repeater; `foldFieldDefaults` supplies starter items; per-item summary via `mustacheLite(field.summary)` |
| `list` (scalar items) | `widgets/ScalarInput.tsx` | Direct input per item |
| `object` | `widgets/ObjectWidget.tsx` | Recursion is the whole pattern |
| `image` | `widgets/ImageWidget.tsx` | Picker from `media.list({ collection })` + in-place upload |
| `relation` | `widgets/RelationWidget.tsx` | Options from `entries.list(field.collection)`; stored value = `valueField` template (default `{{slug}}`); dangling refs render a "missing" chip |
| `hidden` | — | Render nothing; the value rides along untouched |
| `slug` | read-only | Derived from the filename |
| `divider` | section header | From `decorations` |

Adding a widget type means registering it in the dispatcher and adding the descriptor variant — no
screen changes. Widgets get everything else they need (the client, the collection, the media
cache) from a scope context (`panel/widgets/scope.ts`), not from props drilling.

## Media plumbing

One `MediaPreviewCache` per mounted view (see the pattern in
[media.md](./media.md)): object URLs minted from `media.get` bytes, invalidated after
upload/delete, revoked on unmount. The image widget previews through the same cache; the media
screen adds the trash tab (`media.list({ includeTrash: true })`) and the delete ladder
(references → confirm → `checkReferences: false`).

## Copy the panel, or rebuild?

`playground/src/panel/` states its own intent: **hosts copy this directory; nothing here is
published.** Both are legitimate:

- **Copy it** (as `cms_test` did): fastest path to a working admin; you own the code from then on.
- **Rebuild**: use the panel as the reference for each screen; the SDK contract
  (conflict-as-value, untouched preservation, draft law) is what your UI must honour — the specs in
  `specs/workflows/publish-and-recovery.md` define those contracts precisely.

Either way, keep the import discipline: `patcms`, `patcms/web`, your framework — and nothing from
the package's internals. There are no internals to import; everything public is in the three
entries.

## Where to next

- [deploy-status.md](./deploy-status.md) — the one feature the panel deliberately omits
- [testing.md](./testing.md) — verifying your admin against the fake GitHub before touching a real repo
