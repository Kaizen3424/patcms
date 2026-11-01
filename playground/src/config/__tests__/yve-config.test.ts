/// <reference types="node" />
import { readFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import type { FieldDescriptor, MediaFolders } from "patcms/advanced"
import { parseAdminConfig, parseEntry, validateEntryForSave } from "patcms/advanced"
import { describe, expect, it } from "vitest"
import { yveAdminConfig } from "../yve"

const HERE = dirname(fileURLToPath(import.meta.url))
const FIXTURE_ROOT = resolve(HERE, "..", "..", "..", "fixtures", "repo")
const manifest = JSON.parse(readFileSync(join(FIXTURE_ROOT, "manifest.json"), "utf8")) as {
  files: readonly { path: string; origin: "yve" | "drift" }[]
}

interface EntryShape {
  readonly fields: readonly FieldDescriptor[]
  readonly media: MediaFolders
}

const shapes = new Map<string, EntryShape>()
for (const collection of yveAdminConfig.collections) {
  if (collection.kind === "divider") continue
  if (collection.kind === "folder") {
    const prefix = `${collection.folder.replace(/\/+$/, "")}/`
    for (const file of manifest.files) {
      if (!file.path.startsWith(prefix) || !file.path.endsWith(".json")) continue
      if (file.path.slice(prefix.length).includes("/")) continue
      shapes.set(file.path, {
        fields: collection.fields,
        media: collection.media ?? yveAdminConfig.media,
      })
    }
  } else {
    for (const entry of collection.files) {
      shapes.set(entry.file, {
        fields: entry.fields,
        media: collection.media ?? yveAdminConfig.media,
      })
    }
  }
}

describe("yve read-side config against the generated fixture mirror", () => {
  it("passes the strict admin-config schema", () => {
    const parsed = parseAdminConfig(yveAdminConfig)
    expect(parsed.schemaVersion).toBe(yveAdminConfig.schemaVersion)
    expect(parsed.collections.length).toBe(yveAdminConfig.collections.length)
  })

  it("validates every clean yve entry and surfaces every drift fixture", async () => {
    const jsonFiles = manifest.files.filter(
      (file) => file.path.startsWith("src/content/") && file.path.endsWith(".json"),
    )
    expect(jsonFiles.length).toBe(20)

    for (const file of jsonFiles) {
      const shape = shapes.get(file.path)
      expect(shape, `missing config shape for ${file.path}`).toBeDefined()
      if (shape === undefined) continue
      const raw = JSON.parse(readFileSync(join(FIXTURE_ROOT, file.path), "utf8")) as unknown
      const parsed = parseEntry({
        fields: shape.fields,
        raw,
        filePath: file.path,
        media: shape.media,
      })
      const validation = await validateEntryForSave({
        fields: shape.fields,
        raw,
        filePath: file.path,
        media: shape.media,
        services: {
          hasEntry: (_collection, value) => value !== "missing-product",
        },
      })
      if (file.origin === "yve") {
        expect(validation.ok, `${file.path}: ${JSON.stringify(validation)}`).toBe(true)
      } else {
        expect(
          parsed.issues.length + (validation.ok ? 0 : validation.issues.length),
          file.path,
        ).toBeGreaterThan(0)
      }
    }
  })
})
