#!/usr/bin/env node
/**
 * docs:check — keep the documentation honest.
 *
 * 1. Typechecks every TypeScript snippet in docs/, both READMEs, and the agent
 *    skill against the PUBLISHED type surface (packages/core/dist-types — the
 *    same files `publishConfig` maps at publish time). Requires `pnpm -r build`
 *    first.
 * 2. Verifies every relative markdown link in those files resolves.
 *
 * Fence contract (documented in docs/README.md):
 *   ```ts file="name.ts"  → module registered under that name; later blocks in
 *                           the SAME markdown file may import it by relative path
 *   ```ts                 → standalone module (own imports, compiles alone)
 *   ```ts continue        → appended to the previous standalone module
 *   any other language    → ignored
 *
 * Exit codes: 0 clean, 1 any snippet type error or broken link.
 */
import { spawnSync } from "node:child_process"
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { dirname, isAbsolute, join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const SCRATCH = join(ROOT, "playground", ".docs-check")
const DIST_TYPES = join(ROOT, "packages", "core", "dist-types")

if (!existsSync(join(DIST_TYPES, "index.d.ts"))) {
  console.error("[docs-check] packages/core/dist-types is missing — run `pnpm -r build` first.")
  process.exit(1)
}

// ---- collect markdown sources --------------------------------------------

function walkMarkdown(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walkMarkdown(full, out)
    else if (entry.endsWith(".md")) out.push(full)
  }
  return out
}

const sources = [
  ...walkMarkdown(join(ROOT, "docs")),
  join(ROOT, "README.md"),
  join(ROOT, "packages", "core", "README.md"),
]
const skillDir = join(ROOT, ".agents", "skills")
if (existsSync(skillDir)) sources.push(...walkMarkdown(skillDir))

function rel(p) {
  return relative(ROOT, p).replaceAll("\\", "/")
}

// ---- parse fenced blocks --------------------------------------------------

/**
 * Parses one markdown file into modules:
 *   { file, code, mdLine } — `file` is the scratch filename, `mdLine` the
 *   1-based markdown line of the module's first content line (for mapping
 *   tsc errors back). Named (`file="…"`) modules accumulate across blocks.
 */
