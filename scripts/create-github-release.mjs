#!/usr/bin/env node
/**
 * Post-publish step of the release workflow (ADR-0010): tag `v<version>` on
 * the publish commit and create the GitHub Release whose notes are the
 * changeset-generated changelog section for that version.
 *
 * The publish script (`pnpm -r publish --report-summary`) writes
 * `pnpm-publish-summary.json` only when something was actually published, so
 * an absent or empty summary means "this run produced the Version Packages
 * PR" — exit 0, do nothing. Git-side only: the npm publish itself went through
 * OIDC trusted publishing, and no npm token exists anywhere.
 *
 * Inputs (environment, CI-provided):
 *   GITHUB_SHA — the commit to tag
 *   GH_TOKEN   — token for the gh CLI
 */
import { spawnSync } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const PACKAGE = "patcms"
const CHANGELOG = "packages/core/CHANGELOG.md"
const SUMMARY = "pnpm-publish-summary.json"

function fail(message) {
  console.error(`[release] FAIL: ${message}`)
  process.exit(1)
}

/**
 * @param {string} cmd
 * @param {string[]} args
 * @param {"pipe" | "inherit"} stdio
 */
function run(cmd, args, stdio = "pipe") {
  const result = spawnSync(cmd, args, { encoding: "utf8", stdio })
  if (result.error) fail(`${cmd} failed to start: ${result.error.message}`)
  return result
}

if (!existsSync(SUMMARY)) {
  console.log("[release] nothing was published in this run — nothing to release")
  process.exit(0)
}
const summary = JSON.parse(readFileSync(SUMMARY, "utf8"))
const published = summary.publishedPackages ?? []
const entry = published.find((pkg) => pkg.name === PACKAGE)
if (!entry) {
  console.log(`[release] ${PACKAGE} was not published in this run — nothing to release`)
  process.exit(0)
}
const { version } = entry
const tag = `v${version}`

// Idempotent on re-runs: an existing release means the tag exists too.
if (run("gh", ["release", "view", tag]).status === 0) {
  console.log(`[release] ${tag} is already released — nothing to do`)
  process.exit(0)
}

// The changeset-generated changelog: the "## <version>" section runs to the
// next "## " header or the end of the file.
const changelog = readFileSync(CHANGELOG, "utf8")
const start = new RegExp(`^## ${version}(\\s|$)`, "m").exec(changelog)
if (!start) {
  fail(`no "## ${version}" section in ${CHANGELOG} — was the Version Packages PR merged?`)
}
const rest = changelog.slice(start.index + start[0].length)
const next = rest.search(/^## /m)
const notes = (next === -1 ? rest : rest.slice(0, next)).trim()
if (notes === "") fail(`the "## ${version}" changelog section is empty`)

const notesPath = join(mkdtempSync(join(tmpdir(), "patcms-release-")), "notes.md")
writeFileSync(notesPath, `${notes}\n`)

// gh creates the tag at --target when it does not exist yet.
const created = run(
  "gh",
  [
    "release",
    "create",
    tag,
    "--target",
    process.env.GITHUB_SHA ?? "HEAD",
    "--title",
    `${PACKAGE} v${version}`,
    "--notes-file",
    notesPath,
  ],
  "inherit",
)
if (created.status !== 0) fail(`gh release create exited ${created.status}`)
console.log(`[release] ${tag} created with the changeset notes`)
