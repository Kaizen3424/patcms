# patcms

A headless, git-backed CMS SDK with no database and no server. Content is plain JSON in your own
GitHub repository; the client talks **directly to `api.github.com`** with a fine-grained personal
access token. Your token never leaves the browser. You build your own admin — `createCMS()` handles
the backend.

> **Status: 0.1.0, pre-1.0.** The implementation is complete and tested; publication is the last step.
> The npm package is `patcms`. Until 1.0, a minor release may break the API.

## Why

The existing git-based options each force a trade: a frozen admin skin, framework lock-in, a database,
or paid hosting. patcms takes the middle: your content, your repo, your UI.

| | Sveltia / Decap | Tina / Keystatic | Storyblok / Sanity | **patcms** |
|---|---|---|---|---|
| No database | yes | partial | managed cloud | **yes** |
| UI you own | frozen | partial | partial | **yes — you build it** |
| Zod validation shared with the site build | no | no | custom | **yes, one schema** |
| Zod-first config as data, not code | no | partial | no | **yes** |
| Runs with no server | yes | partial | no | **yes** |
| Drafts, conflict recovery, deploy status | partial | partial | hosted | **yes** |

## How it works

1. **Config is TypeScript on your side.** `defineConfig` / `defineCollection` / `fields.*` build zod
   schemas that validate the same way at build time and in your admin.
2. **The client receives descriptors, never schemas.** `toAdminConfig()` projects the config to a
   strict, JSON-safe document. The browser gets no code and no secrets beyond the token you pass.
3. **Reads are one tree snapshot.** `entries.list()` is built from a single recursive tree read; file
   bodies load lazily from the git blob API.
4. **Writes are one commit.** A save creates blobs, a tree with `base_tree`, a commit, then updates the
   ref fast-forward-only. A concurrent push returns `{ status: "conflict", current, local }` — never a
   silent overwrite, never `force`.
5. **Nothing else runs.** No database, no queue, no webhook, no telemetry, no third-party runtime
   script. Deploy status is polled from GitHub check-runs when the token may read them.

## The three entries

| Import | What it gives you | Runtime |
|---|---|---|
| `patcms` | `createCMS()`, config DSL, field factories, validation, media helpers | Node-safe |
| `patcms/advanced` | Backends, save driver, rebase, serialization, safety — when the client is not enough | Node-safe |
| `patcms/web` | IndexedDB draft store and token stores | Browser only |

## Quickstart

### 1. Describe your content

```ts
// cms.config.ts
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

| Area | Behaviour |
|---|---|
| Reading | One tree snapshot per load, lazy blob reads, lenient parse that never throws |
| Validation | Strict save gate: 12 field types, relation checks, size/depth caps |
| Publishing | One commit per save, fast-forward-only ref updates, zero-diff saves produce no commit |
| Conflicts | `{ status: "conflict", current, local }` as a value; `rebase()` in `patcms/advanced` if you want field-level merge |
| Drafts | Written before the first network call; memory store by default, IndexedDB via `patcms/web` |
| Media | Upload guards, reference-checked delete to `_trash/`, collision-guarded restore, budget math |
| Deploy status | Check-runs primary, commit statuses only for configured contexts, `unavailable` rather than a false `failed` |
| Access | One fine-grained PAT; GitHub repository permissions are the authorization model |

**Not in this release:** an OAuth flow, a second backend (GitLab), an importer for Decap/Sveltia
configs, PR/staging-branch mode, WYSIWYG markdown, i18n, and inline SVG. See
[`plans/headless-sdk.md`](plans/headless-sdk.md).

## Security model

The client holds a write-capable token in an origin that renders untrusted repository content, so the
default is denial: paths go through `safePath()`, URLs through `safeUrl()`, JSON through
`parseUntrustedJson()`, and the published tarball is scanned for sourcemaps, test doubles, and
telemetry. The honest limitation is in [`SECURITY.md`](SECURITY.md): any code running on the same
origin can read a persisted token. That is why the token is single-repository, fine-grained, and
rotatable. Report vulnerabilities through GitHub Security Advisories, never a public issue.

## Documentation

| Read | For |
|---|---|
| [`specs/CMS.md`](specs/CMS.md) | The whole system in one pass: stack, commands, surface, data model, auth, flows, vetoes |
| [`specs/workflows/publish-and-recovery.md`](specs/workflows/publish-and-recovery.md) | The save machine, conflicts, drafts, boot recovery, deploy status |
| [`specs/backend-and-auth-architecture.md`](specs/backend-and-auth-architecture.md) | The transport, token lifecycle, rate limits, adding a backend |
| [`specs/content-model-architecture.md`](specs/content-model-architecture.md) | Config, fields, parse/save, untouched preservation |
| [`specs/media-architecture.md`](specs/media-architecture.md) | Bijection, upload guards, references, trash, budgets |
| [`specs/test-harness-architecture.md`](specs/test-harness-architecture.md) | FakeGithub, fixtures, test doubles, CI guards |
| [`plans/headless-sdk.md`](plans/headless-sdk.md) | Release policy, publish blockers, yve cutover |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | Branching, commits, how to add a widget or backend |

Each spec ends with the decisions and testable claims for its subsystem, so an `ADR-xxxx` or
`INV-xxxx` comment in the source resolves to exactly one place.

## Development

```bash
pnpm install --frozen-lockfile   # CI-parity install
pnpm -r typecheck                # per-package tsc -b
pnpm run check                   # biome lint + format, warnings are errors
pnpm -r test                     # vitest across workspaces
pnpm -r build                    # tsup (core) and vite (admin, playground)
pnpm run pack:check              # tarball hygiene + entry resolution for the published package
pnpm fixtures:check              # verify byte-pinned fixtures
```

The playground under `playground/` runs a fake GitHub in the browser, so the full editing loop works
offline. `pnpm -C playground dev` starts it.

Node ≥ 22.12 and pnpm via corepack. CI runs the same gates on every push and pull request.

## License

MIT. See [`LICENSE`](LICENSE).
