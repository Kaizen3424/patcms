# Writing content

## The save pipeline

`entries.save(entry, value)` runs one transaction:

1. Re-read the branch head and tree (fresh, cache-bypassing).
2. Validate the value strictly (see below).
3. Build the changeset: serialize the entry, **preserving `entry.untouched` verbatim** at their
   original JSON-Pointer paths.
4. Commit as one tree commit; update the ref **fast-forward-only**.
5. Verify the ref actually carries the new commit; then (and only then) the draft is deleted.

If the head moved between step 1 and step 4 (someone else pushed), the ref update fails the
compare-and-swap. When the foreign commit touched **only other files**, the client retries once
automatically against the new head. When it touched **your file**, you get a conflict value —
never an exception, never a merge (see [conflicts-and-drafts.md](./conflicts-and-drafts.md)).

## Handling the result

```ts
import type { CMS } from "patcms"

declare const cms: CMS // constructed as in getting-started.md

const entry = await cms.entries.get("products", "iris-no-7")
const result = await cms.entries.save(entry, { ...entry.value, price: 240 }, {
  message: "Price update from the spring campaign",
})

switch (result.status) {
  case "saved":
    console.log(result.commitSha, result.entry) // result.entry is the fresh post-save state
    break
  case "noop":
    // The serialized bytes are identical to what is on the branch — no commit made.
    break
  case "conflict":
    console.log(result.current, result.local) // resolve per field, then save again
    break
}
```

`status: "noop"` is normal and good: repeated saves of unchanged content cost nothing.

## Validation

`save` validates strictly and **throws** a `CMSError` (code `VALIDATION`, `issues` attached) when
the value is invalid. To show issues in a form without attempting a save, use `validate`, which
returns them as a value:

```ts
import type { CMS } from "patcms"

declare const cms: CMS // constructed as in getting-started.md
declare const formValue: Record<string, unknown>

const entry = await cms.entries.get("products", "iris-no-7")
const check = await cms.entries.validate(entry, formValue)
if (!check.ok) {
  for (const issue of check.issues) {
    console.log(issue.severity, issue.code, issue.path, issue.message)
  }
}
```

Missing `hidden` fields that carry a `defaultValue` are backfilled on save (repair-on-save), so
tooling-added keys do not block editor saves.

## Creating and deleting entries

```ts
import { isCMSError } from "patcms"
import type { CMS } from "patcms"

declare const cms: CMS // constructed as in getting-started.md

// Create — folder collections only, and only when create is not disabled in config.
const created = await cms.entries.create("posts", { title: "Hello", date: "2026-05-01" })
if (created.status === "saved") console.log(created.entry.slug)

// Explicit slug instead of deriving it from the identifier field:
await cms.entries.create("posts", { title: "Hello" }, { slug: "hello-world" })

// Delete — honours the collection's `delete: false` (UNSUPPORTED).
const existing = await cms.entries.get("posts", "hello-world")
const gone = await cms.entries.delete(existing)
if (gone.status === "conflict") console.log(gone.current) // changed on branch; re-read first
```

Validation failures from `create` arrive as a thrown `CMSError` with `issues` — catch with
`isCMSError` and render `error.issues`.

## Slugs and paths

```ts
import type { CMS } from "patcms"

declare const cms: CMS // constructed as in getting-started.md

// Slug proposed from the collection's identifierField, slugified (accent-folded,
// punctuation collapsed; falls back to "entry" when nothing survives).
const slug = cms.entries.slugFromValue("posts", { title: "Café au Lait!" }) // "cafe-au-lait"

// Repo path for an entry — pure, no network call.
const path = cms.entries.path("posts", slug) // "content/posts/cafe-au-lait.json"
```

`path()` normalizes the slug: strips a trailing `.json`, refuses empty/`.`/`..`/separators, and
runs the result through `safePath()`.

## Commit messages

- Subject: `chore(cms): save N file(s)` — generated, not configurable.
- `options.message` becomes the commit **body**.
- Messages containing skip tokens (`[skip ci]`, `[ci skip]`, `[no ci]`, `[skip actions]`) are
  refused **before any network call** — the CMS must never silently suppress its own deploy.

## Events

```ts
import type { CMS } from "patcms"

declare const cms: CMS // constructed as in getting-started.md

const off = cms.events.on("save:conflict", ({ entry, current }) => {
  console.log("conflict on", entry.slug, "remote head:", current.sha)
})

// Later: unsubscribe
off()
```

| Event | Payload | Fired when |
|---|---|---|
| `auth:change` | `{ status }` | any auth status transition |
| `save:start` | `{ entry }` | `entries.save` begins (not fired by `create`) |
| `save:success` | `{ entry, result }` | saved **or** noop |
| `save:conflict` | `{ entry, current }` | save or create returned a conflict |
| `save:error` | `{ entry, error }` | save threw (`CMSError`) |
| `media:upload` | `{ file }` | upload succeeded |
| `media:delete` | `{ path }` | delete actually deleted (not on `referenced`) |

## Where to next

- [conflicts-and-drafts.md](./conflicts-and-drafts.md) — the conflict value and draft autosave
- [advanced.md](./advanced.md) — `runSave`/`createSaveCoordinator` when you need queueing or leases
