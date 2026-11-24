# Writing content

## The save pipeline

`entries.save(entry, value)` runs one transaction:

1. Re-read the branch head and tree (fresh, cache-bypassing).
2. Validate the value strictly (see below).
3. Build the changeset: serialize the entry, **preserving `entry.untouched` verbatim** at their
   original JSON-Pointer paths.
4. Commit as one tree commit; update the ref **fast-forward-only**.
5. Verify the ref actually carries the new commit; then (and only then) the draft is deleted.

Two special first-save cases, both refused before anything is written:

- On a brand-new (empty) repository there is no branch head yet, and GitHub's git-data API refuses
  every write to it. The first save therefore goes through the file-contents API instead: a save
  writing **one file** creates the root commit and the branch in that single request; a save writing
  **several files** seeds the first one the same way and then commits the rest on top (two commits —
  the only exception to one-commit-per-save). From the second save on, ordinary fast-forwards apply.
  Reads before the first save return empty lists and not-found entries.
- A branch that exists only in your `repository.branch` config but not on GitHub (on a repository
  that has commits) fails with a not-found error that names the branch — create it on GitHub first.

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

## Bulk editing

A batch is **one commit, all-or-nothing**: every row is bound to a fresh head first, and if a single
base sha is stale nothing is written. Stale rows come back as values carrying their current state,
so there is no half-saved table.

```ts
import type { CMS } from "patcms"

declare const cms: CMS // constructed as in getting-started.md

// A table of edited rows: list() stubs are enough. The SDK hydrates each one
// from the cache, so this needs no per-row get().
const rows = await cms.entries.list("products")
const result = await cms.entries.saveMany(
  rows.map((entry) => ({ entry, value: { ...entry.value, price: Number(entry.value.price) + 5 } })),
)

if (result.status === "conflict") {
  // Zero writes. Every stale row names its current state.
  for (const conflict of result.conflicts) console.log(conflict.path, conflict.current)
}
```

```ts
import type { CMS } from "patcms"

declare const cms: CMS // constructed as in getting-started.md

// Import: slugs are derived per row (or given explicitly). A taken slug is a
// conflict; the whole import writes nothing.
const imported = await cms.entries.createMany([
  { collection: "products", value: { title: "Iris No. 7", price: 240 } },
  { collection: "products", value: { title: "Iris No. 8", price: 260 }, slug: "iris-no-8" },
])
if (imported.status === "conflict") console.log(imported.conflicts)

// Bulk delete: a file already deleted by someone else is simply skipped.
const all = await cms.entries.listPaths("products")
const removed = await cms.entries.deleteMany(all.filter((entry) => entry.slug.startsWith("old-")))
if (removed.status === "conflict") console.log(removed.conflicts)
```

- Validation runs for the whole batch **before** any write and throws a `CMSError` (`VALIDATION`):
  the message names every offending file and `issues` carries the merged field errors.
- A batch that names the same file twice is rejected before the network.
- `saveMany` accepts full `get()` entries or `list()` stubs; unchanged rows cost no write.
- The commit subject counts every file in the commit (`chore(cms): save 12 file(s)`); the automatic
  one-retry-on-unrelated-change rule from a single save applies to the whole batch.
- One `entries:bulk` event fires when a bulk call returns; a thrown validation error emits nothing.

## History and restore

Every save is a commit. `entries.history(entry)` lists the commits that touched one file (a
`listPaths` stub is enough, so deleted entries keep their history), `entries.atRevision` previews a
version read-only, and `entries.restore` writes that version's exact bytes as a **new** commit.
See [history.md](./history.md) for the result types, the validation gate, and the conflict rules.

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
| `entries:bulk` | `{ operation, status, paths, commitSha? }` | once per `saveMany`/`createMany`/`deleteMany` |
| `entries:restore` | `{ path, revision, status, commitSha? }` | once per `restore` (including `noop`/`conflict`) |
| `media:upload` | `{ file }` | upload succeeded |
| `media:delete` | `{ path }` | delete actually deleted (not on `referenced`) |

## Where to next

- [history.md](./history.md) — restore an earlier version; read a file's commit log
- [conflicts-and-drafts.md](./conflicts-and-drafts.md) — the conflict value and draft autosave
- [advanced.md](./advanced.md) — `runSave`/`createSaveCoordinator` when you need queueing or leases
