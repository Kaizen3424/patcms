---
name: patcms
description: Use when working with patcms — the git-backed, zero-database headless CMS SDK whose createCMS() client manages JSON content in a GitHub repository with a fine-grained PAT (entries, media, drafts, conflicts, deploy status). Use this skill whenever a task involves patcms, createCMS, patcms/advanced, patcms/web, editing website content stored as JSON in a GitHub repo, building an admin panel over GitHub content, GitHub-backed media uploads, or debugging saves/conflicts/media/auth in a patcms integration — even when the user does not name the package.
---

# patcms

patcms is a headless, git-backed CMS SDK. Content is plain JSON committed to the user's own GitHub
repository; the client talks directly to `api.github.com` with a fine-grained personal access
token. There is no database, no server, and **no bundled UI** — `createCMS()` is the backend, the
host builds the admin. Published package: `patcms` (0.x — a minor release may break the API).

| Import | Gives you | Runtime |
|---|---|---|
| `patcms` | `createCMS()`, config DSL, field factories, media/safety helpers | Node-safe |
| `patcms/advanced` | Backends, save driver, `rebase`, serialization — when the client is not enough | Node-safe |
| `patcms/web` | IndexedDB draft store and token stores | Browser only |

## Non-negotiables (breaking one is a bug, not a style choice)

These hold in every host, script, and test you write with this package:

- **Never force-push.** Saves are fast-forward-only CAS updates; conflicts come back as values.
- **Never read `raw.githubusercontent.com`.** File bytes come from the git blob API (`media.get`).
- **Never put the token in a URL, query string, or log line.** Sign-in form or env var only.
- **Never render repository content as HTML** (`dangerouslySetInnerHTML`, `eval`, `innerHTML=`).
- **Never merge parsed repository JSON** with `Object.assign` or a deep merge — use the value-domain
  helpers (`compareValues`, `canonicalJson`).
- **Never write commit messages containing `[skip ci]`-style tokens** — the SDK refuses them before
  any network call, and your code must not try to sneak them in.
- **Never treat a save conflict as an exception.** It is `{ status: "conflict", current, local }`.

## The five facts that prevent most mistakes

1. **A save is one commit, fast-forward-only.** `entries.save` returns `saved` / `noop` / `conflict`
   as a value. `noop` (zero-diff) is success — no commit, no retry. A conflict on your file is a
   value; a conflict on *other* files is auto-retried once for you.
2. **Untouched keys survive.** JSON keys not declared in the config are preserved verbatim on save
   (`entry.untouched`). Removing a field from config never deletes data. `defaultValue` is metadata
   only — parsing never injects it.
3. **Stored image values are public paths** (`/images/…`), files live at repo paths
   (`public/images/…`). The mapping is bijective and comes from config.
4. **Media deletes are soft.** Delete moves the file to `_trash/` in one commit; restore is
   collision-guarded. Delete is reference-checked first (`{ status: "referenced", references }`).
5. **Branch-addressed GETs are sent with `cache: "no-store"`** because GitHub serves the ref route
   with `max-age=60`. If you write a custom transport, keep that behaviour or stale heads will lie
   to you after foreign pushes.

## Minimal usage

```ts
import { createCMS } from "patcms"
import type { ConfigDefinition } from "patcms"

declare const config: ConfigDefinition
declare const token: string // from a sign-in form or env var — never hardcoded

const cms = createCMS({
  config,
  repository: { owner: "your-org", repo: "your-site", branch: "main" },
})

const session = await cms.auth.signIn(token, { remember: true }) // probes capabilities; throws when the token cannot write
const entries = await cms.entries.list("posts")
const entry = await cms.entries.get("posts", "hello-world")

const result = await cms.entries.save(entry, { ...entry.value, title: "New title" })
if (result.status === "conflict") {
  // result.current (remote Entry) vs result.local (your EntryValue):
  // render both per field, let the user pick, save the merged value on top of current.
}
```

Config comes from the host (TypeScript + zod with `fields.*` metadata on every property):

```ts
import { defineCollection, defineConfig } from "patcms"
import * as fields from "patcms"

export const config = defineConfig({
  media: { folder: "public/images", publicFolder: "/images" },
  collections: [
    defineCollection({
      name: "posts",
      label: "Posts",
      folder: "content/posts",
      identifierField: "title",
      schema: fields.object({
        label: "Post",
        fields: {
          title: fields.string({ label: "Title" }),
          date: fields.datetime({ label: "Date", dateOnly: true }),
        },
      }),
    }),
  ],
})
```

## Where to go next (read the reference that matches the task)

| Task | Read |
|---|---|
| Any API call — signatures, result shapes, error codes | [references/api.md](references/api.md) |
| Describing content — collections, all 12 field types, validation | [references/configuration.md](references/configuration.md) |
| Multi-step tasks — sign-in, save, conflict resolution, media ladder, drafts, deploy status | [references/workflows.md](references/workflows.md) |
| Before unusual code — vetoes, failure modes, gotchas | [references/pitfalls.md](references/pitfalls.md) |
| Testing an integration without a real PAT | [references/testing.md](references/testing.md) |

Working code: the patcms repository's `playground/src/panel/` is a complete admin built only on the
public API — the reference implementation. Its `docs/` folder has the long-form documentation.
In downstream projects neither exists; the references above are self-sufficient.

## Error handling in one line

Catch `CMSError` with `isCMSError(error)` and branch on `error.code` (`AUTH_EXPIRED`, `VALIDATION`
with `error.issues`, `RATE_LIMIT` with `error.retryAt`, `CONFLICT`, `NOT_FOUND`, …). Validation
issues from `entries.validate` arrive as a value (`{ ok: false, issues }`), from `save`/`create` as
a thrown `CMSError` with `issues` attached. See [references/api.md](references/api.md) for the full
tables.
