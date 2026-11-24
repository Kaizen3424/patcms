# patcms

**Start here.** This folder is the durable description of how the shipped code behaves: one anchor
for orientation, one deep-dive per subsystem. Read the map below first, then open the single
deep-dive for the area you are touching. If something needs more than a screen to explain, it
belongs in a deep-dive, not here.

> **One spec layer, one plan.** Each deep-dive ends with the decisions and testable claims for its
> own subsystem, so the `ADR-xxxx` and `INV-xxxx` identifiers cited throughout the source resolve
> here (§8). Work that is still in flight lives in `plans/` when a plan is active; never more than
> one at a time. Code beats every document; when they disagree, fix the document in the same change
> (see `AGENTS.md`).

---

## Where to look

| File | Read it when you touch |
|---|---|
| [`content-model.md`](content-model.md) | config, fields, parsing, serialisation, editor widgets |
| [`saving-content.md`](saving-content.md) | saves, history and restore, conflicts, drafts, boot recovery, leases, deploy status |
| [`backend-and-auth.md`](backend-and-auth.md) | the transport, auth/token lifecycle, rate limits, or a new backend |
| [`media.md`](media.md) | uploads, previews, references, trash/restore, budgets |
| [`testing.md`](testing.md) | playground, fixtures, test doubles, CI guard scripts |
| [`npm-release.md`](npm-release.md) | npm publishing, the trusted publisher, version PRs, tags and GitHub Releases |

Deep-dives end with their subsystem's "Decisions and claims" — the owning tables for every
`ADR-xxxx` and `INV-xxxx` (indexed in §8). Release work starts at `npm-release.md`.

## 1. What this is

`patcms` is a headless, git-backed CMS SDK. Content is plain JSON committed to a GitHub repository;
the browser (or Node) talks **directly to `api.github.com`** with a fine-grained personal access
token. The package manages only the backend; the host builds its own admin panel on top of the
client.

| It is | It is not |
|---|---|
| `patcms` — headless TypeScript SDK; `createCMS()` is the product | A backend service, proxy, or API server |
| Three entries: `patcms`, `patcms/advanced`, `patcms/web` | A bundled admin UI or a hosted product |
| Content as files in the user's own repo, versioned by git | A database, object store, or document API |
| One fine-grained PAT | User accounts, roles, teams, OAuth |
| A dev harness that speaks the real API shape | Mocked business logic |

The example panel (`playground/src/panel`) is the **reference consumer**: a small React app proving
`createCMS()` is sufficient to build a working admin. It is a dev-harness artifact, not part of the
package — nothing in `packages/core` may import from it. The former `packages/admin` reference SPA
was deleted at P2 parity (git history keeps it).

Consequences worth internalising:

- There are **no roles and no authorization layer**. Access is whatever the GitHub repo/branch
  permissions grant the token.
- There are **no jobs, queues, cron tasks, or webhooks** in this repo. The only scheduled work is
  GitHub Actions CI.
- There is **no deploy pipeline.** CI (`.github/workflows/ci.yml`) runs gates and a bun consumer
  smoke on push/PR to `main` plus a weekly audit; it publishes nothing. Deployment is deferred and
  not yet decided — do not document a pipeline that does not exist.

## 2. Stack and commands

| Concern | Choice |
|---|---|
| Workspace | pnpm 10.34.9 (corepack), Node ≥ 22.12, ESM only, TS project references |
| Panel + harness | React 19, Vite, plain CSS (the example panel and its MSW fake live in `playground`) |
| Core deps | `zod`, `idb-keyval` — nothing DOM-shaped in the main entry |
| Build | `tsup` (core JS) + `tsc -b` (core d.ts → `dist-types`; `tsup` has `dts: false` — packing without a typecheck ships types pointing at nothing), `vite` (playground) |
| Tests | Vitest, plus `fast-check` property tests in core |
| Lint / format | Biome with `--error-on-warnings` |
| Release | changesets; `.github/workflows/release.yml` publishes via npm trusted publishing (OIDC, no `NPM_TOKEN`), tags `v<version>`, and creates the GitHub Release from the changeset notes — runbook in `npm-release.md` |
| CI actions | SHA-pinned, job-level `contents: read`, no `pull_request_target`; the release job alone may hold `contents: write` + `id-token: write` (enforced by `scripts/ci-workflow-guard.mjs`) |

