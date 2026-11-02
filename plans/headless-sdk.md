# Refocus: `patcms` headless SDK

> Single active plan. The durable description of the code is `specs/CMS.md`; this file is the one
> delivery plan. It supersedes `plans/phase-7-publish.md` (git history keeps that file); ADR-0010's
> release policy is restated here where it still binds, and the yve appendix is kept because
> `playground/src/config/__tests__/inv-c01-parity.test.ts` cites it.

## Goal

Ship `patcms` — a lightweight, headless, git-backed CMS SDK. The package manages **only the
backend**: JSON content in a GitHub repo, edited through the GitHub API with a PAT. A high-level
`createCMS()` client is the product; the host builds its own admin panel with it. No database, no
auth server, no bundled UI.

Done means: the tarball installs clean in a scratch project, all three entries resolve, the example
panel proves `createCMS()` is sufficient to build a working admin, and `packages/admin` is deleted.

## Decisions already made

| Decision | Consequence |
|---|---|
| Published package is `patcms` (unscoped); the frozen reference admin is `@patcms/admin`, private | Rename is done across manifests, imports, and docs headers |
| `createCMS()` is the primary API; low-level primitives live under `patcms/advanced` | `patcms` main entry stays Node-safe; `patcms/web` is the only DOM-touching entry |
| JSON-only v1 | Markdown/MDX is out of scope until a real demand exists |
| Keep the correctness primitives: `GithubBackend`, `runSave`, CAS, byte-preserving serialization, untouched preservation, validation, token lifecycle, path/URL safety, media reference checks | These are the product; the admin UX around them is not |
| Remove admin/UX complexity from the published surface: save coordinator, leases, boot adjudication, conflict-freeze UI, onboarding/journal/diagnostics, admin-only IDB stores | They stay in `packages/admin/src` (frozen) until the example panel reaches parity, then die with it |
| Conflicts return `{ status: "conflict", current, local }` as a value | No field-level merge in the default path; `rebase()` stays in `advanced` for hosts that want it |
| Drafts are optional persistence with a memory default; IDB via `patcms/web` | A host that never imports `patcms/web` gets zero DOM code |
| Test doubles live in `packages/core/src/__tests__/support/`, never in the public surface | `FakeGithubServer`, the fetch harness, the fixture backend, and the contract suite are test-only |
| No `@patcms/testing` package | The contract suite is an admission gate inside the repo, not a shipped artifact |
| Playwright `e2e` and `scripts/capture-recorded-fixtures.mjs` are deleted | The recorded tape stays as a static JSON fixture for replay tests |

## Current truth

| Area | State |
|---|---|
| Rename | `@patcms/core` → `patcms`, `@patcms/admin` → `@patcms/admin`, root → `patcms`. Done; lockfile regenerated. |
| Client | `packages/core/src/client/` complete: errors, events, cache, repo, auth, entries, media, drafts, `createCMS()`. 13 client tests green. |
| Surface split | `patcms` (slim, Node-safe), `patcms/advanced` (low-level), `patcms/web` (draft + token stores only). Build green: index 47.75 KB, advanced 91.53 KB, shared 136.08 KB, web 18.89 KB. |
| Fakes | Moved to `src/__tests__/support/`; `advanced.ts` no longer exports them; 30+ test files rewired; playground has its own dev-only copy at `playground/src/fake-github/server.ts`. |
| e2e | `e2e/` package, capture script, and their scripts deleted; workspace, root tsconfig, and CI updated. |
| `patcms/web` | Shrunk to draft store + token stores; journal/onboarding/discard/expiry stores and lease carriers moved to `packages/admin/src/storage/`. `PATCMS_IDB_STORES` is now `["auth", "drafts"]`. |
| Defaults | `foldFieldDefaults`/`createBlankEntryValue` ported from the reference admin; 13 tests green; doc comment now matches code (optional lists with no value stay absent). |
| Slugify | Added to `packages/core/src/safety/slug.ts`; accent folding, punctuation collapse, and the `"entry"` fallback are tested. |
| Tarball | `scripts/check-tarball.mjs` green: no `src/`/tests/fixtures/`.map`/msw, dist-types present, all three entries resolve through publishConfig wiring. Wired into CI. |
| Tests | core 68 files / 537 tests, admin 37 / 238, playground 4 / 14 — all green. |
| Specs | Updated this session for `patcms`, `patcms/advanced`, the shrunk `patcms/web`, `src/__tests__/support` fakes, the deleted e2e suite, moved admin stores, and the `createCMS()` client. |
| README | Root README rewritten for the headless story; `packages/core/README.md` written (ships in the tarball). Snippets match the real factory signatures but are not yet typechecked against the tarball. |
| Example panel | Complete (`playground/src/panel`): full loop validated against the fake and the real repo `Kaizen3424/cms_test`; parity review passed; `packages/admin` deleted at cutover. |

