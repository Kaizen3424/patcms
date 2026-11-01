# Phase 7 — publish what exists

> Single active plan. The durable description of the code is `specs/CMS.md`; this file is the one
> delivery plan, and it owns release policy (ADR-0010) and the yve cutover checklist (INV-C01–C04).

## Goal

Ship 0.1.0 of what is already built: `@mycms/core` on npm, the admin as a build artifact, and a
repository a stranger can adopt without asking a question. No new product features. Everything listed
as a non-goal stays out of this phase.

Done means: `pnpm add <scope>/core` in a clean project compiles against published types, the admin
mounts from the published artifact, and CI proves the tarball contains no test double, sourcemap, or
telemetry string.

## Current truth

| Area | State |
|---|---|
| Implementation | Code complete through P6. Save machine, conflict freeze, media pipeline, deploy status, auth lifecycle, and all six screens are implemented and tested. |
| Tests | Unit and contract suites across `packages/*`; 20 Playwright journeys in `e2e/specs` against the playground build. |
| Docs | `specs/` is the only description of behaviour. `docs/` and `tasks/` were deleted in this phase; git history keeps them. |
| Release machinery | `.changeset/` exists at HEAD but is deleted in the working tree — restore it first. |
| Package identity | Still the placeholder `@mycms/*` from ADR-0010. |
| Distribution | `packages/core` exports point at `./src/index.ts`; the build artifact has no declarations. Publishing today would ship raw TypeScript. |
| Deploy | No deploy workflow exists. The yve site deploys through Cloudflare Workers Builds from `main` and reports check-runs; this repo's CI publishes nothing. |

## Publish blockers

Everything here must be true before the first `npm publish`. These are the only code-adjacent changes
Phase 7 allows.

| # | Blocker | Evidence | Done when |
|---|---|---|---|
| 1 | `exports` point at source | `packages/core/package.json` maps `.` to `./src/index.ts` and `./web` to `./src/web/index.ts` | Exports map to `./dist/*.js` and `./dist/*.d.ts`, `types` is set, and `files` lists `dist` |
| 2 | No declarations in the artifact | `packages/core/tsup.config.ts` sets `dts: false`; `tsc -b` writes `dist-types` | `dist/*.d.ts` ships: enable `dts` in tsup, or copy the filtered `dist-types` output and point `types` at it |
| 3 | `./web` is not a build entry | one tsup entry, `src/index.ts` | second entry `src/web/index.ts` with its own declaration output |
| 4 | Changesets deleted | `git status` shows `D .changeset/*` | `git checkout HEAD -- .changeset`, then a changeset describing 0.1.0 |
| 5 | Version | `0.0.1` in both packages | `0.1.0` via `pnpm changeset version` |
| 6 | Name and scope | `@mycms/*` is a placeholder | ADR-0010 decision recorded, then one find-replace across manifests, docs, and playground imports |
| 7 | No publish workflow | CI has no release job | A release workflow in `.github/workflows/` using npm trusted publishing (OIDC) |
| 8 | Tarball hygiene unproven | `npm pack` has never run in CI | CI step asserts no `src/`, no MSW, no `.map`, and no fixture bytes in the tarball |

Keep the Node-safety split while doing 1–3: `@mycms/core` must not re-export `web/` from its main
entry, and `web/` must keep importing as `@mycms/core/web`.

## OSS surface

| File | Work |
|---|---|
| `README.md` | Rewritten this phase. Keep it truthful: pre-1.0, no deploy pipeline claim, no `docs/` links. |
| `CONTRIBUTING.md` | Add "register a widget" and "add a backend", with the contract suite named as the admission gate. Keep the trunk-based rules. |
| `SECURITY.md` | Refresh for a published package: supported versions, the 0.x window, and the PAT as the whole boundary. |
| `LICENSE` | MIT with the owner line final. |
| Demo | The playground is the demo. Decide in this phase whether to deploy it; if not, say "run it locally" and claim no live demo. |

## Non-goals

Deliberately outside Phase 7. Each is a separate change, with an ADR where it changes a boundary:

- Decap/Sveltia `config.yml` importer.
- OAuth worker behind the `AuthProvider` seam.
- GitLab or any second backend; the contract suite admits it later.
- PR/staging-branch mode, WYSIWYG markdown, i18n, visual previews.
- SVG passthrough behind a sanitizer.

