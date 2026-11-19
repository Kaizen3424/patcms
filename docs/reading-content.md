# Reading content

## How reads work

- **One tree snapshot per head, reused for 30 s.** The client checks the branch head once, reads
  the full tree, then serves `entries.*` from that snapshot. For the next 30 seconds reads reuse
  that head without touching the network; after that the next read re-checks the ref. Configure it
  with `createCMS({ readReuseMs })` — `0` makes every read re-check the head. Saves always
  re-check, so an editor you are saving over is never missed.
- **Bodies are content-addressed and cached.** Each document is fetched once by blob sha and kept
  in memory, so a repeat listing, a `get` right after a `list`, and a re-open after `refresh()`
  download nothing. Only a file whose bytes actually moved is re-downloaded.
- **The cache is keyed by commit sha.** Branch-addressed lookups (the ref, the tree) bypass the
  browser HTTP cache with `cache: "no-store"` — GitHub serves the ref route with `max-age=60`, and
  without this a just-pushed foreign commit could be invisible for up to a minute. Blobs are
  immutable, so they stay cacheable.
- **`refresh()` re-checks the head; `clearCache()` starts over.** `cms.refresh()` makes one ref
  request and keeps every unchanged body; `cms.clearCache()` drops entries, blobs, and the tree.
  Drafts survive both.
- **Optional on-device copy.** Pass `contentStore: createIdbContentStore()` from `patcms/web` and raw
  entry text survives page loads, keyed by path + blob sha. A cold open then downloads only the
  documents whose bytes moved — 3 requests instead of 183 for 180 unchanged entries. `clearCache()`
  and sign-out wipe it; closing the tab does not. See [web-stores.md](./web-stores.md).
- **Bounded fan-out.** A collection lists with at most 5 parallel body reads (GitHub secondary-rate
  posture). Override with `createCMS({ readConcurrency })`.

The 30-second window only delays **other people's** changes on screen. After your own save the
client forgets the head immediately, so your own edit is always visible on the next read.

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
