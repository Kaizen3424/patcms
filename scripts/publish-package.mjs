#!/usr/bin/env node
/**
 * Publish step of the release workflow (ADR-0010).
 *
 * pnpm packs the tarball: it is the only tool here that rewrites the
 * workspace `catalog:` protocol into real version ranges at pack time.
 *
 * The npm CLI publishes it. Only npm performs the GitHub Actions OIDC token
 * exchange that trusted publishing requires; `pnpm publish` reports ENEEDAUTH
 * in this job even when the trusted publisher is valid, because its publish
 * path never requests an identity token.
 *
 * Writes `pnpm-publish-summary.json` in the shape `pnpm -r publish
 * --report-summary` writes, so `scripts/create-github-release.mjs` tags the
 * version that was actually published. `--dry-run` packs and runs npm's dry
 * run, writing nothing.
 */
import { spawnSync } from "node:child_process"
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const PACKAGE = "patcms"
const MANIFEST = join("packages", "core", "package.json")
const SUMMARY = "pnpm-publish-summary.json"
const dryRun = process.argv.includes("--dry-run")

/** @param {string} part */
function quote(part) {
  return /[\s"]/.test(part) ? `"${part.replaceAll('"', '\\"')}"` : part
}

/** @param {string} cmd @param {string[]} args */
function run(cmd, args) {
  // On Windows both pnpm and npm are .cmd shims, so they need a shell.
  const result =
    process.platform === "win32"
      ? spawnSync([cmd, ...args].map(quote).join(" "), { stdio: "inherit", shell: true })
      : spawnSync(cmd, args, { stdio: "inherit" })
  if (result.error) fail(`${cmd} failed to start: ${result.error.message}`)
  if (result.status !== 0) fail(`${cmd} exited ${result.status}`)
}

/** @param {string} message */
function fail(message) {
  console.error(`[publish] FAIL: ${message}`)
  process.exit(1)
}

const out = mkdtempSync(join(tmpdir(), "patcms-publish-"))
try {
  run("pnpm", ["--filter", PACKAGE, "pack", "--pack-destination", out])
  const tarball = readdirSync(out).find((name) => name.endsWith(".tgz"))
  if (tarball === undefined) fail("pnpm pack produced no tarball")

  const args = [
    "publish",
    join(out, tarball),
    "--access",
    "public",
    ...(dryRun ? ["--dry-run"] : []),
  ]
  run("npm", args)

  const { version } = JSON.parse(readFileSync(MANIFEST, "utf8"))
  if (dryRun) {
    console.log(`[publish] dry run OK — ${PACKAGE}@${version} was not published`)
  } else {
    writeFileSync(
      SUMMARY,
      `${JSON.stringify({ publishedPackages: [{ name: PACKAGE, version }] }, null, 2)}\n`,
    )
    console.log(`[publish] published ${PACKAGE}@${version}`)
  }
} finally {
  rmSync(out, { recursive: true, force: true })
}
