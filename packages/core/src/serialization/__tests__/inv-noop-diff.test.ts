/// <reference types="node" />
import { readFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { buildSpec, createHarness } from "../../__tests__/support/fake-github-fetch"
import { FixtureBackend } from "../../__tests__/support/reference-fixture-backend"
import { runSave } from "../../pipeline/save-driver"
import {
  documentsCanonicallyEqual,
  parseJsonDocument,
  serializeDocument,
} from "../../serialization"

const HERE = dirname(fileURLToPath(import.meta.url))
const FIXTURE_ROOT = resolve(HERE, "../../../../..", "playground", "fixtures", "repo")

const manifest = JSON.parse(readFileSync(join(FIXTURE_ROOT, "manifest.json"), "utf8")) as {
  files: readonly { path: string }[]
}
const jsonPaths = manifest.files
  .map((entry) => entry.path)
  .filter((path) => path.startsWith("src/content/") && path.endsWith(".json"))

describe("INV-S02 P1 scope: serializer identity + CRLF + empty tree diff", () => {
  it("round-trips every mirrored JSON document byte-for-byte", () => {
    expect(jsonPaths.length).toBe(20) // 14 yve content docs + 6 drift fixtures
    for (const path of jsonPaths) {
      const raw = readFileSync(join(FIXTURE_ROOT, path), "utf8")
      const parsed = parseJsonDocument(raw)
      expect(parsed.ok).toBe(true)
      if (!parsed.ok) continue
      expect(serializeDocument(parsed.document, parsed.document.value)).toBe(raw)
    }
  })

  it("treats CRLF and LF variants as canonically equal without reflowing", () => {
    const raw = readFileSync(join(FIXTURE_ROOT, jsonPaths[0] as string), "utf8")
    const crlf = raw.replace(/\n/g, "\r\n")
    expect(documentsCanonicallyEqual(raw, crlf)).toBe(true)
    const parsed = parseJsonDocument(crlf)
    expect(parsed.ok).toBe(true)
    if (parsed.ok) expect(serializeDocument(parsed.document, parsed.document.value)).toBe(crlf)
  })

  it("returns an empty tree diff for identical commits (backend contract)", async () => {
    const head = "a".repeat(40)
    const backend = new FixtureBackend({ headSha: head, treeSha: "b".repeat(40), files: new Map() })
    const diff = await backend.listChangedFiles("fixture", head, head)
    expect(diff.size).toBe(0)
  })
})

describe("INV-S02 C.1 scope: zero-diff drive skips the save entirely (L1)", () => {
  it("no-op changesets end as noop verdicts with ZERO network writes", async () => {
    const spec = await buildSpec([
      ["src/content/site.json", '{\n  "title": "site"\n}\n'],
      ["src/content/products/iris.json", '{\n  "title": "iris"\n}\n'],
    ])
    const harness = createHarness(spec)
    const verdict = await runSave({
      backend: harness.backend,
      branch: "fixture-branch",
      // Byte-identical update + delete of a path that never existed.
      changes: {
        updates: [
          {
            path: "src/content/site.json",
            bytes: new TextEncoder().encode('{\n  "title": "site"\n}\n'),
          },
        ],
        deletes: ["src/content/never-existed.json"],
      },
    })
    expect(verdict.kind).toBe("noop")
    // Zero WRITES — the ref/tree reads the fresh-binding rule requires stay.
    expect(harness.server.log.some((event) => event.method !== "GET")).toBe(false)
    expect(harness.server.ref("fixture-branch")).toBe(spec.headSha)
  })

  it("an equal-content tree overlay reproduces the base tree sha exactly", async () => {
    const spec = await buildSpec([["src/content/site.json", '{\n  "title": "site"\n}\n']])
    const harness = createHarness(spec)
    // Direct primitive question: overlaying identical content onto the seeded
    // tree yields the SAME tree sha (content addressing) — the exact equality
    // the driver-level zero-diff gate stands in for.
    const payload = await harness.backend.commitChanges(
      {
        updates: [
          {
            path: "src/content/site.json",
            bytes: new TextEncoder().encode('{\n  "title": "site"\n}\n'),
          },
        ],
      },
      spec.headSha,
      "quiet-branch",
    )
    expect(payload.treeSha).toBe(spec.treeSha)
    // The backend is a primitive — the diff proves the commit was a no-op.
    const diff = await harness.backend.listChangedFiles(
      "quiet-branch",
      spec.headSha,
      payload.commitSha,
    )
    expect(diff.size).toBe(0)
  })
})
