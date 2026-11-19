# Release and publish

> Parent: [`specs/README.md`](README.md)

Publishing `patcms` is a trust boundary: a version on npm cannot be replaced, and the package must
ship from a tag that carries its changelog. This file is the runbook for that path. It is about the
**package release**, not a host's content deploy (that is `saving-content.md`).

The law is ADR-0010: changesets, npm trusted publishing over OIDC, **no npm token anywhere**.
`.github/workflows/release.yml` is the only workflow that publishes, and the only job allowed the
`contents: write` + `id-token: write` permission shape (`scripts/ci-workflow-guard.mjs` enforces it).

The normal path is three moves: add a changeset, merge the "Version Packages" PR, verify the three
artifacts (`npm view`, the tag, the GitHub Release). Everything below exists for when a move fails.

## One-time configuration outside this repo

npm must trust this exact workflow. When it does not, there is no credential in the repo to inspect —
the publish step simply reports that it is not logged in. Only a package owner can change this.

| Field | Value |
|---|---|
| Provider | GitHub Actions |
| Organization or user | `Kaizen3424` |
| Repository | `patcms` |
| Workflow filename | `release.yml` — filename only; renaming the file breaks the binding |
| Environment name | empty |
| Allowed actions | direct **npm publish**; dist-tags only if a human retags by hand |

- "npm stage publish" is always allowed but only stages a release for browser approval. A trusted
  publisher limited to staging cannot finish an unattended release: the publish step fails and the
  tag step has nothing to tag.
- A trusted publisher can read **Expired**. npm refuses it; delete and re-create it. After creation
  npm shows **Pending validation** until the first successful publish before the stated deadline.
- Trusted publishing works with either 2FA option under **Publishing access**. Do not add an npm
  token as a fallback.
- Only `patcms` is published. `playground` is private; changesets bumps its version but never
  publishes it.

## The flow

Every push to `main` runs one job; the same job either proposes a version or publishes one.

1. **Version PR.** Pending changesets make `changesets/action` open or update the "Version Packages"
   pull request. Nothing is published and the tag step exits with "nothing was published in this
   run".
2. **Publish.** Merging that PR pushes the version commit to `main`. With no pending changesets left,
   the action runs `publish-script` (`scripts/publish-package.mjs`).
3. **Pack with pnpm.** `pnpm --filter patcms pack` rewrites the workspace `catalog:` protocol into
   concrete version ranges. `npm pack` cannot do that, so it must never be the packer.
4. **Publish with npm.** The npm CLI performs the GitHub Actions OIDC exchange. In this setup pnpm's
   publish path does not perform that exchange — it fails `ENEEDAUTH` even with a valid trusted
   publisher — so the job upgrades npm first (the npm bundled with Node 22 predates trusted
   publishing) and publishes the packed tarball. npm attaches provenance automatically for a public
   package from a public repo.
5. **Summary handoff.** A successful publish writes `pnpm-publish-summary.json` (gitignored). The
   registry guard skips the whole step when `patcms@<version>` is already live and writes no summary,
   so ordinary pushes to `main` stay green.
6. **Tag and release.** `scripts/create-github-release.mjs` reads the summary, extracts the
   `## <version>` section from `packages/core/CHANGELOG.md`, and runs
   `gh release create v<version> --target $GITHUB_SHA`. That command creates the tag; there is no
   second tagging path. Re-runs are idempotent (an existing release exits 0).

## Cutting a release

1. `pnpm changeset` — choose the bump (minor for features, patch for fixes). The changeset text is
   the release note; it becomes the changelog body verbatim.
2. Commit and push (or merge a PR) to `main`; let the workflow open the "Version Packages" PR;
   review its version numbers and changelog, then merge it.
3. The merge push publishes. Watch the run (`gh run watch <id> --exit-status`, or GitHub → Actions →
   release) rather than assuming a green push.
