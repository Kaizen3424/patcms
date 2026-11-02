#!/usr/bin/env node
/**
 * Bun consumer smoke — proves the package a bun user will `bun add` installs,
 * imports, constructs, and typechecks under bun's toolchain.
 *
 * Packs the core tarball (after `tsup` builds dist and `tsc -b` emits dist-types —
 * the published types point there), installs it into a scratch project with bun, runs a consumer script that constructs
 * `createCMS()` from the real config DSL, and typechecks that script with
 * `moduleResolution: "bundler"` — the resolution bun users' TypeScript uses.
 * Bun reads the npm registry, so this is the same artifact npm serves; there is
 * no separate bun publish.
 *
 * Usage: pnpm run bun:smoke   (bun must be on PATH)
 */
import { execSync, spawnSync } from "node:child_process"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, "..")
const CORE = join(ROOT, "packages", "core")
const SCRATCH = join(ROOT, ".bun-smoke")

const SMOKE = `import { createCMS, defineCollection, defineConfig, object, string } from "patcms"
import { runSave } from "patcms/advanced"

const products = defineCollection({
  name: "products",
  label: "Products",
  folder: "content/products",
  identifierField: "title",
  schema: object({
    label: "Product",
    fields: {
      title: string({ label: "Title" }),
    },
  }),
})

const config = defineConfig({
  media: { folder: "public/images", publicFolder: "/images" },
  collections: [products],
})

// No token at construct — the docs quickstart shape. Nothing here may touch
// the network; bun smoke proves install + import + construct, not transport.
const cms = createCMS({
  config,
  repository: { owner: "smoke", repo: "smoke", branch: "main" },
})

if (typeof cms.entries.list !== "function") throw new Error("entries API missing")
if (typeof runSave !== "function") throw new Error("advanced runSave missing")
console.log("ok")
`

function fail(message) {
  console.error(`[bun-smoke] FAIL: ${message}`)
  process.exit(1)
}

function run(command, args, options) {
  const result = spawnSync(command, args, { encoding: "utf8", ...options })
  if (result.status !== 0) {
    fail(`${command} ${args.join(" ")} failed:\n${result.stderr || result.stdout}`)
  }
  return result
}

function main() {
  if (spawnSync("bun", ["--version"], { encoding: "utf8" }).status !== 0) {
    fail("bun is not on PATH (https://bun.sh)")
  }

  console.log("[bun-smoke] Building core (tsup → dist)...")
  execSync("pnpm run build", { cwd: CORE, stdio: "pipe" })
  console.log("[bun-smoke] Emitting dist-types (tsc -b — the published types point there)...")
  execSync("pnpm run typecheck", { cwd: CORE, stdio: "pipe" })

  console.log("[bun-smoke] Packing...")
  const packOutput = execSync("pnpm pack --pack-destination .", {
    cwd: CORE,
    encoding: "utf8",
  })
  const tgzName = packOutput.trim().split("\n").pop()
  const tgzPath = join(CORE, tgzName)

  try {
    rmSync(SCRATCH, { recursive: true, force: true })
    mkdirSync(SCRATCH, { recursive: true })
    writeFileSync(
      join(SCRATCH, "package.json"),
      `${JSON.stringify({ name: "patcms-bun-smoke", private: true, type: "module" }, null, 2)}\n`,
    )
    writeFileSync(join(SCRATCH, "smoke.ts"), SMOKE)
    writeFileSync(
      join(SCRATCH, "tsconfig.json"),
      `${JSON.stringify(
        {
          compilerOptions: {
            strict: true,
            noEmit: true,
            skipLibCheck: true,
            module: "esnext",
            moduleResolution: "bundler",
            target: "esnext",
          },
          include: ["smoke.ts"],
        },
        null,
        2,
      )}\n`,
    )

    console.log("[bun-smoke] bun add <tarball>...")
    run("bun", ["add", tgzPath], { cwd: SCRATCH })

    console.log("[bun-smoke] bun smoke.ts...")
    const smoke = run("bun", ["smoke.ts"], { cwd: SCRATCH })
    if (!smoke.stdout.includes("ok")) fail(`smoke script did not complete: ${smoke.stdout}`)

    console.log("[bun-smoke] tsc --noEmit (moduleResolution: bundler)...")
    const nodeRequire = createRequire(join(ROOT, "package.json"))
    const typescriptDir = dirname(nodeRequire.resolve("typescript/package.json"))
    run(process.execPath, [join(typescriptDir, "bin", "tsc"), "-p", "tsconfig.json"], {
      cwd: SCRATCH,
    })

    console.log("[bun-smoke] ALL CHECKS PASSED")
  } finally {
    rmSync(SCRATCH, { recursive: true, force: true })
    rmSync(tgzPath, { force: true })
  }
}

try {
  main()
} catch (error) {
  fail(error.message)
}