## Phases

### P1 — Documentation truth — done

1. Rewrite this plan (done by definition).
2. Update the six specs for: package names, `patcms/advanced`, the shrunk `patcms/web`, the
   `src/__tests__/support` home of the fakes, the deleted e2e suite, the moved admin stores, and the
   `createCMS()` client. Follow the AGENTS.md trigger table; fix the spec and the code in the same
   change wherever they disagree. **Done.**
3. Write `packages/core/README.md` (install, the three entries, a `createCMS()` quickstart, PAT
   scopes, JSON-only note) and refresh the root README to match the headless story. **Done; snippet
   typecheck against the tarball still open.**

### P2 — Example panel

Build `examples/panel` (or `playground` repurposed — decide when starting): a small Vite app that
uses only `patcms` (+ `patcms/web` for IDB drafts) to list entries, edit and save one, handle the
conflict value, upload and reference media, and sign in with a PAT. No `patcms/advanced` imports.

- Gate: the example runs against the playground's fake GitHub and against a real repo. **Passed
  2026-11-01** — fake: full smoke (sign-in, library, all 12 field types, save, conflict demo,
  drafts, media ladder, console clean); real: loop commits `8edce67`/`737c612`/`b4958ee`/`df21f8e`
  + cleanup, end tree pristine.
- Gate: feature parity review against `packages/admin` for the *kept* features only; everything on
  the removed list stays removed. **Passed 2026-11-01**:

  | Kept feature | Admin (reference) | Panel | Evidence |
  |---|---|---|---|
  | Sign-in / token lifecycle | login screen, re-auth sheet | LoginScreen (remember, restore, sign-out) | live, fake + real |
  | Library: summaries, sort, search, badges | library screen | LibraryScreen | live, fake + real |
  | Editor, all 12 field types | 12 widget files | widgets/ (ScalarInput covers scalars) | live, fake + real |
  | Save + untouched preservation | save flow | EntryScreen save → commit banner | real diff: only `excerpt` changed |
  | Conflict value render + per-field pick | conflict-freeze UI (removed) | lib/conflict.ts per-field table | real `737c612`→`b4958ee` |
  | Media list/upload/delete/restore | media-library + recently-deleted | MediaScreen with Trash tab | real `df21f8e` + ladder |
  | Media reference guard | admin | referenced-by banner with fieldPath | live, fake + real |
  | Drafts (IDB, `patcms/web`) | drafts + journal (journal removed) | lib/draft.ts + IDB stores | draft banner live |
  | Validation issues rendered | admin | `entries.validate` → issues in EntryScreen | fake run |
  | Deploy status (check-runs) | status/ | out of scope for the panel; SDK keeps `readCheckRuns` | plan decision |
  | Onboarding, journal, diagnostics, leases, boot adjudication, save coordinator, admin-only IDB stores, i18n | present | **stays removed** — not panel features | plan Decisions |

- Then delete `packages/admin`, its tests, and the playground's dependency on it. The playground
  either becomes the example or is deleted with it — one artifact, not two. **Pending owner
  confirmation.**

### P3 — Publish machinery — done 2026-11-02 (first publish awaits owner npm config)

1. Changesets: `.changeset/` was already restored at the cutover (two changesets, rewritten for
   `patcms` only); added `headless-client.md` — the `createCMS()` client and surface split had no
   changeset. The version field moved `0.1.0` → `0.0.0` so the pending minors compute the first
   release: `changeset status --verbose` lists `patcms -> 0.1.0` (playground takes the dependent
   patch bump, `privatePackages.version: true` per the P0.9 decision).
