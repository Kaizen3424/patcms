/// <reference types="node" />
import { readdirSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { encodeBranch } from "../../backends/github"

const ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "../../..")
const SCAN_ROOTS = ["src/backend", "src/backends", "src/pipeline", "src/status"] as const

describe("INV-P14 branch parameter law", () => {
  it("has zero hard-coded main literals in backend/pipeline source", () => {
    const hits: string[] = []
    for (const root of SCAN_ROOTS) {
      let files: string[] = []
      try {
        files = walk(resolve(ROOT, root))
      } catch {
        continue
      }
      for (const file of files) {
        if (!/\.(ts|tsx|js|mjs)$/.test(file)) continue
        if (file.includes("__tests__") || /\.(test|spec)\./.test(file)) continue
        const lines = readFileSync(file, "utf8").split(/\r?\n/)
        lines.forEach((line, index) => {
          const trimmed = line.trim()
          if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*"))
            return
          if (/(["'`])main\1/.test(line) || /\brefs\/heads\/main\b/.test(line)) {
            hits.push(`${file.slice(ROOT.length + 1)}:${index + 1}`)
          }
        })
      }
    }
    expect(hits).toEqual([])
  })

  it("URL-encodes every branch segment including +", () => {
    expect(encodeBranch("main")).toBe("main")
    expect(encodeBranch("feature/a+b")).toBe("feature/a%2Bb")
    expect(encodeBranch("release/2026+hotfix")).toBe("release/2026%2Bhotfix")
    expect(encodeBranch("dependabot/npm_and_yarn/pkg-1.2.3")).toBe(
      "dependabot/npm_and_yarn/pkg-1.2.3",
    )
  })
})

function walk(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist" || entry.name === "dist-types")
        continue
      out.push(...walk(full))
    } else if (entry.isFile()) {
      out.push(full)
    }
  }
  return out
}