4. Verify all three artifacts, not just the workflow colour:
   - `npm view patcms version` prints the new version, and `npm view patcms dist-tags` shows it on
     `latest`;
   - `git ls-remote --tags origin v<version>` resolves to the publish commit;
   - `gh release view v<version>` exists with the changelog notes.
5. Optional smoke: install the published version into a scratch directory and import `patcms`,
   `patcms/advanced`, and `patcms/web`.

## Failure playbook

| Symptom in the run | Cause | Action |
|---|---|---|
| `ENEEDAUTH` / "need auth" right after the tarball listing | npm cannot exchange an OIDC token: trusted publisher missing, expired, or staging-only; or the publish used pnpm; or npm is older than trusted publishing | Fix the npm trusted-publisher entry first, then confirm the job upgrades npm and publishes with npm |
| `EOTP` on a publish from a laptop | the npm account requires a one-time code; local publishing is not the release path | Do not hand-publish; run the workflow, which uses OIDC |
| `E403` "cannot publish over previously published versions" | that version is already on the registry, usually a re-run after a partial failure | Bump with a changeset; a published version can never be reused |
| "Failed to read changesets output …" annotation, job green | expected with a custom `publish-script`: the action only writes that file for its own publish | None; the tag step reads the publish summary, not that file |
| Tag step says "nothing was published in this run" | this push was the version PR, or a docs-only push | Expected |
| Tag step fails: no `## <version>` section in the changelog | the Version Packages PR was not merged, or the changelog lacks the version | Merge it or fix the changelog; the release cannot invent notes |
| Version Packages PR never opens | there are no pending changesets | Add one with `pnpm changeset`; an empty `.changeset` is not a release |
| `latest` points at the wrong version | dist-tag drift | `npm dist-tag add patcms@<version> latest` from the owner's npm login; this is a tag move, not a publish |

## Local verification

`node scripts/publish-package.mjs --dry-run` packs the tarball and, when the version is not yet live,
runs npm's dry run. It writes no summary, and exits 0 when the version is already published (it still
packs). Use it after touching packaging, `publishConfig`, or the `files` list. Never run
`npm publish` by hand as the normal path: it produces a version with no tag, no GitHub Release, and
possibly no provenance — and the version number can never be reused.

## Why the moving parts

| Piece | Why it exists |
|---|---|
| `changesets/action` | version PR and publish trigger; `version-script: pnpm changeset version` because the action does not put `node_modules/.bin` on `PATH` |
| `scripts/publish-package.mjs` | pnpm pack + npm publish; registry guard; summary file for the step below |
| `scripts/create-github-release.mjs` | tag + GitHub Release from the summary and the changelog section |
| `scripts/ci-workflow-guard.mjs` | keeps the release job's permission shape, SHA pins, and trigger bans honest |

## Decisions and claims

### Decisions

| ID | The rule that still binds |
|---|---|
| ADR-0010 | Releases are changesets-driven and publish only from CI through npm trusted publishing (OIDC); no `NPM_TOKEN` exists, so nothing may add one. The release job alone may hold `contents: write`, `pull-requests: write`, and `id-token: write` — write access never rides tokenless, and no other scope is allowed. Actions stay SHA-pinned, triggers never include `pull_request_target`, and a release produces exactly one npm version, one `v<version>` tag on the publish commit, and one GitHub Release whose notes are the changelog section. The same record pins Node 22 for CI/tooling, exact catalog pins, and waiver-filtered audits. |

### Guards

| Rule | Enforced by |
|---|---|
| Permission shape, SHA pins, banned triggers | `scripts/ci-workflow-guard.mjs` (runs before install in CI) |
| Publish only a registry-missing version; write the summary only on success | `scripts/publish-package.mjs` |
| One idempotent tag/release per published version, notes from the changelog | `scripts/create-github-release.mjs` |
| Trusted-publisher binding to `release.yml` | npmjs.com package settings — outside the repo and not testable here |
