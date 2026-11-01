# MyCMS

**Start here.** One pass over this file is enough to work anywhere in the repo. Then open the single
deep-dive for the area you are touching (§11). If something needs more than a screen to explain, it
belongs in a deep-dive, not here.

> **One spec layer, one plan.** This `specs/` tree is the durable description of how the shipped code
> behaves. Each deep-dive ends with the decisions and testable claims for its own subsystem, so the
> `ADR-xxxx` and `INV-xxxx` identifiers cited throughout the source resolve here (§8). Work that is
> still in flight lives in `plans/`; there is exactly one active plan at a time. Code beats every
> document; when they disagree, fix the document in the same change (see `AGENTS.md`).

---

## 1. What this is

A git-backed CMS with no database. Content is plain JSON committed to a GitHub repository; the admin
is a static SPA that talks **directly to `api.github.com`** with a fine-grained personal access token.

| It is | It is not |
|---|---|
| `@mycms/core` — headless TypeScript SDK, Node-safe main entry | A backend service, proxy, or API server |
| `@mycms/admin` — brandable React 19 SPA that a host mounts | A hosted product, SaaS, or multi-tenant app |
| Content as files in the user's own repo, versioned by git | A database, object store, or document API |
| One fine-grained PAT, browser-only | User accounts, roles, teams, OAuth |
| A dev harness that speaks the real API shape | Mocked business logic |

Consequences worth internalising:

- There are **no roles and no authorization layer** in the app. Access is whatever the GitHub
  repo/branch permissions grant the token.
- There are **no jobs, queues, cron tasks, or webhooks** in this repo. The only scheduled work is
  GitHub Actions CI and the browser-side deploy-status watcher.
- There is **no deploy pipeline.** CI (`.github/workflows/ci.yml`) runs gates on push/PR to `main`
  plus a weekly audit; it publishes nothing. A host integrates by calling
  `mountAdmin(el, {config, support, repository})` from `packages/admin/src/admin/mount.tsx`.
  Deployment is deferred and not yet decided — do not document a pipeline that does not exist.

## 2. Stack and commands

| Concern | Choice |
|---|---|
| Workspace | pnpm 10.34.9 (corepack), Node ≥ 22.12, ESM only, TS project references |
| Admin UI | React 19, Vite, TanStack Router + Query, Tailwind 4, Radix primitives |
| Core deps | `zod`, `idb-keyval` — nothing DOM-shaped in the main entry |
| Build | `tsup` (core), `vite` (admin, playground) |
| Unit tests | Vitest, plus `fast-check` property tests in core |
| E2E | Playwright, chromium only, against the playground *build* |
| Lint / format | Biome with `--error-on-warnings` |
| Release | changesets |
| CI actions | SHA-pinned, job-level `contents: read`, no `pull_request_target` |

| Purpose | Command |
|---|---|
| Install (CI parity) | `pnpm install --frozen-lockfile` |
| Typecheck all | `pnpm -r typecheck` (root `pnpm typecheck` = `tsc -b`) |
| Lint + format check | `pnpm run check` |
| Unit tests | `pnpm -r test` |
| One test file | `pnpm --filter @mycms/core test -- <file>` |
| E2E | `pnpm e2e` (builds and previews playground on :4173) |
| Build all | `pnpm -r build` |
| Fixture integrity | `pnpm fixtures:check` · `pnpm fixtures:tape-check` |
| Guard rails | `pnpm run scan:workflows` · `scan:prod-purity` · `audit:waivers` |

`pnpm changeset status` is the non-interactive sanity check for release notes.

> Commands are duplicated in `AGENTS.md`, `README.md`, root `package.json`, and here. **Change all
> four together.**

## 3. Folder map

