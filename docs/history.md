# History and restore

Every save is a commit, so `entries.history()` can show what changed a file and
`entries.restore()` can bring an old version back. Both are **per entry** (they filter the
repository's commit log by that file's path), and restore never rewrites history: it writes the old
bytes as a new commit on top of the branch.

## Reading the history

`history(entry, options)` takes a full entry **or** a `listPaths` stub and returns newest first.
The stub is enough because the filter is the repo path — a deleted entry's history stays reachable.

```ts
import type { CMS } from "patcms"

declare const cms: CMS // constructed as in getting-started.md

const entry = await cms.entries.get("products", "iris-no-7")
const revisions = await cms.entries.history(entry, { limit: 20 })

const [newest] = revisions
if (newest !== undefined) {
  console.log(newest.commitSha, newest.authoredAt, newest.message)
}
```

| Option | Meaning |
|---|---|
| `limit` | Page size, 1–100. Default 20. |
| `before` | Cursor: pass the last `commitSha` of the previous page. The cursor row is not repeated. |

A page costs **one** GitHub request (`GET /repos/{owner}/{repo}/commits?path=…`), regardless of how
many versions are in it.

The returned `Revision` carries `commitSha`, `message`, and — when GitHub supplies them —
`authoredAt` (ISO date) and `authorName`.

## Previewing a version

`atRevision(entry, commitSha)` returns the entry as it was at that commit. It is a read: the head
does not move and nothing is written. The entry's `sha` is the historical blob sha, so it is not
the base for a normal `save`.

```ts
import type { CMS } from "patcms"

declare const cms: CMS // constructed as in getting-started.md

const entry = await cms.entries.get("products", "iris-no-7")
const revisions = await cms.entries.history(entry)
const previous = revisions[1]

if (previous !== undefined) {
  const old = await cms.entries.atRevision(entry, previous.commitSha)
  console.log(old.value, old.raw) // the exact historical text, untouched
}
```

`atRevision` throws `NOT_FOUND` when the file did not exist at that commit.

## Restoring a version

`restore(entry, commitSha, options?)` writes the historical file's **exact bytes** (the same blob
sha) as one new commit. `options.message` is the commit body, like every other write.

```ts
import { isCMSError } from "patcms"
import type { CMS } from "patcms"

declare const cms: CMS // constructed as in getting-started.md

const entry = await cms.entries.get("products", "iris-no-7")
const revisions = await cms.entries.history(entry)
const previous = revisions[1]

if (previous !== undefined) {
  try {
    const result = await cms.entries.restore(entry, previous.commitSha, {
      message: "Restore the spring price",
    })
    switch (result.status) {
      case "restored":
        console.log("new commit", result.commitSha) // history grew; nothing was rewritten
        break
      case "noop":
        console.log("the file already has those bytes")
        break
      case "conflict":
        console.log("changed since you loaded it:", result.current)
        break
    }
  } catch (error) {
    if (isCMSError(error) && error.code === "VALIDATION") {
      // That version no longer passes today's field rules. See the escape hatch below.
      console.log(error.issues)
    }
  }
}
```

The rules:

- **Deleted entry.** If the file is gone, restore re-creates it (an add). The deleted entry's stub
  from before the delete is enough.
- **Conflict.** If the file changed after the entry/stub was loaded, restore writes nothing and
  returns `{ status: "conflict", current }`. Re-read, then decide.
- **Noop.** If the file already carries those exact bytes, no commit is made.
- **Validation.** The historical value must pass the same gate as `save`. A version that no longer
  validates is refused with `CMSError` code `VALIDATION` and nothing is written.
- **One retry.** If the branch moved on unrelated files during the restore, the client retries once
  against the fresh head. A restore never forces the ref.

The old version's value may predate a config change (a field that is now required, for example). To
keep it anyway, read it with `atRevision` and save it deliberately — that path reports the usual
validation issues to your UI instead of refusing:

```ts
import type { CMS } from "patcms"

declare const cms: CMS // constructed as in getting-started.md
declare const commitSha: string

const entry = await cms.entries.get("products", "iris-no-7")
const old = await cms.entries.atRevision(entry, commitSha)
const current = await cms.entries.get("products", "iris-no-7") // base must be today's file
const saved = await cms.entries.save(current, old.value)
console.log(saved.status)
```

## Event

`entries:restore` fires once per completed `restore` call (including `noop` and `conflict`):

```ts
import type { CMS } from "patcms"

declare const cms: CMS // constructed as in getting-started.md

cms.events.on("entries:restore", ({ path, revision, status, commitSha }) => {
  console.log(path, revision, status, commitSha)
})
```

A thrown validation error emits nothing.

## Where to next

- [conflicts-and-drafts.md](./conflicts-and-drafts.md) — the conflict value in detail
- [writing-content.md](./writing-content.md) — the save pipeline, commit messages, events
