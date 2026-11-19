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
 * version that was actually published. `--dry-run` packs and, unless the
 * version is already live, runs npm's dry run; it writes nothing.
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

/**
 * @param {string} cmd @param {string[]} args
 * @returns {import("node:child_process").SpawnSyncReturns<string>}
 */
function capture(cmd, args) {
  return process.platform === "win32"
    ? spawnSync([cmd, ...args].map(quote).join(" "), { encoding: "utf8", shell: true })
    : spawnSync(cmd, args, { encoding: "utf8" })
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

const { name, version } = JSON.parse(readFileSync(MANIFEST, "utf8"))

// Every push to main runs this step. Publish only a version the registry does
// not have yet, and write no summary when there is nothing to release — the
// tag step treats a missing summary as "this run made no release".
const known = capture("npm", ["view", `${name}@${version}`, "version"])
const alreadyPublished = known.status === 0 && known.stdout.trim().length > 0
if (!dryRun && alreadyPublished) {
  console.log(`[publish] ${name}@${version} is already on the registry — nothing to do`)
  process.exit(0)
}

const out = mkdtempSync(join(tmpdir(), "patcms-publish-"))
try {
  run("pnpm", ["--filter", PACKAGE, "pack", "--pack-destination", out])
  const tarball = readdirSync(out).find((entry) => entry.endsWith(".tgz"))
  if (tarball === undefined) fail("pnpm pack produced no tarball")

  if (dryRun && alreadyPublished) {
    // npm refuses to dry-run over a published version; the pack above is the
    // part worth exercising locally.
    console.log(`[publish] dry run OK — ${name}@${version} is already published; tarball packed`)
  } else {
    const args = [
      "publish",
      join(out, tarball),
      "--access",
      "public",
      ...(dryRun ? ["--dry-run"] : []),
    ]
    run("npm", args)

    if (dryRun) {
      console.log(`[publish] dry run OK — ${name}@${version} was not published`)
    } else {
      writeFileSync(
        SUMMARY,
        `${JSON.stringify({ publishedPackages: [{ name, version }] }, null, 2)}\n`,
      )
      console.log(`[publish] published ${name}@${version}`)
    }
  }
} finally {
  rmSync(out, { recursive: true, force: true })
}