| Purpose | Command |
|---|---|
| Install (CI parity) | `pnpm install --frozen-lockfile` |
| Typecheck all | `pnpm -r typecheck` (root `pnpm typecheck` = `tsc -b`) |
| Lint + format check | `pnpm run check` |
| Unit tests | `pnpm -r test` |
| One test file | `pnpm --filter patcms test -- <file>` |
| Build all | `pnpm -r build` |
| Tarball hygiene | `pnpm run pack:check` |
| Bun consumer smoke | `pnpm run bun:smoke` (needs `bun` on PATH; packs the tarball, `bun add`s it, imports + typechecks) |
| Docs snippets + links | `pnpm run docs:check` (needs `pnpm -r build` first) |
| Fixture integrity | `pnpm fixtures:check` |
| Guard rails | `pnpm run scan:workflows` · `audit:waivers` |

`pnpm changeset status` is the non-interactive sanity check for release notes.

> Commands are duplicated in `README.md`, root `package.json`, and here. **Change all three
> together.**

## 3. Package surface and folder map

The published package has three entries, split by runtime safety:

| Entry | Contents | Rules |
|---|---|---|
| `patcms` | `createCMS()`, the client vocabulary, config, fields | Node-safe: no DOM globals, never imports `web/` |
| `patcms/advanced` | Everything else Node-safe: backends, save pipeline, serialization, safety, media internals | For hosts that outgrow the client; no test doubles ever |
| `patcms/web` | Browser-only adapters: IndexedDB draft store, token stores | The only entry that touches DOM globals |

| Path | Owns |
|---|---|
| `packages/core/src/client` | `createCMS()` and the public client vocabulary (`Entry`, `SaveResult`, `CMS`) |
| `packages/core/src/config` | `defineConfig` / `defineCollection` / `defineFiles`, `toAdminConfig`, strict `AdminConfig` schema |
| `packages/core/src/fields` | The 12 field factories, lenient `parseEntry`, strict `validateEntryForSave`, untouched merge, default folding |
| `packages/core/src/serialization` | Source-preserving JSON documents and the canonical printer |
| `packages/core/src/backend` | `GitBackend` contract and typed errors |
| `packages/core/src/backends/github` | Real transport: reads, transaction, capability probe |
| `packages/core/src/pipeline` | Save driver/machine, conflict engine, rebase, rate policy, coordinator, boot adjudication, leases |
| `packages/core/src/drafts` | Draft key/payload contract and the memory store |
| `packages/core/src/media` | Public⇄repo bijection, references, trash ladder, budget math |
| `packages/core/src/status` | Deploy-status classifier and watcher (pure; time is injected) |
| `packages/core/src/auth` | `PatProvider`, probe vocabulary, token-store seam |
| `packages/core/src/safety` | Untrusted JSON, path safety, slug derive/slugify, masked logger, encoding |
| `packages/core/src/web` | `patcms/web` — IDB draft store, shared IDB opener, token stores |
| `packages/core/src/__tests__/support` | Test-only doubles: `FakeGithubServer`, fetch harness, fixture backend, contract suite, lease carriers (workspace-only `patcms/test-support` subpath; stripped at publish time) |
| `playground` | MSW FakeGithub harness, fixture repo, yve config, and `src/panel` — the example panel |
| `scripts` | CI guard, tarball check, audit filter, fixture sync |
| `specs` | This orientation layer: the anchor plus six subsystem deep-dives — see the map at the top |

**Node-safety rule:** `patcms` and `patcms/advanced` must not touch `window`, `document`, `Worker`,
or IndexedDB. Browser code lives in `patcms/web` and is imported only by hosts.

## 4. Screens of the example panel

The example panel (`playground/src/panel`) is the reference for what a host must build. It has no
router: navigation is a discriminated union (`PanelView` in `playground/src/panel/types.ts`), and
`App.tsx` renders the signed-out login until `auth` reports `signedIn`.

| View (`PanelView` kind) | Screen file | Notes |
|---|---|---|
| — | `screens/LoginScreen.tsx` | PAT sign-in, "remember" opt-in, session restore |
| `library` | `screens/LibraryScreen.tsx` | Entry list, search, sort, issue/draft badges |
| `new` | `screens/NewEntryScreen.tsx` | Blank or cloned start value |
| `entry` | `screens/EntryScreen.tsx` | `$slug` editing; validate → save → conflict/media banners |
| `media` | `screens/MediaScreen.tsx` | Browse/upload/delete plus a Trash tab for restore |