## Acceptance checklist

Tick an item only with command output or a named manual check.

- [ ] `pnpm install --frozen-lockfile`, `pnpm -r typecheck`, `pnpm run check`, `pnpm -r test` all green
- [ ] `pnpm -r build` green and `pnpm run scan:prod-purity` green
- [ ] `pnpm e2e` green
- [ ] `pnpm fixtures:check` and `pnpm fixtures:tape-check` green
- [ ] `pnpm changeset status` lists exactly 0.1.0
- [ ] `npm pack` in `packages/core`: no `src/`, no `.map`, no fixture or MSW bytes in the file list
- [ ] Tarball installed into a scratch project: `import { defineConfig } from "<scope>/core"` typechecks and runs
- [ ] `<scope>/core/web` resolves separately and the main entry pulls in no DOM code
- [ ] `package.json` has `files`, `exports`, `types`, `repository`, `homepage`, and `keywords`
- [ ] Release workflow publishes through OIDC; no `NPM_TOKEN` secret exists anywhere
- [ ] README install snippet matches the real package name and entry points
- [ ] `v0.1.0` tagged and the GitHub Release carries the changeset notes
- [ ] Appendix A cutover checklist complete, or deferred with a dated note and an owner decision

## Gotchas

| Gotcha | Why it bites |
|---|---|
| Source exports hide the packaging bug | Everything works in the monorepo because pnpm resolves `src`. Only a tarball install proves the artifact. |
| `tsc -b` declarations are not a publish artifact | `dist-types` mirrors the source tree and carries build metadata; copy it wholesale and the package leaks `*.tsbuildinfo`. |
| `@mycms/core` must stay Node-safe | If `src/index.ts` ever re-exports `web/`, the published main entry ships DOM code and breaks SSR imports. |
| The playground must never enter the tarball | `files` is the allowlist. Omit it and the package publishes fixtures and MSW handlers. |
| No `NPM_TOKEN` | ADR-0010 makes trusted publishing a standing condition. A token secret is a veto, not a shortcut. |
| A green CI run is not a green artifact | `scan:prod-purity` scans the admin `dist`; the core tarball needs its own equivalent check. |
| Renaming stays cheap only if you keep it that way | The name lives in manifests and docs headers. Importing it into runtime code turns a rename into archaeology. |

## Appendix A — release policy and yve cutover

### ADR-0010 (release policy)

- **Naming.** Working name MyCMS, scope placeholder `@mycms/*` until this phase's gate. The name
  appears only in manifests and docs headers, so a rename stays a find-replace.
- **Versioning.** `core` is the npm package, `0.x`, with the documented rule that a 0.x minor may break
  until the API freezes. `admin` ships as git tags plus GitHub Releases carrying the built artifact and
  SHA-256 checksums. Internal packages version through changesets.
- **Publishing.** npm trusted publishing over OIDC. No stored `NPM_TOKEN`. The publish job gets
  `id-token: write`; every other job keeps `contents: read`.
- **Supply chain.** Frozen lockfile, `onlyBuiltDependencies` allowlist, waiver-filtered audit,
  SHA-pinned actions.

### INV-C01–C04 (cutover and parity)

These are checklists about the yve cutover, not claims about code inside `packages/`.

| ID | Claim |
|---|---|
| INV-C01 | Parity golden: a frozen field-by-field diff of the config package against the yve inventory; drift breaks both sides. Enforced by `playground/src/config/__tests__/inv-c01-parity.test.ts`. |
| INV-C02 | Schema swap: yve's `content.ts` imports schemas from this package, and CI pins the six drift cases with fixtures. |
| INV-C03 | Normalise once: a single pipeline-pass normalisation commit, then `serialize(parse(raw)) === raw` for all 14 corpus files. |
| INV-C04 | Rollback: `/admin-legacy` intact, a one-PR revert rehearsed on a fork, `restrict-force-pushes` verified ON. |

### yve integration reference

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

- **2026-11-01** — Plan created. Code is complete through P6; Phase 7 is publication only. Opened with
  the docs consolidation: `docs/` and `tasks/` deleted, their binding decisions and testable claims
  moved into the five deep-dives, and `README.md` rewritten for a public release.