function parseBlocks(mdPath, lines) {
  const modules = []
  let unnamedCount = 0
  let current = null
  let inBlock = false
  let blockLang = ""

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!inBlock) {
      const open = /^```(\S*)\s*(.*)$/.exec(line)
      if (open) {
        inBlock = true
        blockLang = open[1]
        const attrs = open[2] ?? ""
        const startLine = i + 2 // 1-based line of the first content line
        current = null
        if (blockLang === "ts" || blockLang === "typescript") {
          const fileAttr = /file="([^"]+)"/.exec(attrs)
          if (fileAttr) {
            let named = modules.find((m) => m.file === fileAttr[1])
            if (!named) {
              named = { file: fileAttr[1], code: "", mdLine: startLine }
              modules.push(named)
            }
            current = named
          } else if (/\bcontinue\b/.test(attrs)) {
            current = modules.findLast((m) => !m.isNamed) ?? null
            if (!current) {
              console.error(
                `[docs-check] ${rel(mdPath)}:${i + 1}: "continue" fence with no previous standalone \`\`\`ts block`,
              )
              process.exitCode = 1
            }
          } else {
            unnamedCount++
            current = {
              file: `index-${unnamedCount}.ts`,
              code: "",
              mdLine: startLine,
              isNamed: false,
            }
            modules.push(current)
          }
        }
      }
      continue
    }
    if (/^```\s*$/.test(line)) {
      inBlock = false
      current = null
      continue
    }
    if (current) current.code += (current.code ? "\n" : "") + line
  }
  if (inBlock) console.error(`[docs-check] ${rel(mdPath)}: unterminated code fence`)
  return modules
}

// ---- build the scratch project --------------------------------------------

rmSync(SCRATCH, { recursive: true, force: true })
mkdirSync(SCRATCH, { recursive: true })

/** scratch file → { mdPath, mdLine } for error mapping. */
const registry = new Map()
let moduleCount = 0

for (const mdPath of sources) {
  const lines = readFileSync(mdPath, "utf8").split(/\r?\n/)
  const modules = parseBlocks(mdPath, lines)
  if (modules.length === 0) continue

  const dir = join(SCRATCH, rel(mdPath).replaceAll(/[^\w.-]/g, "-"))
  mkdirSync(dir, { recursive: true })
  for (const mod of modules) {
    const file = join(dir, mod.file)
    writeFileSync(file, mod.code)
    registry.set(file, { mdPath, mdLine: mod.mdLine })
    moduleCount++
  }
}

writeFileSync(
  join(SCRATCH, "tsconfig.json"),
  JSON.stringify(
    {
      compilerOptions: {
        strict: true,
        noEmit: true,
        skipLibCheck: true,
        target: "ES2022",
        module: "ESNext",
        moduleResolution: "Bundler",
        lib: ["ES2022", "DOM", "DOM.Iterable"],
        types: [],
        paths: {
          patcms: ["../../packages/core/dist-types/index.d.ts"],
          "patcms/advanced": ["../../packages/core/dist-types/advanced.d.ts"],
          "patcms/web": ["../../packages/core/dist-types/web/index.d.ts"],
        },
      },
      include: ["**/*.ts"],
    },
    null,
    2,
  ),
)

// ---- run tsc --------------------------------------------------------------

console.log(
  `[docs-check] typechecking ${moduleCount} snippet module(s) from ${sources.length} markdown file(s)…`,
)
const tsc = spawnSync("pnpm exec tsc -p tsconfig.json", {
  cwd: SCRATCH,
  shell: true,
  encoding: "utf8",
})
const output = `${tsc.stdout ?? ""}${tsc.stderr ?? ""}`

if (tsc.error) {
  console.error(`[docs-check] failed to run tsc: ${tsc.error.message}`)
  process.exit(1)
}

let snippetErrors = 0
const errorLine = /^(.+?)\((\d+),(\d+)\): (error TS\d+: .+)$/
for (const raw of output.split(/\r?\n/)) {
  const match = errorLine.exec(raw.trim())
  if (!match) continue
  const [, file, line, , message] = match
  const candidates = [resolve(file), resolve(SCRATCH, file)]
  const source = candidates.map((c) => registry.get(c)).find(Boolean)
  if (source) {
    const mdLines = readFileSync(source.mdPath, "utf8").split(/\r?\n/)
    const mdLine = source.mdLine + Number(line) - 1
    console.error(`[docs-check] ${rel(source.mdPath)}:${mdLine}: ${message}`)
    console.error(`[docs-check]   snippet: ${mdLines[mdLine - 1]?.trim()}`)
  } else {
    console.error(`[docs-check] ${raw.trim()}`)
  }
  snippetErrors++
}

if (tsc.status !== 0 && snippetErrors === 0) {
  console.error(`[docs-check] tsc exited ${tsc.status} without parseable errors:`)
  console.error(output.trim())
  process.exit(1)
}

if (snippetErrors > 0 && /Cannot find module/.test(output)) {
  console.error(
    '[docs-check] hint: relative imports only resolve to `file="name.ts"` blocks in the same markdown file.',
  )
}

// ---- link check -----------------------------------------------------------

let linkErrors = 0
let linkCount = 0
for (const mdPath of sources) {
  const text = readFileSync(mdPath, "utf8")
  const base = dirname(mdPath)
  for (const match of text.matchAll(/\]\(([^)\s]+)\)/g)) {
    const target = match[1]
    if (/^(https?:|mailto:|#)/.test(target)) continue
    const [pathPart] = target.split("#")
    if (pathPart === "") continue
    linkCount++
    const resolved = isAbsolute(pathPart) ? pathPart : resolve(base, pathPart)
    if (!existsSync(resolved)) {
      console.error(`[docs-check] broken link in ${rel(mdPath)}: ${target}`)
      linkErrors++
    }
  }
}

// ---- verdict --------------------------------------------------------------

if (snippetErrors > 0 || linkErrors > 0) {
  console.error(
    `[docs-check] FAILED — ${snippetErrors} snippet error(s), ${linkErrors} broken link(s)`,
  )
  process.exit(1)
}
console.log(
  `[docs-check] OK — ${moduleCount} snippet module(s) typechecked, ${linkCount} relative link(s) resolved`,
)
