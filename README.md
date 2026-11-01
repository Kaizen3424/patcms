# MyCMS

A git-backed CMS with no database and no server. Content is plain JSON in your own GitHub repository;
the admin is a static React SPA that talks **directly to `api.github.com`** with a fine-grained personal
access token. Your token never leaves the browser.

> **Status: 0.1.0, pre-1.0.** The implementation is complete and tested; publication is the last step.
> Packages are `@mycms/core` (npm) and `@mycms/admin` (consumed from this repo). Until 1.0, a minor
> release may break the API.

## Why

The existing git-based options each force a trade: a frozen admin skin, framework lock-in, a database,
or paid hosting. MyCMS takes the middle: your content, your repo, your UI.

| | Sveltia / Decap | Tina / Keystatic | Storyblok / Sanity | **MyCMS** |
|---|---|---|---|---|
| No database | yes | partial | managed cloud | **yes** |
| Admin you can own and theme | frozen | partial | partial | **yes — tokens and config** |
| Zod validation shared with the site build | no | no | custom | **yes, one schema** |
| Zod-first config as data, not code | no | partial | no | **yes** |
| Runs with no server | yes | partial | no | **yes** |
| Drafts, conflict recovery, deploy status | partial | partial | hosted | **yes** |

## How it works

1. **Config is TypeScript on your side.** `defineConfig` / `defineCollection` / `fields.*` build zod
   schemas that validate the same way at build time and in the admin.
2. **The admin receives descriptors, never schemas.** `toAdminConfig()` projects the config to a
   strict, JSON-safe document. The browser gets no code and no secrets beyond the token you enter.
3. **Reads are one tree snapshot.** The library index is built from a single recursive tree read; file
   bodies load lazily from the git blob API.
4. **Writes are one commit.** A save creates blobs, a tree with `base_tree`, a commit, then updates the
   ref fast-forward-only. A concurrent push becomes a field-granular conflict, never a silent overwrite.
5. **Nothing else runs.** No database, no queue, no webhook, no telemetry, no third-party runtime
   script. Deploy status is polled from GitHub check-runs when the token may read them.

## Quickstart

Two halves: a config module that lives with your site, and one mount call in the page that hosts the
admin. `@mycms/core` is the npm package; `@mycms/admin` ships as a built artifact from this repository,
and `playground/src/main.ts` is the reference host.

### 1. Describe your content

Host-side only, never shipped to the browser:

```ts
// mycms.config.ts
import * as fields from "@mycms/core"
import { defineCollection, defineConfig, toAdminConfig } from "@mycms/core"
import { z } from "zod"

const products = defineCollection({
  name: "products",
  label: "Products",
  folder: "src/content/products",
  identifierField: "title",
  summary: "{{title}} · € {{price}}",
  previewPath: "/product/{{slug}}",
  schema: z.object({
    title: fields.string({ label: "Title", required: true }),
    price: fields.number({ label: "Price", required: true, min: 0, int: true }),
    description: fields.text({ label: "Description", required: false }),
    image: fields.image({ label: "Photo", required: false }),
  }),
})

export const config = toAdminConfig(
  defineConfig({
    media: { folder: "public/images", publicFolder: "/images" },
    collections: [products],
  }),
)
```

### 2. Mount the admin

Anywhere a DOM element exists:

```ts
import { mountAdmin } from "@mycms/admin"
import "@mycms/admin/styles.css"
import { config } from "./mycms.config"

mountAdmin(document.getElementById("admin")!, {
  config,
  support: { name: "Studio support" },
  repository: { owner: "your-org", repo: "your-site", branch: "main" },
})
```

### 3. Connect a token

Create a **fine-grained personal access token** for that one repository:

| Permission | Access | Why |
|---|---|---|
| Contents | read and write | read entries, publish commits |
| Checks | read | show deploy status |
| Administration | read | optional; branch-protection preflight |

Paste it into the login screen. "Remember on this device" is opt-in; the token is stored only in this
browser and is wiped on sign-out or a failed re-check.

## What is in the box

| Area | Behaviour |
|---|---|
| Library | One collection at a time, search, view groups, advisory issue counts that never block unrelated saves |
| Editor | 12 field types including the virtual slug, nested lists and objects, live validation, unsaved-change protection |
| Publishing | One commit per save, fast-forward-only ref updates, zero-diff saves produce no commit |
| Conflicts | Field-granular freeze at the smallest contested node; save stays blocked until every row is decided |
| Recovery | Drafts are written before the first network call; a reload or crash offers resume, discard, or a conflict |
| Media | Upload guards, EXIF-stripping re-encode, reference-checked delete to `_trash/`, collision-guarded restore |
| Deploy status | Check-runs primary, commit statuses only for configured contexts, `unavailable` rather than a false `failed` |
| Access | One fine-grained PAT; GitHub repository permissions are the authorization model |

**Not in this release:** an OAuth flow, a second backend (GitLab), an importer for Decap/Sveltia
configs, PR/staging-branch mode, WYSIWYG markdown, i18n, and inline SVG. See
[`plans/phase-7-publish.md`](plans/phase-7-publish.md).

## Security model

The admin holds a write-capable token in an origin that renders untrusted repository content, so the
default is denial: templates render as text nodes only, paths go through `safePath()`, URLs through
`safeUrl()`, JSON through `parseUntrustedJson()`, and the built bundle is scanned for sourcemaps,
test doubles, and telemetry. The honest limitation is in [`SECURITY.md`](SECURITY.md): any code running
on the admin origin can read a persisted token. That is why the token is single-repository,
fine-grained, and rotatable. Report vulnerabilities through GitHub Security Advisories, never a public
issue.

## Documentation

| Read | For |
|---|---|
| [`specs/CMS.md`](specs/CMS.md) | The whole system in one pass: stack, commands, routes, data model, auth, flows, vetoes |
| [`specs/workflows/publish-and-recovery.md`](specs/workflows/publish-and-recovery.md) | The save machine, conflicts, drafts, boot recovery, deploy status |
| [`specs/backend-and-auth-architecture.md`](specs/backend-and-auth-architecture.md) | The transport, token lifecycle, rate limits, adding a backend |
| [`specs/content-model-architecture.md`](specs/content-model-architecture.md) | Config, fields, parse/save, untouched preservation, widgets |
| [`specs/media-architecture.md`](specs/media-architecture.md) | Bijection, upload guards, references, trash, budgets |
| [`specs/test-harness-architecture.md`](specs/test-harness-architecture.md) | FakeGithub, fixtures, e2e seams, CI guards |
| [`plans/phase-7-publish.md`](plans/phase-7-publish.md) | Release policy, publish blockers, yve cutover |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | Branching, commits, how to add a widget or backend |

Each spec ends with the decisions and testable claims for its subsystem, so an `ADR-xxxx` or
`INV-xxxx` comment in the source resolves to exactly one place.

## Development

```bash
pnpm install --frozen-lockfile   # CI-parity install
pnpm -r typecheck                # per-package tsc -b
pnpm run check                   # biome lint + format, warnings are errors
pnpm -r test                     # vitest across workspaces
pnpm e2e                         # Playwright vs the built playground on :4173
pnpm -r build                    # tsup (core) and vite (admin, playground)
pnpm fixtures:check              # verify byte-pinned fixtures
pnpm run scan:prod-purity        # no sourcemaps, MSW, or telemetry in the admin build
```

The playground under `playground/` runs a fake GitHub in the browser, so the full editing loop works
offline. `pnpm -C playground dev` starts it.

Node ≥ 22.12 and pnpm via corepack. CI runs the same gates on every push and pull request.

## License

MIT. See [`LICENSE`](LICENSE).