| Path | Owns |
|---|---|
| `packages/core/src/config` | `defineConfig` / `defineCollection` / `defineFiles`, `toAdminConfig`, strict `AdminConfig` schema |
| `packages/core/src/fields` | The 12 field factories, lenient `parseEntry`, strict `validateEntryForSave`, untouched merge |
| `packages/core/src/serialization` | Source-preserving JSON documents and the canonical printer |
| `packages/core/src/backend` | `GitBackend` contract, typed errors, contract suite, `FakeGithubServer` reference model |
| `packages/core/src/backends/github` | Real transport: reads, transaction, capability probe |
| `packages/core/src/pipeline` | Save machine, driver, coordinator, rebase, boot adjudication, rate policy, commit-message law |
| `packages/core/src/drafts` | Draft key and payload contract (implementation is browser-side) |
| `packages/core/src/media` | Public⇄repo bijection, references, trash ladder, budget math |
| `packages/core/src/status` | Deploy-status classifier and watcher (pure; time is injected) |
| `packages/core/src/auth` | `PatProvider`, probe vocabulary, token-store seam |
| `packages/core/src/safety` | Untrusted JSON, path safety, slug derivation, masked logger, encoding |
| `packages/core/src/web` | Browser-only adapters (IDB stores, carriers). Import via `@mycms/core/web` |
| `packages/admin/src/admin` | `mountAdmin`, router, host option types |
| `packages/admin/src/runtime` | Runtime composition, entry index, blob cache, media helpers |
| `packages/admin/src/screens` | The six screens |
| `packages/admin/src/editor` | Entry editor, save-bar model, conflict freeze, copy deck, template cloning |
| `packages/admin/src/widgets` | Widget registry (`createWidgetRegistry`, `WIDGETS`) |
| `packages/admin/src/workers` | Raster normalisation worker, header sniffer |
| `packages/admin/src/status` | Status provider/registry, chips, heartbeat |
| `playground` | MSW FakeGithub, fixture repo, e2e seams |
| `e2e` | Playwright journeys and support helpers |
| `scripts` | CI guard, prod-purity scan, audit filter, fixture sync/capture |
| `specs` | This orientation layer: the anchor plus five subsystem deep-dives |
| `plans` | The single active delivery plan (`phase-7-publish.md`) and its release policy |

**Node-safety rule:** `@mycms/core` must not touch `window`, `document`, `Worker`, or IndexedDB.
Browser code lives in `web/` and is imported only by hosts.

## 4. Route and endpoint map

Every route below sits behind the same gate in `packages/admin/src/admin/routes.tsx` (`RootLayout`):
`loading` renders the boot screen, anything other than `signedIn` renders `LoginScreen`. There are no
public pages and no per-route permissions.

| Route | Screen | Notes |
|---|---|---|
| `/` | `IndexRedirect` | Redirects to the first non-divider collection; empty state if none |
| `/c/$collection` | `LibraryScreen` | Entry list, search, groups, advisory issue counts |
| `/c/$collection/new` | `NewEntryScreen` | `?from=<slug>` clones an existing entry as a template |
| `/c/$collection/e/$entry` | `EntryScreen` | `$entry` is the entry **slug** |
| `/media` | `MediaLibraryScreen` | Browse, replace, delete |
| `/trash` | `RecentlyDeletedScreen` | Restore soft-deleted media |

This repo serves **no endpoints**. The network surface is the subset of the GitHub REST API used by
`GithubBackend`: refs, recursive trees, blobs/contents, tree diffs, commits, check-runs, commit
statuses, rate limit, and repo/branch-protection reads.

## 5. Data model

- **Authoring.** Config is TypeScript with zod: `defineConfig`, `defineCollection` (folder),
  `defineFiles`, and `fields.*` (`packages/core/src/config/document.ts`,
  `packages/core/src/fields/factories.ts`).
- **Projection.** `toAdminConfig()` emits a JSON-safe `AdminConfig`
  (`packages/core/src/config/types.ts`), validated by a strict closed schema
  (`packages/core/src/config/schema.ts`). Zod schemas stay host-side; the browser receives
  descriptors only.
- **Derived read model.** The library index is built from ONE tree snapshot per load
  (`loadEntryIndex` in `packages/admin/src/runtime/entry-index.ts`) — no database, no second cache.

| Collection kind | Entry identity | Content |
|---|---|---|
| `folder` | slug derived from the filename | one JSON file per entry under `folder` |
| `files` | `files[].name` | named single documents |
| `divider` | none | nothing — a navigation separator |

