/// <reference types="node" />
import { readdirSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

/**
 * INV-S05 repo-wide ban gate. Test files are excluded because they intentionally
 * contain hostile payloads; comment-only lines are excluded because docs name the
 * bans. Everything else must stay clean.
 */
const ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "../../../../..")

const BANNED: readonly { readonly name: string; readonly pattern: RegExp }[] = [
  { name: "dangerouslySetInnerHTML", pattern: /\bdangerouslySetInnerHTML\b/ },
  { name: "innerHTML assignment", pattern: /\binnerHTML\s*=/ },
  { name: "eval", pattern: /\beval\s*\(/ },
  { name: "new Function", pattern: /\bnew\s+Function\s*\(/ },
  { name: "Object.assign", pattern: /\bObject\.assign\s*\(/ },
  { name: "raw.githubusercontent.com", pattern: /raw\.githubusercontent\.com/ },
  { name: "force:true", pattern: /\bforce\s*:\s*true\b/ },
  { name: "token in URL", pattern: /[?&]token=/i },
]

const SCAN_ROOTS = ["packages/core/src", "packages/admin/src", "playground/src"] as const

describe("INV-S05 repo-wide unsafe-pattern ban", () => {
  for (const root of SCAN_ROOTS) {
    it(`keeps ${root} free of banned sinks/merges`, () => {
      const hits: string[] = []
      for (const file of walk(resolve(ROOT, root))) {
        if (!/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(file)) continue
        if (file.includes("__tests__") || /\.(test|spec)\./.test(file)) continue
        const lines = readFileSync(file, "utf8").split(/\r?\n/)
        lines.forEach((line, index) => {
          const trimmed = line.trim()
          if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*"))
            return
          for (const ban of BANNED) {
            if (ban.pattern.test(line)) {
              hits.push(`${file.slice(ROOT.length + 1)}:${index + 1} ${ban.name}`)
            }
          }
        })
      }
      expect(hits).toEqual([])
    })
  }
})

function walk(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist" || entry.name === "dist-types") {
        continue
      }
      out.push(...walk(full))
    } else if (entry.isFile()) {
      out.push(full)
    }
  }
  return out
}
