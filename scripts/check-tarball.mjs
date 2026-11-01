#!/usr/bin/env node
/**
 * Tarball hygiene check — proves the package somebody will `npm install`
 * contains only the declared `files`, no test doubles or fixtures, and that
 * all three entry points (`patcms`, `patcms/advanced`, `patcms/web`) resolve
 * against the *published* (publishConfig) wiring, not the workspace `exports`.
 *
 * Usage: node scripts/check-tarball.mjs
 */
import { execSync, spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, "..")
const CORE = join(ROOT, "packages", "core")
const SCRATCH = join(ROOT, ".tarball-check")

const FORBIDDEN_SEGMENTS = ["src/", "__tests__/", "test/", "fixtures/", "fake-github"]

function fail(message) {
  console.error(`[check-tarball] FAIL: ${message}`)
  process.exit(1)
}

/** Directory symlink that also works unprivileged on Windows. */
function symlinkOrJunction(target, path) {
  try {
    mkdirSync(dirname(path), { recursive: true })
    symlinkSync(target, path, "junction")
  } catch (error) {
    if (error.code !== "EEXIST") throw error
  }
}

function main() {
  console.log("[check-tarball] Building core...")
  execSync("pnpm run build", { cwd: CORE, stdio: "pipe" })

  console.log("[check-tarball] Packing...")
  const packOutput = execSync("pnpm pack --pack-destination .", {
    cwd: CORE,
    encoding: "utf8",
  })
  const tgzName = packOutput.trim().split("\n").pop()
  const tgzPath = join(CORE, tgzName)

  const list = spawnSync("tar", ["-tzf", tgzPath], { encoding: "utf8" })
  if (list.status !== 0) fail(`tar cannot read tarball: ${list.stderr}`)
  const entries = list.stdout
    .split("\n")
    .filter(Boolean)
    .map((entry) => entry.replace(/^package\//, ""))

  const bad = entries.filter((entry) => {
    if (entry.endsWith(".map")) return true
    return FORBIDDEN_SEGMENTS.some((segment) => entry.startsWith(segment))
  })
  if (bad.length > 0) fail(`forbidden entries:\n  ${bad.join("\n  ")}`)
  console.log("[check-tarball] no src/tests/fixtures/maps in tarball ✓")

  const distJs = entries.filter((entry) => entry.endsWith(".js"))
  for (const entry of distJs) {
    const content = execSync(`tar -xOf ${JSON.stringify(tgzPath)} package/${entry}`, {
      encoding: "utf8",
    })
    if (content.includes("msw")) fail(`dist file ${entry} references msw`)
  }
  console.log("[check-tarball] dist is free of msw ✓")

  rmSync(SCRATCH, { recursive: true, force: true })
  mkdirSync(SCRATCH, { recursive: true })
  spawnSync("tar", ["-xzf", tgzPath, "-C", SCRATCH], { stdio: "pipe" })
  rmSync(tgzPath, { force: true })

  const pkgDir = join(SCRATCH, "package")
  const pkgJson = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8"))
  console.log(`[check-tarball] packed version ${pkgJson.version}`)

  // npm applies publishConfig at publish time; emulate it so the resolution
  // check exercises the same wiring a consumer sees.
  const { publishConfig } = pkgJson
  for (const key of ["main", "module", "types", "exports"]) {
    if (publishConfig[key] !== undefined) pkgJson[key] = publishConfig[key]
  }
  writeFileSync(join(pkgDir, "package.json"), `${JSON.stringify(pkgJson, null, 2)}\n`)

  const expectedTypes = [
    "dist-types/index.d.ts",
    "dist-types/advanced.d.ts",
    "dist-types/web/index.d.ts",
  ].map((relative) => join(pkgDir, relative))
  for (const types of expectedTypes) {
    if (!existsSync(types)) fail(`missing published types file ${types.replace(pkgDir, "")}`)
  }
  console.log("[check-tarball] dist-types files present ✓")

  const probe = [
    'import * as main from "patcms"',
    'import * as advanced from "patcms/advanced"',
    'import * as web from "patcms/web"',
    'console.log("main " + Object.keys(main).length + " advanced " + Object.keys(advanced).length + " web " + Object.keys(web).length)',
    'if (typeof main.createCMS !== "function") throw new Error("patcms.createCMS missing")',
    'if (typeof advanced.runSave !== "function") throw new Error("patcms/advanced runSave missing")',
    'if (typeof web.createIdbDraftStore !== "function") throw new Error("patcms/web draft store missing")',
    'console.log("ok")',
    "",
  ].join("\n")
  writeFileSync(join(pkgDir, ".entry-probe.mjs"), probe)
  // The probe imports the package by name (self-reference), so its runtime
  // dependencies must resolve too. Link the workspace's installed copies —
  // a real consumer gets them from the registry; this keeps the check offline.
  for (const [name] of Object.entries(pkgJson.dependencies ?? {})) {
    const from = join(CORE, "node_modules", name)
    if (!existsSync(from)) fail(`dependency ${name} is not installed in the workspace`)
    const to = join(pkgDir, "node_modules", name)
    mkdirSync(join(pkgDir, "node_modules"), { recursive: true })
    symlinkOrJunction(from, to)
  }
  const resolved = spawnSync("node", [".entry-probe.mjs"], { cwd: pkgDir, encoding: "utf8" })
  if (resolved.status !== 0) fail(`entry resolution failed: ${resolved.stderr || resolved.stdout}`)
  if (!resolved.stdout.includes("ok")) fail(`entry probe did not complete: ${resolved.stdout}`)
  console.log(
    `[check-tarball] all three entries resolve ✓ (${resolved.stdout.trim().split("\n")[0]})`,
  )

  rmSync(SCRATCH, { recursive: true, force: true })
  console.log("[check-tarball] ALL CHECKS PASSED")
}

try {
  main()
} catch (error) {
  fail(error.message)
}