This repo serves **no endpoints**. The network surface is the subset of the GitHub REST API used by
`GithubBackend`: refs, recursive trees, blobs/contents, tree diffs, commits, check-runs, commit
statuses, rate limit, and repo/branch-protection reads.

## 5. Data model

- **Authoring.** Config is TypeScript with zod: `defineConfig`, `defineCollection` (folder),
  `defineFiles`, and `fields.*` (`packages/core/src/config/document.ts`,
  `packages/core/src/fields/factories.ts`).
- **Projection.** `toAdminConfig()` emits a JSON-safe `AdminConfig`
  (`packages/core/src/config/types.ts`), validated by a strict closed schema
  (`packages/core/src/config/schema.ts`). Zod schemas stay host-side; consumers receive
  descriptors only.
- **Derived read model.** `entries.list()` builds from ONE tree snapshot per head
  (`packages/core/src/client/repo.ts`, `cache.ts`) — no database, no second cache. Reads may reuse
  a head confirmed within `readReuseMs` (default 30 s, `0` disables) and cache bodies by blob sha
  (LRU-bounded); `refresh()` re-checks only the ref. An optional `ContentStore`
  (`packages/core/src/client/content-store.ts`, `packages/core/src/web/idb-content-store.ts`) keeps
  raw text on the device by path + blob sha, so a cold open downloads only moved bodies; without it
  every cold start downloads everything. Sign-out and `clearCache()` wipe it, `destroy()` does not.
  Every write path forces a fresh head before it decides anything, so the window can delay a foreign
  change on screen but never hide it from a save.

Collections come in three kinds — `folder` (one JSON file per entry under `folder`), `files` (named
single documents), and `divider` (a navigation separator, no data) — and fields come in twelve
value types plus one decoration. **The full field table, the collection table, the parse/save split,
and the untouched-preservation rules live in [`content-model.md`](content-model.md)** — the single
source of truth for all of them.

## 6. Auth contract

One GitHub **fine-grained PAT** is the only credential — no roles, no accounts; GitHub repo/branch
permission *is* the authorization model. The token travels in the `Authorization` header only,
lives in memory by default, and is persisted only behind an explicit "remember" opt-in via
`tokenStore` (`patcms/web` ships IndexedDB and sessionStorage stores). **The full lifecycle — probe,
bootstrap, wipe-on-failure, expiry mid-work, token storage — lives in
[`backend-and-auth.md`](backend-and-auth.md).**

- `createCMS({ token })` seeds the client offline; no network call happens until an entry or media
  operation runs. `auth.signIn(token)` runs the capability probe first and throws `CMSError` when
  the token cannot write.
- An auth failure mid-work marks the session expired (`AuthController.markExpired`) and fires
  `onAuthExpired`; the next save fails with `AUTH_REQUIRED` until the host re-signs-in.

## 7. Core flows

1. **Sign in → browse.** `auth.signIn(token)` → probe → `entries.list(collection)` → one tree read
   backs the whole listing; file bodies are fetched lazily by `entries.get`.
2. **Edit → publish.** `drafts.set(...)` before the first network call → `entries.validate` →
   `entries.save(entry, value)` → fresh ref/tree → one commit → ref update → confirm the ref carries
   the commit → draft deleted. On a fresh **empty repository** that same first save bootstraps the
   root commit and branch (ADR-0011); reads before it see no content. A batch (`entries.saveMany` /
   `createMany` / `deleteMany`) is the same
   transaction for N files: one fresh tree, every base sha checked, and **any** stale row writes
   nothing and returns conflicts as values. See `saving-content.md`.
   `entries.history` / `atRevision` / `restore` read that same commit log: a restore re-commits an
   old file's **exact bytes** (never a force, never a rewrite) and binds to `entry.sha` exactly like
   a save. See `saving-content.md`.
3. **Conflict.** Someone pushed first → CAS fails → the client re-reads fresh head and returns
   `{ status: "conflict", current, local }` as a **value**. The host decides what to show; there is
   no default merge. `rebase()` in `patcms/advanced` is available for hosts that want field-level
   merging. Never a silent winner, never `force`.
4. **Recovery.** A host that persists drafts can adjudicate a surviving draft against fresh head with
   `adjudicateDraft` (`patcms/advanced`): `discard`, `offer`, or `conflict`. Boot never writes.
