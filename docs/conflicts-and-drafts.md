# Conflicts and drafts

## The conflict contract

Saves are **fast-forward-only**: the client updates the branch ref with a compare-and-swap and
never force-pushes, never merges on its own. When someone else pushed first and the foreign commit
touched your file, `entries.save` returns a conflict **as a value**:

```ts
import type { CMS, Entry, EntryValue } from "patcms"

declare const cms: CMS // constructed as in getting-started.md
declare const entry: Entry
declare const formValue: EntryValue

const result = await cms.entries.save(entry, formValue)
if (result.status === "conflict") {
  result.current // Entry — what the branch holds now (fresh, re-read for you)
  result.local   // EntryValue — what you tried to save
}
```

There is no default merge and no exception to catch — the host decides what to show. (If the
foreign commit touched only *other* files, the client retries once automatically; you never see
that case.)

## The minimal resolution recipe

Render both versions per field, let the user pick, compose the picked value on top of `current`,
and save again. This is exactly what the example panel does
(`playground/src/panel/lib/conflict.ts`):

```ts
import { canonicalJson } from "patcms"
import type { Entry, EntryValue, FieldDescriptor, JsonValue } from "patcms"

function sameValue(a: unknown, b: unknown): boolean {
  return canonicalJson((a ?? null) as JsonValue) === canonicalJson((b ?? null) as JsonValue)
}

/** One row per modeled field: the remote value and yours, for a render-both table. */
function conflictRows(current: Entry, local: EntryValue, fields: readonly FieldDescriptor[]) {
  return fields
    .filter((field) => field.type !== "divider" && field.type !== "hidden" && field.type !== "slug")
    .map((field) => ({
      name: field.name,
      label: field.label,
      theirs: current.value[field.name],
      mine: local[field.name],
      equal: sameValue(current.value[field.name], local[field.name]),
    }))
}

/** Composes the user's per-field picks on top of the remote entry. */
function mergePicks(
  current: Entry,
  local: EntryValue,
  fields: readonly FieldDescriptor[],
  picks: Readonly<Record<string, "mine" | "current">>,
): EntryValue {
  const merged: Record<string, unknown> = { ...current.value }
  for (const field of fields) {
    if (field.type !== "divider" && picks[field.name] === "mine" && field.name in local) {
      merged[field.name] = local[field.name]
    }
  }
  return merged
}
```

And the flow around it:

```ts continue
import type { CMS } from "patcms"

declare const cms: CMS // constructed as in getting-started.md
declare const entry: Entry
declare const formValue: EntryValue

const result = await cms.entries.save(entry, formValue)

if (result.status === "conflict") {
  const rows = conflictRows(result.current, result.local, entry.fields)
  // ...render rows, collect a pick per field...
  const picks: Record<string, "mine" | "current"> = {}
  for (const row of rows) picks[row.name] = row.equal ? "current" : "mine"

  const merged = mergePicks(result.current, result.local, entry.fields, picks)
  // Save the reconciled value. The next save diffs against the reconciled tree,
  // so it cannot revert the partner's disjoint edits.
  await cms.entries.save(result.current, merged)
}
```

Details that matter:

- Keep `current`'s fields you did not render — spreading `{ ...current.value }` and overriding only
  picked fields means unrendered partner edits survive.
- `canonicalJson` gives stable equality for the "no decision needed" rows.
- For field-level **automatic** merging (three-way merge with dirty paths), use `rebase()` from
  `patcms/advanced` — see [advanced.md](./advanced.md). The default path never calls it.

## Drafts

A draft is the host's unsaved work, persisted through a `DraftStore` **before** the first network
call of a save. The client namespaces keys by repository, so one store can serve several clients.

| `Draft` field | Meaning |
|---|---|
| `collection`, `slug`, `path` | Which entry |
| `savedAt` | ISO timestamp (newest first in `list`) |
| `baseSha` | The entry sha the draft was started from |
| `baseRaw` | The source bytes the draft was started from |
| `value` | The form value |

```ts
import type { CMS, Entry, EntryValue } from "patcms"

declare const cms: CMS // constructed as in getting-started.md
declare const entry: Entry
declare const formValue: EntryValue

// Persist (autosave):
await cms.drafts.save(entry, formValue)

// Offer on load:
const draft = await cms.drafts.get(entry)
if (draft && draft.baseSha !== entry.sha) {
  // The branch moved since the draft was saved — the draft is stale.
  // Warn before offering it; saving it will surface as a conflict if it clashes.
}

// List across the repo (newest first), optionally per collection:
const all = await cms.drafts.list()
const postDrafts = await cms.drafts.list("posts")

// Discard:
await cms.drafts.delete(entry)
```

After a successful save the client deletes the draft for you — only explicit "discard" needs
`drafts.delete`.

### The DraftStore seam

```ts
import { createCMS } from "patcms"
import type { ConfigDefinition, DraftStore } from "patcms"

declare const config: ConfigDefinition
declare const myStore: DraftStore // get / put / delete / list / deletePrefix

const cms = createCMS({
  config,
  repository: { owner: "your-org", repo: "your-site", branch: "main" },
  drafts: myStore,
})
```

The default is memory-only. For persistence in the browser use `createIdbDraftStore()` from
`patcms/web` (see [web-stores.md](./web-stores.md)). Drafts survive `cms.refresh()` and
`cms.destroy()` — they live in the store, not the client cache.

### Debounced autosave pattern

The example panel saves a draft 600 ms after the last keystroke:

```ts
import { createCMS } from "patcms"
import type { ConfigDefinition } from "patcms"

declare const config: ConfigDefinition
declare const token: string

const cms = createCMS({ config, repository: { owner: "your-org", repo: "your-site", branch: "main" } })
await cms.auth.signIn(token)
const entry = await cms.entries.get("posts", "iris-no-7")

let timer: ReturnType<typeof setTimeout> | undefined
function queueDraftSave(value: Record<string, unknown>): void {
  clearTimeout(timer)
  timer = setTimeout(() => void cms.drafts.save(entry, value), 600)
}
```

### Surviving drafts across sessions

A draft that outlives its tab (IndexedDB store) meets a branch that moved on. Deciding what to do
at boot — discard, offer, or surface as conflict — is the advanced boot adjudication
(`adjudicateDraft`); see [advanced.md](./advanced.md). The simple host path is: offer the draft,
warn when stale, and let a clashing save surface as a conflict value.

## Where to next

- [advanced.md](./advanced.md) — `rebase()` and `adjudicateDraft`
- [errors.md](./errors.md) — why a conflict is a value but a validation failure is a throw
