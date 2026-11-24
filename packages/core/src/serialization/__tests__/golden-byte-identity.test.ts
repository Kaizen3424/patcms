/// <reference types="node" />

import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import {
  canonicalJson,
  documentsCanonicallyEqual,
  normalizeNewlines,
  parseJsonDocument,
  serializeDocument,
} from "../../serialization"

const HERE = dirname(fileURLToPath(import.meta.url))
const FIXTURE_ROOT = resolve(HERE, "../../../../..", "playground", "fixtures", "repo")

interface ManifestEntry {
  readonly path: string
  readonly origin: "yve" | "drift"
  readonly bytes: number
  readonly sha256: string
}

const manifest = JSON.parse(readFileSync(join(FIXTURE_ROOT, "manifest.json"), "utf8")) as {
  readonly files: readonly ManifestEntry[]
}
const contentFiles = manifest.files.filter(
  (entry) => entry.path.startsWith("src/content/") && entry.path.endsWith(".json"),
)

describe("INV-S01 untouched-file byte identity", () => {
  it("pins the yve mirror to 14 content files + 24 images", () => {
    const yve = manifest.files.filter((entry) => entry.origin === "yve")
    expect(yve.filter((entry) => entry.path.endsWith(".json"))).toHaveLength(14)
    expect(yve.filter((entry) => entry.path.startsWith("public/images/"))).toHaveLength(24)
    expect(manifest.files.filter((entry) => entry.origin === "drift")).toHaveLength(6)
  })

  for (const entry of contentFiles) {
    it(`serialize(parse(raw)) === raw: ${entry.path}`, () => {
      const bytes = readFileSync(join(FIXTURE_ROOT, entry.path))
      expect(bytes.length).toBe(entry.bytes)
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(entry.sha256)

      const raw = bytes.toString("utf8")
      const parsed = parseJsonDocument(raw)
      expect(parsed.ok).toBe(true)
      if (!parsed.ok) return

      expect(serializeDocument(parsed.document)).toBe(raw)
      expect(serializeDocument(parsed.document, parsed.document.value)).toBe(raw)
      expect(raw.endsWith("\n")).toBe(true)
      expect(raw.includes("\r\n")).toBe(false)
    })
  }
})

describe("INV-S02 P1 serializer identity + CRLF canon", () => {
  it("keeps CRLF variants byte-identical and canonically equal", () => {
    const lf = readFileSync(join(FIXTURE_ROOT, "src/content/products/iris-no-7.json"), "utf8")
    const crlf = lf.replace(/\n/g, "\r\n")
    const parsed = parseJsonDocument(crlf)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return

    expect(parsed.document.newline).toBe("crlf")
    expect(serializeDocument(parsed.document, parsed.document.value)).toBe(crlf)
    expect(documentsCanonicallyEqual(lf, crlf)).toBe(true)
    expect(normalizeNewlines(crlf)).toBe(lf)
  })

  it("prints edited documents canonically (2-space, LF, trailing newline)", () => {
    const raw = readFileSync(join(FIXTURE_ROOT, "src/content/products/iris-no-7.json"), "utf8")
    const parsed = parseJsonDocument(raw)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return

    const next = { ...(parsed.document.value as Record<string, unknown>), title: "Iris No. 8" }
    const output = serializeDocument(parsed.document, next)
    expect(output).toBe(canonicalJson(next))
    expect(output.endsWith("\n")).toBe(true)
    expect(output.includes("\r\n")).toBe(false)
    expect(output).toBe(`${JSON.stringify(next, null, 2)}\n`)
  })

  it("is deterministic for new documents and preserves author key order", () => {
    const value = { z: 1, a: { second: true, first: "x" }, list: [1, 2] }
    const output = canonicalJson(value)
    expect(output).toBe(
      '{\n  "z": 1,\n  "a": {\n    "second": true,\n    "first": "x"\n  },\n  "list": [\n    1,\n    2\n  ]\n}\n',
    )
  })
})