5. **Media.** `media.upload` → name/empty/size/SVG guards → blob → commit → preview via the blob
   API. `media.delete` → reference check → `_trash/` tombstone → `media.restore` with a collision
   guard. (Header sniff and EXIF re-encode were reference-admin workers; they are not SDK features.)
6. **Publish → deploy status.** Watch the commit: check-runs primary, statuses only via configured
   contexts, `unavailable` rather than `failed` when data is missing.

## 8. Standing vetoes and the identifier index

**Vetoes.** These hold everywhere. A change that breaks one is rejected regardless of test results:

- `force: true`, or a force-push performed by any script or workflow.
- Reading `raw.githubusercontent.com`; previews and files come from the git blob API.
- A token in a URL, query string, redirect, or log line.
- `dangerouslySetInnerHTML`, `eval`, `new Function`, or `innerHTML=` anywhere in the repo (core and
  the panel).
- Remote telemetry, analytics, or third-party runtime scripts of any kind.
- `Object.assign` or a deep merge applied to parsed repository JSON.
- A second serializer that bypasses the save path.
- Test doubles exported from any public entry (`patcms`, `patcms/advanced`, `patcms/web`).
- Whole-entry conflict choices in the default client; conflicts are values the host resolves.
- Deleting or skipping a test to turn CI green.

**Identifiers.** Source comments cite `ADR-xxxx` and `INV-xxxx` by bare id, so each one is defined
exactly once, in the deep-dive that owns that subsystem:

| IDs | Defined in |
|---|---|
| ADR-0003 · ADR-0006 · ADR-0009 · INV-S01–S06 · INV-T01–T03 | [`content-model.md`](content-model.md) |
| ADR-0001 · ADR-0002 · ADR-0005 · INV-A01–A05 · INV-N01–N02 · INV-N06 · INV-P01–P03 · INV-P06 · INV-P14 | [`backend-and-auth.md`](backend-and-auth.md) |
| ADR-0004 · ADR-0008 · ADR-0011 · INV-P04–P05 · INV-P07–P13 · INV-P17–P19 · INV-D01–D03 | [`saving-content.md`](saving-content.md) |
| ADR-0007 · INV-M01–M03 · INV-T04 | [`media.md`](media.md) |
| INV-N05 | [`testing.md`](testing.md) |
| ADR-0010 | [`npm-release.md`](npm-release.md) |
| INV-C01 | `playground/src/config/__tests__/inv-c01-parity.test.ts` |

An id missing from this table means the spec is wrong: add the definition to the owning deep-dive and
index it here in the same change.

## 9. Environment variables

There is no committed env file, no `.env.example`, and no build-time env contract. Runtime
configuration is passed to `createCMS()` / `mountPanel` (`playground/src/panel`).

| Name | Used by | Meaning |
|---|---|---|
| `PATCMS_ALLOW_REAL_GITHUB` | `playground/src/main.ts` (via `fake-github/env-guard.ts`) | Must be exactly `"1"` to aim the playground at a real repo (`?owner=…&repo=…&branch=…`); anything else keeps the MSW fake |
| `YVE_REPO` | `scripts/sync-yve-fixtures.mjs` | Path to the yve source checkout (default `../yve_gallery_decap`) |

Never commit a token. `.gitignore` keeps `.env*` out.

## 10. Conventions

- **Commits:** Conventional Commits, `feat|fix|chore|docs|test(scope): …`. Content commits authored by
  the CMS use the machine-checkable `chore(cms):` prefix.
- **No skip tokens:** `[skip ci]`, `[ci skip]`, `[no ci]`, `[skip actions]` are refused before any
  network call (`containsSkipToken`, `packages/core/src/pipeline/commit-message.ts`) — the CMS must
  never silently suppress its own deploy.
- **No human-time estimates** anywhere in docs, issues, or commit messages.
- **Immutability at the seams:** config descriptors, parsed entries, and snapshots are readonly; the
  client cache is internal to `createCMS()`.
- **Copy is host code:** founder-facing strings live in the host's UI (the panel keeps them in its
  screens), never as GitHub prose in the primary path — SDK errors surface as typed codes.
- **Supply chain:** frozen lockfile, `onlyBuiltDependencies` allowlist, waiver-filtered audit,
  SHA-pinned actions — all enforced in CI.
- **New runtime dependency:** its own reviewable change, with an allowlist entry and a stated reason
  if it has install scripts.