2. Release workflow `.github/workflows/release.yml` (push to main + workflow_dispatch): the
   changesets action (v2.1.2, SHA-pinned) opens the Version Packages PR, or — when none are
   pending — publishes with `pnpm -r publish --no-git-checks --report-summary` through npm
   trusted publishing (OIDC; `id-token: write`; no `NPM_TOKEN` anywhere). pnpm, not
   `changeset publish`: pnpm rewrites the `catalog:` protocol at pack time (npm would ship it
   literally) and publishes only versions missing from the registry. The post-publish step
   (`scripts/create-github-release.mjs`) reads the publish summary, tags `v<version>`, and
   creates the GitHub Release from the changeset-generated changelog section.
3. `pnpm run pack:check` in CI — already wired.
4. The `v0.1.0` tag and GitHub Release are created by the workflow at publish time — tagging
   now would pin a commit whose version field is still `0.0.0`. Owner steps before the first
   publish: on npmjs.com, configure the trusted publisher (user `Kaizen3424`, repo `patcms`,
   workflow filename `release.yml` — a fresh configuration must complete its first publish
   within 2 days), and enable "Allow GitHub Actions to create and approve pull requests" in the
   repo's Actions settings.

### P2.5 — Consumer documentation and agent skill — done 2026-11-02

Owner-requested between P2 and P3: a `docs/` folder for human developers and an AI-agent skill at
`.agents/skills/patcms/`, both covering every feature of the package.

- `docs/` — 15 task-oriented pages (index, getting-started, configuration, reading, writing,
  conflicts-and-drafts, media, authentication, deploy-status, errors, advanced, web-stores,
  building-an-admin, testing, pitfalls). Docs answer "how"; specs keep "why"; snippets use only
  real signatures.
- `.agents/skills/patcms/` — `SKILL.md` (vetoes first, decision tree into references) plus five
  references (`api`, `configuration`, `workflows`, `pitfalls`, `testing`) and a committed
  `eval/eval_set.json` (10 should-trigger + 10 near-miss should-not-trigger queries).
