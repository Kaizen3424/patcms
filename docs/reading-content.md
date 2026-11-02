# Reading content

## How reads work

- **One tree snapshot per load.** The client reads the branch head and the full tree, then serves
  `entries.*` from that snapshot. Individual documents are fetched lazily, by blob sha.
- **The cache is keyed by commit sha.** Branch-addressed lookups (the ref, the tree) bypass the
  browser HTTP cache with `cache: "no-store"` — GitHub serves the ref route with `max-age=60`, and
  without this a just-pushed foreign commit could be invisible for up to a minute.
- **Re-reading is always fresh.** Call `list`/`get` again after anything happens on the branch;
  the client re-reads the head and re-downloads only what changed. `cms.refresh()` forces it;
  `cms.clearCache()` drops everything without re-reading. Drafts survive both.

## Listing entries

```ts
import type { CMS } from "patcms"

declare const cms: CMS // constructed as in getting-started.md

// Full listing: parses every document (leniently — never throws on bad data).
const posts = await cms.entries.list("posts")

// Sorted by a top-level field; direction defaults to "asc".
const byDate = await cms.entries.list("posts", { sort: "date", direction: "desc" })

// Tree-only listing: no blob reads, titles fall back to the slug.
const stubs = await cms.entries.listPaths("posts")
```

Sorting details: the default sort key is the entry title; empty values sort last regardless of
direction; comparison uses `nl-NL` collation via `compareValues` (exported from `patcms` if your
UI wants the same ordering).

## What a listing returns

| Type | Fields | Notes |
|---|---|---|
| `EntryStub` | `collection, slug, path, sha, title` | `listPaths` result |
| `EntrySummary` | + `value`, `issues` | `list` result — the parsed value plus parse issues |
| `Entry` | + `raw`, `untouched`, `fields`, `media` | `entries.get` result — everything a save needs |

`entry.issues` is the lenient parse report (`ParseIssue[]` with `path`, `code`, `message`,
`severity`). Render it; never let it block reading — a hand-edited JSON file with a wrong type
still loads, and the issues tell your UI what is wrong. See
[errors.md](./errors.md) for the issue catalogue.

## Loading one entry

```ts
import { isCMSError } from "patcms"
import type { CMS } from "patcms"

declare const cms: CMS // constructed as in getting-started.md

try {
  const entry = await cms.entries.get("posts", "iris-no-7")
  console.log(entry.value, entry.untouched, entry.sha)
} catch (error) {
  if (isCMSError(error) && error.code === "NOT_FOUND") {
    // no such slug in this collection
  }
}
```

`slug` is the filename minus `.json`. `entry.raw` is the decoded source bytes — the base for the
next byte-preserving save (see [writing-content.md](./writing-content.md)).

## Files collections

`entries.list` works on files collections too; the slug is the file `name` from config. There is
no `slugFromValue` for files collections (`UNSUPPORTED`) — their file set is fixed.

## Where to next

- [writing-content.md](./writing-content.md) — turning an `Entry` back into a commit
- [conflicts-and-drafts.md](./conflicts-and-drafts.md) — drafts ride on top of these reads
