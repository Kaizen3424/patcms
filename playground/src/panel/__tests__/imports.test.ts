/**
 * Import-rule guard — the whole point of the example panel is that a host
 * needs only `patcms`, `patcms/web`, and React. Every non-test file under
 * `src/panel/` may import those plus relative modules; anything else fails
 * the suite. Test files are exempt (they may use vitest and the fake).
 */

import { readdirSync, readFileSync, statSync } from "node:fs"
import { dirname, join, relative } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

const PANEL_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const ALLOWED = /^(patcms(\/web)?|react(\/[a-z-]+)?|react-dom(\/[a-z-]+)?)$/
const SKIP_DIRS = new Set(["__tests__"])

function collect(dir: string, into: string[]): void {
  for (const entry of readdirSync(dir)) {
    const absolute = join(dir, entry)
    if (statSync(absolute).isDirectory()) {
      if (SKIP_DIRS.has(entry)) continue
      collect(absolute, into)
      continue
    }
    if (/\.(ts|tsx)$/.test(entry)) into.push(absolute)
  }
}

const sources: string[] = []
collect(PANEL_ROOT, sources)

const IMPORT_PATTERN = /(?:import|export)\s[^;]*?from\s*["']([^"']+)["']/g

describe("panel import rule", () => {
  it("finds panel sources to scan", () => {
    expect(sources.length).toBeGreaterThan(5)
  })

  it("imports only patcms, patcms/web, react, react-dom, or relative modules", () => {
    const violations: string[] = []
    for (const file of sources) {
      const text = readFileSync(file, "utf8")
      for (const match of text.matchAll(IMPORT_PATTERN)) {
        const specifier = match[1] ?? ""
        if (specifier.startsWith(".")) continue
        if (ALLOWED.test(specifier)) continue
        violations.push(`${relative(PANEL_ROOT, file)}: ${specifier}`)
      }
    }
    expect(violations).toEqual([])
  })
})