- `pnpm run docs:check` (`scripts/check-docs-snippets.mjs`) — typechecks every ```ts snippet in
  `docs/`, both READMEs, and the skill references against `packages/core/dist-types` (the published
  surface), and verifies relative links. Wired into CI after `build`. This closed the open
  "README snippet typecheck against the tarball" item and publish blocker #9.
- Fence contract (documented in `docs/README.md`): `ts file="x.ts"` registers an importable module,
  plain `ts` is a standalone module, `ts continue` appends.
- Skill validated with `skill_validate`; trigger eval pending (the eval harness spawns many
  OpenCode workers and twice crashed the dev server mid-run — rerun with fewer workers).
- Gates green: frozen-lockfile, typecheck, check, tests (core 538 / playground 38), build,
  `pack:check`, `scan:workflows`, `docs:check` (66 modules, 78 links).

## Publish blockers

| # | Blocker | State |
|---|---|---|
| 1 | Exports point at source in the workspace | Resolved: `publishConfig` maps the published tarball to `dist` + `dist-types`; workspace keeps source `exports`. `pack:check` proves the published wiring. |
| 2 | Declarations in the artifact | Resolved: `tsc -b` writes `dist-types`; tsup stays `dts: false`. |
| 3 | `./web` as a build entry | Resolved: three tsup entries. |
| 4 | Changesets | Resolved (2026-11-02): `.changeset/` restored at the cutover; `headless-client.md` added; the three pending minors compute 0.1.0 (`changeset status --verbose`). |
| 5 | Version | Amended (2026-11-02): 0.1.0 is the first release; the version field sits at `0.0.0` until the Version Packages PR lands, so changesets computes 0.1.0 instead of bumping past it. |
| 6 | Name and scope | Resolved: `patcms` everywhere. |
| 7 | Release workflow | Resolved (2026-11-02): `.github/workflows/release.yml` — changesets action v2.1.2, `pnpm -r publish` over OIDC trusted publishing, `v<version>` tag + GitHub Release with changeset notes. First real run awaits the npm-side trusted-publisher configuration (owner step, P3 section). |
| 8 | Tarball hygiene | Resolved: `scripts/check-tarball.mjs`, wired into CI. |
| 9 | README on the package page | Resolved (2026-11-02): `packages/core/README.md` is complete and its snippets typecheck against the published types via `pnpm run docs:check` (CI step after build). |
| 10 | Example panel proves the SDK | Resolved (P2, 2026-11-01): the panel runs the full loop against the fake and a real repo; `packages/admin` is deleted. |

## Acceptance checklist

Tick an item only with command output or a named manual check.

- [x] `pnpm install --frozen-lockfile`, `pnpm -r typecheck`, `pnpm run check`, `pnpm -r test` green
  (2026-11-01: core 539 / admin 238 / playground 38, all green after INV-N06)
- [x] `pnpm -r build` and `pnpm run scan:prod-purity` green
- [x] `pnpm run pack:check` green
- [x] `pnpm changeset status` lists exactly 0.1.0 (2026-11-02: `changeset status --verbose` →
      "minor - patcms -> 0.1.0"; the playground patch is the dependent bump from
      `privatePackages.version: true`)
- [x] Specs match the code: no `mycms`/`@mycms` references remain anywhere (2026-11-02: the
      `fixture@patcms.invalid` git identity in `backend/git-sha.ts` — originally
      `fixture@mycms.invalid`; SHA-pinning, not naming — was renamed with the identifier purge and
      the fixtures re-synced),
      `patcms/advanced` and the
      shrunk `patcms/web` described, e2e gone, fakes documented as test-only
- [x] `packages/core/README.md` exists; its snippets use the real factory signatures (snippet
      typecheck against the tarball still open)
- [x] Example panel runs the full loop (sign in → list → edit → save → conflict → media) with zero
      `patcms/advanced` imports — validated against the fake (playground) AND the real repo
      `Kaizen3424/cms_test@main` (2026-11-01): save `8edce67` with untouched keys byte-identical,
      conflict `737c612`→`b4958ee` resolved per field, media upload `df21f8e` + full
      delete→trash→restore ladder, tree restored to pristine (original blob shas verified)
- [x] `packages/admin` deleted; nothing in the repo imports it (2026-11-01: typecheck, check, tests
      core 538 / playground 38, build, `pack:check` all green after deletion; catalog pruned of the
      18 admin-only pins; `scan:prod-purity` and its script retired with it)
- [ ] Release workflow publishes through OIDC; no `NPM_TOKEN` secret exists anywhere
      (2026-11-02: workflow written and guard-approved; `git grep -il NPM_TOKEN` over
      yml/yaml/json/mjs/ts finds nothing; the publish itself awaits the owner's npm
      trusted-publisher configuration)
- [ ] `v0.1.0` tagged and the GitHub Release carries the changeset notes (the workflow would create
      both at publish time, but the first publish was done locally by the owner — CI has no
      credentials by law — so the owner creates the tag + Release via the web UI; notes source:
      `packages/core/CHANGELOG.md`)

## Gotchas

| Gotcha | Why it bites |
|---|---|
| Source exports hide the packaging bug | Everything works in the monorepo because pnpm resolves `src`. Only the tarball check proves the artifact — keep `pack:check` in CI. |
| `patcms` must stay Node-safe | If `src/index.ts` ever re-exports `web/`, the published main entry ships DOM code and breaks SSR imports. `pack:check`'s probe imports `patcms` under Node — keep it that way. |
| `publishConfig` is applied at publish time, not pack time | The tarball as packed still carries source `exports`; `check-tarball.mjs` applies the transform manually before probing. If publishConfig and exports drift, the check lies. |
| The playground must never enter the tarball | `files` is the allowlist; it lists `dist`, `dist-types`, `README.md` only. |
| Test doubles are one `export *` away from public | `advanced.ts` must never re-export `src/__tests__/support/*`. The repo-bans scan and `pack:check` both guard this; treat a new fake as test-only by default. |
| `save` composes untouched from the entry, not the validation result | `validation.untouched` only reflects the incoming modeled value; using it drops preserved unknown fields. |
| Admin store moves changed the IDB schema owner | `PATCMS_IDB_STORES` is `["auth", "drafts"]`; the admin's journal/onboarding/discard stores open their own databases via `patcms/web`'s `createSharedStore`. Bump the version there, not in core's list. |
| Renaming stays cheap only if you keep it that way | The name lives in manifests and docs headers. Importing it into runtime code turns a rename into archaeology. |
| A green CI run is not a green artifact | The core tarball has its own check (`pack:check`). The example panel is not published and has none — a green CI run says nothing about the panel's bundle. |
| `catalog:` would ship literally under npm publish | `changeset publish` shells out to npm, which does not rewrite the pnpm `catalog:` protocol — the tarball would be uninstallable. The release workflow publishes with `pnpm -r publish` (pnpm rewrites at pack time, exactly as `pack:check`'s `pnpm pack` already does). |
| changesets tags are `patcms@x.y.z`, not `vx.y.z` | The human-facing tag is `v<version>`, created by `scripts/create-github-release.mjs` from the publish summary; changesets' own tag stays local (`push-git-tags: false`). Renaming the release workflow moves the npm trusted-publisher configuration with it — the filename must match on both sides. |

## Release policy (carried from ADR-0010, amended)

- **Versioning.** `patcms` is the npm package, `0.x`; a 0.x minor may break until the API freezes.
- **Publishing.** npm trusted publishing over OIDC. No stored `NPM_TOKEN`. The release job holds
  `contents: write` + `id-token: write` (plus `pull-requests: write` for the Version Packages PR);
  every other job keeps `contents: read`. `scripts/ci-workflow-guard.mjs` enforces the shape:
  `contents: write` is illegal without `id-token: write`.
- **Supply chain.** Frozen lockfile, `onlyBuiltDependencies` allowlist, waiver-filtered audit,
  SHA-pinned actions.
- **Amendment.** The reference admin no longer ships as a build artifact; it is deleted at P2
  parity. There is no second distributable.

## Appendix — yve integration reference

Frozen from the Sveltia/Decap configuration at planning time. `playground/src/config/yve.ts` and
`playground/src/config/__tests__/inv-c01-parity.test.ts` cite this section; update it only together
with the fixture regeneration.

| Item | Value |
|---|---|
| Source repo | `Kaizen3424/iye_gallery_demo`, branch `main` |
| Site | `https://iye-gallery-demo.scantest.workers.dev` |
| Legacy admin | `public/admin/index.html` (Sveltia `@sveltia/cms@0.251.0`), preserved at `/admin-legacy/` |
| Content root | `src/content` — `products/`, `collections/`, `pages/`, plus `site.json` |
| Media | `media_folder: public/images`, `public_folder: /images`, per-collection overrides for products and collections |
| Deploy truth | Cloudflare Workers Builds reports check-runs on the pushed commit |
| Corpus | 14 content files: 6 products, 2 collections, 6 page and site documents |
| Drift fixtures | 6, in `playground/fixtures/repo/src/content/drift/` |

**The six pinned drift cases** (CMS declaration vs the site's zod):

1. `category` is a closed select of three options; the site accepts any string.
2. `people` has no CMS minimum; the site enforces `.min(1)`.
3. `price`, `basePrice`, diameter values, and surcharges are CMS integers; the site does not use `.int()`.
4. `contact.email` is a CMS email hint; the site uses plain `z.string()`.
5. Relations persist slug strings; integrity is enforced by a module-load throw in the site build, not by zod.
6. Hidden-field defaults apply on new entries only (for example `materialFilter: "Ceramics"`), never on open.

Conventions the fixtures pin: the slug is filename-derived and virtual; money uses
`Intl.NumberFormat("nl-NL", …)`; files are 2-space indent, author key order, LF, trailing newline, raw
Unicode; only edited files may re-serialise; inline objects-in-arrays stay inline.

## Session log

- **2026-11-01** — Plan created, replacing `phase-7-publish.md`. Scope refocused on the headless
  `patcms` SDK: rename finished, `createCMS()` client built and tested, surface split into
  `patcms` / `patcms/advanced` / `patcms/web`, fakes moved to `src/__tests__/support`, e2e and the
  capture script deleted, admin-only stores moved out of `patcms/web`, defaults and slugify ported
  with tests, `scripts/check-tarball.mjs` written and green. Remaining: specs, READMEs, example
  panel, admin deletion, changesets, release workflow.
- **2026-11-01 (2)** — P1 closed. Defaults doc comment fixed to match code (optional lists with no
  value stay absent); `defaults.test.ts` rewritten against real behaviour (13 green). Slugify edge
  tests added (accent folding, punctuation collapse, `"entry"` fallback). `scripts/check-tarball.mjs`
  written: builds, packs, scans for src/tests/fixtures/maps/msw, applies publishConfig, probes all
  three entries — green, wired into CI in place of the deleted e2e steps. All six specs, AGENTS.md,
  and both READMEs updated; INV-N05 repurposed for the tarball claim (its e2e enforcer is gone).
  Gates: `check`, `-r test` (core 537 / admin 238 / playground 14), `-r build`, `scan:prod-purity`,
  `scan:workflows`, `pack:check` — all green. Next: P2 example panel, then admin deletion, then P3
  publish machinery.
- **2026-11-01 (3)** — P2 example panel built in `playground/src/panel` and validated against the
  fake, then against the real repo `Kaizen3424/cms_test@main` (owner-approved). Bugs found and
  fixed: unbound default `fetch` crashed browser hosts ("Illegal invocation", `resolveFetch`
  binds); detached `cache.dispose` cleanup crashed React on tab switch; duplicate nested-field ids
  broke label association; sign-in forgot `remember: true`; the harness now refuses GitHub
  requests when the MSW worker is not controlling the page (one request leaked to the real API
  during an HMR race). Real-repo finding: GitHub answers `GET /git/ref/heads/main` with
  `max-age=60`, so the browser HTTP cache served a stale head after writes and the media list
  missed a fresh upload for up to a minute — fixed as INV-N06 (`cache: "no-store"` on
  branch-addressed GETs and the probe; SHA-addressed reads stay cacheable), enforced in
  `github-backend.test.ts` + `inv-probe.test.ts`. Gates green (core 539 / admin 238 / playground
  38, `--frozen-lockfile` included). Commits: My_CMS `7199eae`, `c87feac`; cms_test `31df45c`,
  `b474349`. Repo loop left `Kaizen3424/cms_test` pristine (blob shas verified). Parity review
  passed — table in the P2 section. Next: owner confirmation, then delete `packages/admin` and the
  old cms_test deps, prune the catalog, retire `scan:prod-purity`, update specs.
- **2026-11-01 (4)** — P2 closed with the admin cutover (owner-approved). `packages/admin` and
  `scripts/prod-purity-scan.mjs` deleted; the `scan:prod-purity` script and its CI step retired; the
  catalog pruned of 18 admin-only pins (Radix ×9, TanStack ×2, react-hook-form, Tailwind ×2,
  testing-library ×3, jsdom, playwright) and the Tailwind postinstall allowlist entries; tsconfig
  reference and repo-bans scan root dropped; the two changesets rewritten for `patcms` only.
  Claims retired with the deleted code: INV-P15/P16 (save sweep, freeze model — admin UX),
  INV-T05 (worker EXIF/raster pipeline), INV-N04 (admin-bundle byte-scan); each deep-dive carries a
  retirement note and the anchor index is renumbered (the no-store transport claim is INV-N06 —
  media-architecture already owned INV-N03). cms_test dropped `@patcms/admin`/`@patcms/core` and their
  vendor tarballs (install, typecheck, build green). Specs updated in the same change: CMS.md
  (panel is the reference consumer, screens table, upload pipeline, copy/veto/env wording),
  publish-and-recovery (conflict rendering by the host, watcher wording, P17 enforcer),
  test-harness (CI guards, N05 only), media (SDK upload path, panel preview cache), content-model
  (panel editor wiring), backend (A01/A02 enforcers). Gates green: core 538 / playground 38,
  `--frozen-lockfile`, build, `pack:check`. Remaining: P3 publish machinery (changesets, release
  workflow, tag).
- **2026-11-02** — P2.5 closed (owner-requested between P2 and P3): consumer `docs/` (15 pages) and
  the `.agents/skills/patcms` agent skill (SKILL.md + 5 references + committed eval set), both
  snippet-checked by the new `pnpm run docs:check` — every ```ts block in docs/, both READMEs, and
  the skill references typechecks against `packages/core/dist-types`, and relative links are
  verified; wired into CI after `build`. Closed the open "README snippet typecheck against the
  tarball" item and publish blocker #9; README snippets updated to the fence contract
  (`file="cms.config.ts"`, `declare const` for runtime values). Real findings the checker caught:
  `FetchLike` is advanced-only (not main), and a raw DOM `fetch` does NOT structurally satisfy
  `FetchLike` under TS 5.7+ ArrayBuffer generics (`FetchRequestInitLike.body` vs `BodyInit`) — docs
  teach the one-line adapter the SDK itself uses. AGENTS.md inventory/trigger-table/budget updated
  (docs/ exempt from the specs budget), README Documentation + Development tables updated, anchor
  §2 gains `docs:check`. Skill passed `skill_validate`; trigger eval still pending — the eval
  harness (10 OpenCode workers) crashed the dev server twice mid-run; rerun with fewer workers.
  Gates green: frozen-lockfile, typecheck, check, tests (core 538 / playground 38), build,
  `pack:check`, `scan:workflows`, `docs:check`. Remaining: P3 publish machinery.
- **2026-11-02 (2)** — P3 closed (first publish awaits owner npm config). Added
  `.changeset/headless-client.md` (the client itself had no changeset) and moved the version field
  `0.1.0` → `0.0.0` so the three pending minors compute the first release — `changeset status
  --verbose` lists `patcms -> 0.1.0` (playground takes the dependent patch,
  `privatePackages.version: true`). Wrote `.github/workflows/release.yml`: changesets action
  v2.1.2 (SHA-pinned) opens the Version Packages PR or publishes with `pnpm -r publish
  --no-git-checks --report-summary` through npm trusted publishing (OIDC, `id-token: write`, no
  `NPM_TOKEN` anywhere — pnpm, not `changeset publish`, because npm would ship the `catalog:`
  protocol literally, while pnpm rewrites it at pack time and publishes only registry-missing
  versions). `scripts/create-github-release.mjs` turns the publish summary into the `v<version>`
  tag + GitHub Release with the changeset notes (idempotent on re-runs). Amended
  `scripts/ci-workflow-guard.mjs`: the release shape (`contents: write` only together with
  `id-token: write`, scopes limited to contents/pull-requests/id-token) is now legal; specs
  updated in the same change (anchor §2 Release + CI actions rows, test-harness guard row).
  READMEs: status lines made version-agnostic, root README gains a Releases section. Owner steps
  before the first publish: npmjs.com trusted publisher (user `Kaizen3424`, repo `patcms`,
  workflow `release.yml`, first publish within 2 days of configuring) + repo setting "Allow
  GitHub Actions to create and approve pull requests". Gates green: frozen-lockfile, typecheck,
  check, tests (core 538 / playground 38), build, `pack:check`, `scan:workflows`, `docs:check`,
  and `changeset status` listing 0.1.0. Remaining: the first real publish (owner), then the
  skill trigger eval rerun when the environment is stable.
- **2026-11-02 (3)** — Repo renamed on GitHub to `Kaizen3424/patcms` (owner action): manifest
  `repository.url`, release.yml comment, plan owner steps, and the git remote updated — npm
  trusted publishing validates `repository.url` exactly, so this had to land before the first
  publish. Bun support (owner request): bun reads the npm registry, so there is no separate bun
  publish — the same tarball must serve bun consumers. New `scripts/bun-smoke.mjs` (`pnpm run
  bun:smoke`): builds, packs, `bun add`s the tarball into a scratch project, constructs
  `createCMS()` from the real config DSL under bun (no network), and typechecks the consumer with
  `moduleResolution: "bundler"`; green under bun 1.3.14 on the first run. Wired as a `bun-smoke`
  CI job (`oven-sh/setup-bun` v2.2.0, SHA-pinned; guard unchanged — it enforces the shape
  generically). Docs/spec updated in the same change: getting-started install gains the `bun add`
  variant, anchor §2 bullet + commands row, README command list, root `bun:smoke` script (and the
  "change all four together" note corrected to the three places that actually mirror commands —
  AGENTS.md has no command list). No manifest change, so no changeset. npm account created
  (`pnpm whoami` → kaizen3424, logged in via `npm login`); first-publish plan: try the trusted
  publisher config first, else one local bootstrap publish with the CLI credentials (never stored
  in repo/CI), then trusted publishing takes over. Gates green: check, scan:workflows, build,
  docs:check, bun smoke.
- **2026-11-02 (4)** — The first remote runs surfaced three defects the local gates could not see.
  (1) `git commit -am` silently skips new untracked files: the bun-smoke commit shipped the CI job
  but not `scripts/bun-smoke.mjs` (MODULE_NOT_FOUND in one second); committed explicitly. (2) The
  changesets action does not put `node_modules/.bin` on PATH, so the bare `changeset version`
  version-script failed ("Unable to locate executable file: changeset"); it is now `pnpm changeset
  version`. (3) The bun smoke then caught a real packaging bug: `tsup` has `dts: false` and `tsc
  -b` emits `dist-types`, so a job that runs only `build` packs a tarball whose published types
  point at missing files — the local pass was an artifact of stale `dist-types` on disk.
  `bun-smoke.mjs` now emits dist-types itself and `release.yml` gained a typecheck step before
  build; without this the first publish would have shipped broken types. After the fixes: ci
  (gates + bun-smoke) and release both green on `3184a57`; Version Packages PR #1 (patcms@0.1.0 +
  playground@0.0.2) is open, awaiting owner merge and the first publish.
- **2026-11-02 (5)** — Identifier purge (owner-requested): every remaining `mycms` reference renamed
  to `patcms` — the public `.meta()` key (`CMS_META_KEY`), the default IndexedDB database name and
  the sessionStorage key, the `patcms/web` exports (`PATCMS_IDB_STORES`, `openPatcmsDatabase`,
  `closePatcmsDatabases`), the save-lease wire strings, `PATCMS_ALLOW_REAL_GITHUB`, the fixture git
  identity (`fixture@patcms.invalid` — a hash input, so the manifest `headSha` was recomputed with
  the renamed domain string; content bytes untouched and `fixtures:check` green), the vite env
  prefix/server name, the fake-GitHub owner tag, LICENSE, and the workspace comment. Also removed
  two stale spec rows and one comment referencing `window.__patcmsHarness` — the page global died
  with the e2e suite and the spec never caught up (code wins). `fixtures:sync` needs the absent yve
  mirror, so the manifest headSha was recomputed with the generator's own formula rather than
  hand-editing content. A changeset records the rename in the 0.1.0 notes; nothing is published, so
  no migration path is needed. Gates green: fixtures:check, typecheck, check, tests (core 538 /
  playground 38), build, pack:check, docs:check, scan:workflows, bun smoke; `git grep -in mycms`
  empty outside the plan's historical note.
- **2026-11-02 (6)** — The first publish attempt (local, owner's npm CLI login) was blocked twice,
  both instructively. (1) npm 403: new accounts must publish with 2FA — the owner enabled 2FA and
  the republish carries an OTP. (2) The tarball listing exposed a real INV-N05 hole: `dist-types/`
  held declarations for modules deleted in the admin cutover (`web/lease-carriers`,
  `idb-journal-store`, … — `tsc -b` is incremental and never deletes outputs) plus
  `dist-types/__tests__/support/*` test doubles, and `pack:check` missed both because it matched
  forbidden segments only as path prefixes. Fixes: core `typecheck` cleans `dist-types` + the
  tsbuildinfo before emitting, `files` negates `**/__tests__` and `**/*.test.d.ts`, and
  `check-tarball.mjs` now rejects forbidden path segments and `.test.` files at any depth. Specs
  updated in the same change (INV-N05 wording + a Known-traps row). Gates green: check, pack:check
  (packed version reads 0.1.0), bun smoke, docs:check.
- **2026-11-02 (7)** — First publish (owner, from their terminal): the Version Packages PR was
  merged with a merge commit ("v0.1.0"), the rename shipped without its changeset (pre-release
  churn needs no changelog entry — nothing had published), and the owner ran
  `pnpm -r publish --no-git-checks --report-summary` with their npm login. npm's new-account
  publish flow used browser authentication and placed the tarball in **staged review** — the
  registry momentarily lists only `0.0.0-stage` (created 2026-11-02T05:59:43Z) until npm's
  automated scan releases `0.1.0`. The published tarball listing confirmed the INV-N05 fix: 92
  files / 104 kB, no `__tests__` declarations, no stale admin-era modules. CI release runs 5-7
  failed at publish as designed (no credentials in CI). Remaining: tag `v0.1.0` + GitHub Release
  (owner, web UI — the PAT lacks write on this repo), configure the npm trusted publisher (user
  `Kaizen3424`, repo `patcms`, workflow `release.yml`) for OIDC automation.
- **2026-11-02 (8)** — npm's staged review released `0.1.0` minutes after the publish (registry:
  `0.1.0` is `latest`; the `0.0.0-stage` tombstone remains in the version list — normal for the
  staged flow). The bun registry smoke passed end-to-end against the live package: `bun add patcms`
  in a scratch project (bun 1.3.14) installs 0.1.0, `bun smoke.ts` imports `createCMS` /
  `defineConfig` / `defineCollection` and `patcms/advanced`'s `runSave` and constructs a CMS, and
  the repo's `tsc` typechecks the scratch under `moduleResolution: bundler` — registry types
  resolve. This closes the bun deliverable: one npm publish serves bun, verified against the
  registry, not just the local tarball.
