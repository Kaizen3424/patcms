import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { allCopyStrings } from "../copy"
import { MESSAGE_MAP_COPY } from "../message-map"

const BANNED_PATTERNS = [
  { name: "build", pattern: /\b(build|builds|building|built)\b/i },
  { name: "commit", pattern: /\b(commit|commits|committed|committing)\b/i },
  { name: "deploy", pattern: /\b(deploy|deploys|deployed|deploying|deployment)\b/i },
  { name: "token", pattern: /\b(token|tokens)\b/i },
  { name: "slug", pattern: /\b(slug|slugs)\b/i },
  { name: "repository", pattern: /\b(repository|repositories|repo|repos)\b/i },
  { name: "draft", pattern: /\b(draft|drafts)\b/i },
  { name: "someone", pattern: /\b(someone)\b/i },
  { name: "conflict", pattern: /\b(conflict|conflicts)\b/i },
]

function findBannedWords(text: string): readonly string[] {
  const matches: string[] = []
  for (const { name, pattern } of BANNED_PATTERNS) {
    if (pattern.test(text)) {
      matches.push(name)
    }
  }
  return matches
}

function getAllTsxFiles(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  const files: string[] = []

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name !== "__tests__" && entry.name !== "node_modules") {
        files.push(...getAllTsxFiles(fullPath))
      }
    } else if (entry.isFile() && entry.name.endsWith(".tsx") && !entry.name.endsWith(".test.tsx")) {
      files.push(fullPath)
    }
  }

  return files
}

describe("copy ban-list scanner (P5.6)", () => {
  it("Prong A: all registered copy strings contain zero banned words", () => {
    const strings = [...allCopyStrings(), ...Object.values(MESSAGE_MAP_COPY)]
    const violations: { text: string; banned: string }[] = []

    for (const text of strings) {
      const banned = findBannedWords(text)
      for (const b of banned) {
        violations.push({ text, banned: b })
      }
    }

    expect(violations).toEqual([])
  })

  it("Prong B: scan of all visible TSX JSXText and visible attributes finds zero banned words", () => {
    const srcDir = path.resolve(__dirname, "../../")
    const tsxFiles = getAllTsxFiles(srcDir)
    expect(tsxFiles.length).toBeGreaterThan(5)

    const violations: { file: string; line: number; text: string; banned: string }[] = []

    for (const filePath of tsxFiles) {
      const content = fs.readFileSync(filePath, "utf-8")
      const lines = content.split(/\r?\n/)
      const relFile = path.relative(srcDir, filePath)

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i] ?? ""
        // Ignore imports, comments, type annotations
        if (
          line.trim().startsWith("import ") ||
          line.trim().startsWith("//") ||
          line.trim().startsWith("/*") ||
          line.trim().startsWith("*")
        ) {
          continue
        }

        // 1. Check visible attributes: placeholder, title, aria-label, alt
        const attrMatches = line.matchAll(
          /(?:placeholder|title|aria-label|alt)=["'`]([^"'`]+)["'`]/g,
        )
        for (const m of attrMatches) {
          const val = m[1]?.trim()
          if (val) {
            const banned = findBannedWords(val)
            for (const b of banned) {
              violations.push({ file: relFile, line: i + 1, text: val, banned: b })
            }
          }
        }

        // 2. Check JSXText: text between > and <
        const jsxTextMatches = line.matchAll(/>([^<{}]+)</g)
        for (const m of jsxTextMatches) {
          const val = m[1]?.trim()
          // Ignore whitespace, single symbols, entities
          if (
            val &&
            !/^[0-9\s.,/\\;:!@#$%^&*()_+\-=[\]{}|~`'"]+$/.test(val) &&
            !val.startsWith("&")
          ) {
            const banned = findBannedWords(val)
            for (const b of banned) {
              violations.push({ file: relFile, line: i + 1, text: val, banned: b })
            }
          }
        }
      }
    }

    expect(violations).toEqual([])
  })
})
