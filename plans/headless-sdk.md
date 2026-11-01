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
| No `@mycms/testing` package | The contract suite is an admission gate inside the repo, not a shipped artifact |
| Playwright `e2e` and `scripts/capture-recorded-fixtures.mjs` are deleted | The recorded tape stays as a static JSON fixture for replay tests |

## Current truth

| Area | State |
|---|---|
| Rename | `@mycms/core` → `patcms`, `@mycms/admin` → `@patcms/admin`, root → `patcms`. Done; lockfile regenerated. |
| Client | `packages/core/src/client/` complete: errors, events, cache, repo, auth, entries, media, drafts, `createCMS()`. 13 client tests green. |
| Surface split | `patcms` (slim, Node-safe), `patcms/advanced` (low-level), `patcms/web` (draft + token stores only). Build green: index 47.75 KB, advanced 91.53 KB, shared 136.08 KB, web 18.89 KB. |
| Fakes | Moved to `src/__tests__/support/`; `advanced.ts` no longer exports them; 30+ test files rewired; playground has its own dev-only copy at `playground/src/fake-github/server.ts`. |
| e2e | `e2e/` package, capture script, and their scripts deleted; workspace, root tsconfig, and CI updated. |
| `patcms/web` | Shrunk to draft store + token stores; journal/onboarding/discard/expiry stores and lease carriers moved to `packages/admin/src/storage/`. `MYCMS_IDB_STORES` is now `["auth", "drafts"]`. |
| Defaults | `foldFieldDefaults`/`createBlankEntryValue` ported from the reference admin; 13 tests green; doc comment now matches code (optional lists with no value stay absent). |
| Slugify | Added to `packages/core/src/safety/slug.ts`; accent folding, punctuation collapse, and the `"entry"` fallback are tested. |
| Tarball | `scripts/check-tarball.mjs` green: no `src/`/tests/fixtures/`.map`/msw, dist-types present, all three entries resolve through publishConfig wiring. Wired into CI. |
| Tests | core 68 files / 537 tests, admin 37 / 238, playground 4 / 14 — all green. |
| Specs | Updated this session for `patcms`, `patcms/advanced`, the shrunk `patcms/web`, `src/__tests__/support` fakes, the deleted e2e suite, moved admin stores, and the `createCMS()` client. |
| README | Root README rewritten for the headless story; `packages/core/README.md` written (ships in the tarball). Snippets match the real factory signatures but are not yet typechecked against the tarball. |
| Example panel | Not started. This is the proof that `createCMS()` is enough, and the gate for deleting `packages/admin`. |

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

- Gate: the example runs against the playground's fake GitHub and against a real repo.
- Gate: feature parity review against `packages/admin` for the *kept* features only; everything on
  the removed list stays removed.
- Then delete `packages/admin`, its tests, and the playground's dependency on it. The playground
  either becomes the example or is deleted with it — one artifact, not two.

### P3 — Publish machinery

1. Restore `.changeset/` (deleted in the working tree) and add the 0.1.0 changeset.
2. Release workflow in `.github/workflows/` using npm trusted publishing (OIDC); no `NPM_TOKEN`.
3. `pnpm run pack:check` in CI (step already added; script now exists).
4. Tag `v0.1.0`; the GitHub Release carries the changeset notes.

## Publish blockers

| # | Blocker | State |
|---|---|---|
| 1 | Exports point at source in the workspace | Resolved: `publishConfig` maps the published tarball to `dist` + `dist-types`; workspace keeps source `exports`. `pack:check` proves the published wiring. |
| 2 | Declarations in the artifact | Resolved: `tsc -b` writes `dist-types`; tsup stays `dts: false`. |
| 3 | `./web` as a build entry | Resolved: three tsup entries. |
| 4 | Changesets | Open: restore `.changeset/`, add the 0.1.0 changeset. |
| 5 | Version | Resolved: `0.1.0` in `packages/core`. |
| 6 | Name and scope | Resolved: `patcms` everywhere. |
| 7 | Release workflow | Open. |
| 8 | Tarball hygiene | Resolved: `scripts/check-tarball.mjs`, wired into CI. |
| 9 | README on the package page | Open (P1). |
| 10 | Example panel proves the SDK | Open (P2); deleting `packages/admin` is part of this blocker. |

## Acceptance checklist

Tick an item only with command output or a named manual check.

- [ ] `pnpm install --frozen-lockfile`, `pnpm -r typecheck`, `pnpm run check`, `pnpm -r test` green
- [x] `pnpm -r build` and `pnpm run scan:prod-purity` green
- [x] `pnpm run pack:check` green
- [ ] `pnpm changeset status` lists exactly 0.1.0
- [x] Specs match the code: no `@mycms` package references outside git history (the
      `fixture@mycms.invalid` git identity in `backend/git-sha.ts` is SHA-pinning, not naming),
      `patcms/advanced` and the
      shrunk `patcms/web` described, e2e gone, fakes documented as test-only
- [x] `packages/core/README.md` exists; its snippets use the real factory signatures (snippet
      typecheck against the tarball still open)
- [ ] Example panel runs the full loop (sign in → list → edit → save → conflict → media) with zero
      `patcms/advanced` imports
- [ ] `packages/admin` deleted; nothing in the repo imports it
- [ ] Release workflow publishes through OIDC; no `NPM_TOKEN` secret exists anywhere
- [ ] `v0.1.0` tagged and the GitHub Release carries the changeset notes

## Gotchas

| Gotcha | Why it bites |
|---|---|
| Source exports hide the packaging bug | Everything works in the monorepo because pnpm resolves `src`. Only the tarball check proves the artifact — keep `pack:check` in CI. |
| `patcms` must stay Node-safe | If `src/index.ts` ever re-exports `web/`, the published main entry ships DOM code and breaks SSR imports. `pack:check`'s probe imports `patcms` under Node — keep it that way. |
| `publishConfig` is applied at publish time, not pack time | The tarball as packed still carries source `exports`; `check-tarball.mjs` applies the transform manually before probing. If publishConfig and exports drift, the check lies. |
| The playground must never enter the tarball | `files` is the allowlist; it lists `dist`, `dist-types`, `README.md` only. |
| Test doubles are one `export *` away from public | `advanced.ts` must never re-export `src/__tests__/support/*`. The repo-bans scan and `pack:check` both guard this; treat a new fake as test-only by default. |
| `save` composes untouched from the entry, not the validation result | `validation.untouched` only reflects the incoming modeled value; using it drops preserved unknown fields. |
| Admin store moves changed the IDB schema owner | `MYCMS_IDB_STORES` is `["auth", "drafts"]`; the admin's journal/onboarding/discard stores open their own databases via `patcms/web`'s `createSharedStore`. Bump the version there, not in core's list. |
| Renaming stays cheap only if you keep it that way | The name lives in manifests and docs headers. Importing it into runtime code turns a rename into archaeology. |
| A green CI run is not a green artifact | `scan:prod-purity` scans the admin `dist`; the core tarball has its own check. Neither covers the example panel — it is not published. |

## Release policy (carried from ADR-0010, amended)

- **Versioning.** `patcms` is the npm package, `0.x`; a 0.x minor may break until the API freezes.
- **Publishing.** npm trusted publishing over OIDC. No stored `NPM_TOKEN`. The publish job gets
  `id-token: write`; every other job keeps `contents: read`.
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
