# Getting started

## The mental model

Three facts explain almost everything about patcms:

1. **Content is files in your own repository.** Every entry is a JSON document on a branch. Git
   history is the audit log; GitHub branch protection is the authorization model; your static site
   reads the same files the CMS writes.
2. **The client is a typed API over the GitHub REST API.** `createCMS()` gives you `auth`,
   `entries`, `media`, `drafts`, `events`. It holds no server of its own — the browser (or Node)
   calls `api.github.com` directly with a fine-grained PAT.
3. **You build the admin.** The package ships no UI. `playground/src/panel/` is a complete,
   working admin built only on the public API — copy it or use it as the reference while you build
   your own.

## Install

```bash
npm install patcms
```

or, with bun:

```bash
bun add patcms
```

Runtime dependencies are `zod` and `idb-keyval` — nothing else. ESM only; Node >= 22.12. Bun works
too — CI smoke-tests the packed tarball under bun on every change (`patcms` and `patcms/advanced`
touch no DOM and no Node-only globals; only `patcms/web` needs a browser).

## The three entries

| Import | What it gives you | Runtime |
|---|---|---|
| `patcms` | `createCMS()`, config DSL, field factories, media and safety helpers | Node-safe |
| `patcms/advanced` | Backends, save driver, rebase, serialization — when the client is not enough | Node-safe |
| `patcms/web` | IndexedDB draft store and token stores | Browser only |

The main entry never touches DOM globals, so it is safe in Node scripts and SSR. `patcms/web` is
the only entry that does.

## Quickstart

### 1. Describe your content

Config is TypeScript plus zod, and it lives with your site. Every field of the zod schema carries
metadata from a `fields.*` factory — that metadata is what the client (and your admin UI) reads:

```ts file="cms.config.ts"
import { defineCollection, defineConfig } from "patcms"
import * as fields from "patcms"

const products = defineCollection({
  name: "products",
  label: "Products",
  folder: "content/products",
  identifierField: "title",
  summary: "{{title}} · € {{price}}",
  previewPath: "/product/{{slug}}",
  schema: fields.object({
    label: "Product",
    fields: {
      title: fields.string({ label: "Title" }),
      price: fields.number({ label: "Price", min: 0, int: true }),
      description: fields.text({ label: "Description", required: false }),
      image: fields.image({ label: "Photo", required: false }),
    },
  }),
})

export const config = defineConfig({
  media: { folder: "public/images", publicFolder: "/images" },
  collections: [products],
})
```

### 2. Create the client and make your first save

```ts
import { createCMS } from "patcms"
import { config } from "./cms.config"

declare const token: string // from your sign-in form — never hardcode a PAT

const cms = createCMS({
  config,
  repository: { owner: "your-org", repo: "your-site", branch: "main" },
})

// Sign in probes capabilities first; throws CMSError when the token cannot write.
await cms.auth.signIn(token, { remember: true })

// Read:
const entries = await cms.entries.list("products")
const entry = await cms.entries.get("products", "iris-no-7")

// Write: one commit, fast-forward-only. Spread the loaded value so fields you
// did not touch keep their content.
const result = await cms.entries.save(entry, { ...entry.value, price: 240 })
if (result.status === "conflict") {
  // Someone pushed first. result.current is the remote entry, result.local is
  // yours — both are values; decide per field and save again. Never an exception.
}
```

### 3. Connect a token

Create a **fine-grained personal access token** scoped to that one repository:

| Permission | Access | Why |
|---|---|---|
| Contents | read and write | read entries, publish commits |
| Checks | read | show deploy status |
| Administration | read | optional; branch-protection preflight |

Pass it to `auth.signIn(token)`. With `{ remember: true }` the token is persisted through the
configured `tokenStore` — memory-only by default, IndexedDB via `createIdbTokenStore()` from
`patcms/web` (see [web-stores.md](./web-stores.md)). A failed re-check wipes the stored token.

## What you will see on GitHub

- Each save is **one commit** on your branch with the subject `chore(cms): save N file(s)`; an
  optional `message` option becomes the commit body. Zero-diff saves produce no commit at all
  (`status: "noop"`).
- Saves are **fast-forward-only**: if someone else pushed first, you get a conflict value — the
  client never force-pushes and never merges on its own.
- Media deletes move the file to `_trash/` in the repo (one commit), never a hard delete.

## Wiring it into your app

`createCMS()` is framework-agnostic. The minimal wiring is: construct once, react to
`auth.onChange`, and call the APIs from your UI:

```ts
import { createCMS } from "patcms"
import { createIdbDraftStore, createIdbTokenStore } from "patcms/web"
import { config } from "./cms.config"

export const cms = createCMS({
  config,
  repository: { owner: "your-org", repo: "your-site", branch: "main" },
  // Persist drafts and the token across reloads (browser only):
  tokenStore: createIdbTokenStore(),
  drafts: createIdbDraftStore(),
})

// Restore a remembered session on boot; undefined when none was stored.
await cms.auth.restore()

// Re-render your UI when the auth status changes.
cms.auth.onChange((status) => {
  console.log("auth:", status) // "signedOut" | "checking" | "signedIn"
})
```

For the full admin — screens, widgets, conflict UI, media library — see
[building-an-admin.md](./building-an-admin.md).

## Where to next

- [configuration.md](./configuration.md) — every collection option and all 12 field types
- [writing-content.md](./writing-content.md) — what `save` does, byte for byte
- [pitfalls.md](./pitfalls.md) — read this before your first production save