| Field type | Value | Notes |
|---|---|---|
| `string` | string | optional `format: email/url`, length/pattern constraints |
| `text` | string | long form |
| `number` | number | min/max/step |
| `boolean` | boolean | |
| `select` | string or string[] | single or multi |
| `datetime` | ISO string | |
| `list` | array | item schema plus min/max |
| `object` | object | nested field set |
| `image` | public path string | validated against the media bijection |
| `relation` | slug or slugs | checked against the entry index |
| `hidden` | unknown | preserved, never shown |
| `slug` | string | **virtual** — derived from the filename, never persisted |
| `divider` | — | decoration declaration only, not a value |

- **Round-trip law.** Untouched documents return their original bytes; `serialize(parse(raw)) === raw`
  is enforced. Unmodeled keys survive saves as `untouched` JSON-pointer values.
- **Defaults are metadata.** `parseEntry` never injects a default; only new-entry folding
  materialises them.

> Field types appear in `fields/types.ts` (`FieldTypeName`), `fields/factories.ts`, the config schema,
> the widget registry, and this table. **Change all five together.**

## 6. Auth contract

| Property | Value |
|---|---|
| Credential | One GitHub **fine-grained PAT** |
| Scopes | `Contents: read+write`, `Checks: read`, optional `Administration: read` |
| Lifetime in memory | From a successful capability probe until sign-out or an auth failure |
| Persistence | Opt-in "Remember on this device" → IndexedDB `mycms` / `auth`; `sessionStorage` fallback |
| Transport | `Authorization` header only — never a URL, log line, or UI state |
| Roles | None. GitHub repo/branch permission *is* the authorization model |

- Login runs `probeGithubCapabilities` (`packages/core/src/backend/github/probe.ts`): rate limit,
  repo read, branch-protection admin, check-runs read (advisory — a private repo may legitimately
  forbid it).
- Bootstrap restores the token, re-probes, and **wipes it on failure** before showing the login card
  (`PatProvider`, `packages/core/src/auth/pat-provider.ts`).
- An auth failure mid-work pauses saves and keeps drafts; `resumeAuth()` continues
  (`packages/core/src/pipeline/save-controller.ts`).

## 7. Core flows

1. **Sign in → browse.** Paste access key → probe → tree read → `loadEntryIndex` → library. One tree
   read backs the whole library; file bodies are fetched lazily.
2. **Edit → publish.** Edit → draft written before the first network call → strict validation →
   compose bytes from value plus `untouched` → fresh ref/tree → one commit → ref update → confirm the
   ref carries the commit → delete the draft. See `workflows/publish-and-recovery.md`.
3. **Conflict.** Someone pushed first → CAS fails → fresh challenge reads → field-granular rebase →
   freeze contested nodes → decide every row → save. Never a silent winner, never `force`.
4. **Recovery.** Reload or crash with a surviving draft → boot adjudicates it against fresh head:
   `discard`, `offer`, or `conflict`. Boot never writes.
5. **Media.** Upload → header sniff plus worker re-encode → commit → preview via the blob API.
   Delete → reference check → `_trash/` tombstone → restore with a collision guard.
6. **Publish → deploy status.** Watch the commit: check-runs primary, statuses only via configured
   contexts, `unavailable` rather than `failed` when data is missing.

## 8. Standing vetoes and the identifier index

**Vetoes.** These hold everywhere. A change that breaks one is rejected regardless of test results:

- `force: true`, or a force-push performed by any script or workflow.
- Reading `raw.githubusercontent.com`; previews and files come from the git blob API.
- A token in a URL, query string, redirect, or log line.
- `dangerouslySetInnerHTML`, `eval`, `new Function`, or `innerHTML=` anywhere in the admin.
- Remote telemetry, analytics, or third-party runtime scripts of any kind.
- `Object.assign` or a deep merge applied to parsed repository JSON.
- A second serializer that bypasses the save path.
- `backend`, credentials, or raw transport access inside `WidgetProps`.
- Whole-entry conflict choices; freezing is field-granular at the minimal common node.
- Blocking one entry's save because an unrelated file fails validation (advisory-chip rule).
- Editing `/admin-legacy`; it is the rollback path.
- Deleting or skipping a test to turn CI green.

