# patcms

A headless, git-backed CMS SDK. Content is plain JSON committed to your own GitHub repository; the
client talks directly to `api.github.com` with a fine-grained personal access token. No database, no
server, no bundled UI — `createCMS()` is the backend, you build the admin.

```bash
npm install patcms
```

## The three entries

| Import | What it gives you | Runtime |
|---|---|---|
| `patcms` | `createCMS()`, config DSL, field factories, validation, media helpers | Node-safe |
| `patcms/advanced` | Backends, save driver, rebase, serialization, safety — when the client is not enough | Node-safe |
| `patcms/web` | IndexedDB draft store and token stores | Browser only |

The main entry never touches DOM globals, so it is safe in Node scripts and SSR. `patcms/web` is the
only entry that does, and only hosts that want persistent drafts or tokens need it.

## Quickstart

### 1. Describe your content

Config is TypeScript plus zod, and it lives with your site:

```ts file="cms.config.ts"
import { defineCollection, defineConfig } from "patcms"
import * as fields from "patcms"

const products = defineCollection({
  name: "products",
  label: "Products",
  folder: "src/content/products",
  identifierField: "title",
  summary: "{{title}} · € {{price}}",
  previewPath: "/product/{{slug}}",
  schema: fields.object({
    label: "Product",
    fields: {
      title: fields.string({ label: "Title", required: true }),
      price: fields.number({ label: "Price", required: true, min: 0, int: true }),
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

### 2. Create the client

```ts
import { createCMS } from "patcms"
import { config } from "./cms.config"

declare const token: string // from your sign-in form
declare const bytes: Uint8Array

const cms = createCMS({
  config,
  repository: { owner: "your-org", repo: "your-site", branch: "main" },
})

// Sign in (probes capabilities; throws CMSError when the token cannot write):
await cms.auth.signIn(token)

// Read:
const entries = await cms.entries.list("products")
const entry = await cms.entries.get("products", "iris-no-7")

// Write (one commit, fast-forward-only; a conflict comes back as a value):
const result = await cms.entries.save(entry, { title: "Iris No. 7", price: 240 })
if (result.status === "conflict") {
  // result.current is the remote entry, result.local is yours — decide and retry
}

// Media:
const file = await cms.media.upload({ name: "photo.jpg", bytes })
const refs = await cms.media.references("/images/photo.webp")
```

### 3. Connect a token

Create a **fine-grained personal access token** for that one repository:

| Permission | Access | Why |
|---|---|---|
| Contents | read and write | read entries, publish commits |
| Checks | read | show deploy status |
| Administration | read | optional; branch-protection preflight |

Pass it to `auth.signIn(token)`. To remember it across reloads, pass a `tokenStore` from
`patcms/web` (`createIdbTokenStore()`); the default is memory-only, and a failed re-check wipes it.

## What is in the box

- **Reading** — one tree snapshot per load, lazy blob reads, lenient parse that never throws.
- **Validation** — a strict save gate: 12 field types, relation checks, size and depth caps.
- **Publishing** — one commit per save, fast-forward-only ref updates, zero-diff saves produce no
  commit.
- **Conflicts** — `{ status: "conflict", current, local }` as a value; `rebase()` in
  `patcms/advanced` if you want field-level merging.
- **Drafts** — written before the first network call; memory store by default, IndexedDB via
  `patcms/web`.
- **Media** — upload guards, reference-checked delete to `_trash/`, collision-guarded restore,
  budget math.
- **Deploy status** — check-runs primary, commit statuses only for configured contexts,
  `unavailable` rather than a false `failed`.
- **Access** — one fine-grained PAT; GitHub repository permissions are the authorization model.

JSON only in v1: Markdown/MDX collections are out of scope.

## Security model

The client holds a write-capable token in an origin that renders untrusted repository content, so the
default is denial: paths go through `safePath()`, URLs through `safeUrl()`, JSON through
`parseUntrustedJson()`, and this package ships no test doubles, sourcemaps, or telemetry. Any code
running on the same origin can read a persisted token — keep it single-repository, fine-grained, and
rotatable.

## Status

Pre-1.0: a minor release may break the API until the surface freezes.

## License

MIT.