**Identifiers.** Source comments cite `ADR-xxxx` and `INV-xxxx` by bare id, so each one is defined
exactly once, in the deep-dive that owns that subsystem:

| IDs | Defined in |
|---|---|
| ADR-0003 · ADR-0006 · ADR-0009 · INV-S01–S06 · INV-T01–T03 | `content-model-architecture.md` |
| ADR-0001 · ADR-0002 · ADR-0005 · INV-A01–A05 · INV-N01–N02 · INV-P01–P03 · INV-P06 · INV-P14 | `backend-and-auth-architecture.md` |
| ADR-0004 · ADR-0008 · INV-P04–P05 · INV-P07–P13 · INV-P15–P17 · INV-D01–D03 | `workflows/publish-and-recovery.md` |
| ADR-0007 · INV-M01–M03 · INV-N03 · INV-T04–T05 | `media-architecture.md` |
| INV-N04–N05 | `test-harness-architecture.md` |
| ADR-0010 · INV-C01–C04 | `plans/phase-7-publish.md` |

An id missing from this table means the spec is wrong: add the definition to the owning deep-dive and
index it here in the same change.

## 9. Environment variables

There is no committed env file, no `.env.example`, and no build-time env contract. Runtime
configuration is passed to `mountAdmin`.

| Name | Used by | Meaning |
|---|---|---|
| `MYCMS_ALLOW_REAL_GITHUB` | `playground/src/fake-github/env-guard.ts` | Must be exactly `"1"` to aim the harness at a real repo; anything else refuses |
| `YVE_REPO` | `scripts/sync-yve-fixtures.mjs` | Path to the yve source checkout (default `../yve_gallery_decap`) |
| `CI` | `e2e/playwright.config.ts` | Enables one retry and disables preview-server reuse |
| `MYCMS_RECORD_OWNER` / `_REPO` / `_BRANCH` / `_TOKEN` | `scripts/capture-recorded-fixtures.mjs` | Target for recording the GitHub contract tape; falls back to `GITHUB_OWNER` / `GITHUB_REPO` / `GITHUB_BRANCH` / `GITHUB_TOKEN` |

Never commit a token. `.gitignore` keeps `.env*` out.

## 10. Conventions

- **Commits:** Conventional Commits, `feat|fix|chore|docs|test(scope): …`. Content commits authored by
  the CMS use the machine-checkable `chore(cms):` prefix.
- **No skip tokens:** `[skip ci]`, `[ci skip]`, `[no ci]`, `[skip actions]` are refused before any
  network call (`containsSkipToken`, `packages/core/src/pipeline/commit-message.ts`) — the CMS must
  never silently suppress its own deploy.
- **No human-time estimates** anywhere in docs, issues, or commit messages.
- **Immutability at the seams:** config descriptors, parsed entries, and snapshots are readonly; the
  UI cache is React Query only.
- **Copy is data:** founder-facing strings live in a copy deck
  (`packages/admin/src/editor/copy.ts`), never inline, and avoid token jargon in the primary path.
- **Supply chain:** frozen lockfile, `onlyBuiltDependencies` allowlist, waiver-filtered audit,
  SHA-pinned actions — all enforced in CI.
- **New runtime dependency:** its own reviewable change, with an allowlist entry and a stated reason
  if it has install scripts.

> Media limits are duplicated in `packages/core/src/media/budget.ts` (volume) and
> `packages/admin/src/workers/header-sniffer.ts` (per file). **Change all three places together** with
> this document.

## 11. Deep dives

| File | Read it when you touch |
|---|---|
| `workflows/publish-and-recovery.md` | saves, conflicts, drafts, boot recovery, leases, deploy status |
| `backend-and-auth-architecture.md` | the transport, auth/token lifecycle, rate limits, or a new backend |
| `content-model-architecture.md` | config, fields, parsing, serialisation, editor widgets |
| `media-architecture.md` | uploads, previews, references, trash/restore, budgets |
| `test-harness-architecture.md` | playground, fixtures, e2e, CI guard scripts |

The current delivery plan is `plans/phase-7-publish.md`. It owns release policy (ADR-0010) and the
yve cutover checklist (INV-C01–C04), which are not claims about code inside `packages/`.
