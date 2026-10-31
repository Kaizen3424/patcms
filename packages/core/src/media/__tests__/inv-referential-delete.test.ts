/// <reference types="node" />
import { describe, expect, it } from "vitest"
import type { TreeEntryTuple } from "../../backend/types"
import type { AdminConfig } from "../../config/types"
import { BASE_CONTENT, buildSpec, createHarness } from "../../pipeline/__tests__/fake-github-fetch"
import { runSave } from "../../pipeline/save-driver"
import { encodeUtf8 } from "../../safety/encoding"
import {
  canDeleteMedia,
  createRestoreChanges,
  createTrashChanges,
  restoreMediaPath,
  trashMediaPath,
} from "../delete-ladder"
import type { SearchableEntry } from "../references"

const MOCK_CONFIG: AdminConfig = {
  schemaVersion: 1,
  collections: [
    {
      name: "products",
      label: "Products",
      kind: "folder",
      folder: "src/content/products",
      format: "json",
      fields: [],
    },
  ],
  media: {
    folder: "public/images",
    publicFolder: "/images",
  },
}

const SEARCHABLE_ENTRIES: SearchableEntry[] = [
  {
    collection: "products",
    slug: "iris-1",
    title: "Iris No 1",
    value: {
      image: "/images/products/iris-1.jpg",
      gallery: ["/images/products/iris-1-detail.jpg"],
    },
  },
  {
    collection: "products",
    slug: "necklace",
    title: "Gold Necklace",
    value: {
      featuredImage: "/images/products/shared-model.jpg",
    },
  },
]

describe("INV-M03 — Referential Delete & Tombstone Storage", () => {
  it("blocks deletion when an image is referenced by an entry", () => {
    // Referenced directly in image field
    const check1 = canDeleteMedia(
      "public/images/products/iris-1.jpg",
      SEARCHABLE_ENTRIES,
      MOCK_CONFIG,
    )
    expect(check1.allowed).toBe(false)
    expect(check1.references.length).toBe(1)
    expect(check1.references[0]?.slug).toBe("iris-1")

    // Referenced in array field
    const check2 = canDeleteMedia(
      "public/images/products/iris-1-detail.jpg",
      SEARCHABLE_ENTRIES,
      MOCK_CONFIG,
    )
    expect(check2.allowed).toBe(false)
    expect(check2.references.length).toBe(1)
  })

  it("permits deletion when an image is not referenced anywhere in repository entries", () => {
    const check = canDeleteMedia(
      "public/images/products/unused-photo.jpg",
      SEARCHABLE_ENTRIES,
      MOCK_CONFIG,
    )
    expect(check.allowed).toBe(true)
    expect(check.references.length).toBe(0)
  })

  it("computes bijection for trashMediaPath and restoreMediaPath", () => {
    const original = "public/images/products/ring.jpg"
    const trashed = trashMediaPath(original)
    expect(trashed).toBe("_trash/public/images/products/ring.jpg")

    const restored = restoreMediaPath(trashed)
    expect(restored).toBe(original)
  })

  it("creates single-commit change set for moving to _trash/", () => {
    const bytes = encodeUtf8("image-bytes-mock")
    const changes = createTrashChanges("public/images/old.png", bytes)

    expect(changes.adds).toEqual([{ path: "_trash/public/images/old.png", bytes }])
    expect(changes.deletes).toEqual(["public/images/old.png"])
  })

  it("prevents restoration if a file currently collides with destination path", () => {
    const currentTree: TreeEntryTuple[] = [
      {
        path: "public/images/products/iris.jpg",
        type: "blob",
        mode: "100644",
        sha: "live-sha",
      },
    ]

    const result = createRestoreChanges(
      "_trash/public/images/products/iris.jpg",
      encodeUtf8("old-bytes"),
      currentTree,
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe("collision")
      expect(result.destination).toBe("public/images/products/iris.jpg")
    }
  })

  it("creates single-commit change set for restoration when no collision exists", () => {
    const currentTree: TreeEntryTuple[] = [
      {
        path: "public/images/products/other.jpg",
        type: "blob",
        mode: "100644",
        sha: "other-sha",
      },
    ]

    const bytes = encodeUtf8("restored-bytes")
    const result = createRestoreChanges(
      "_trash/public/images/products/iris.jpg",
      bytes,
      currentTree,
    )

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.destination).toBe("public/images/products/iris.jpg")
      expect(result.changes.adds).toEqual([{ path: "public/images/products/iris.jpg", bytes }])
      expect(result.changes.deletes).toEqual(["_trash/public/images/products/iris.jpg"])
    }
  })

  it("executes soft-delete and restoration via Git pipeline atomically", async () => {
    const spec = await buildSpec([
      ...BASE_CONTENT,
      ["public/images/test-asset.jpg", "asset-binary-bytes"],
    ])
    const harness = createHarness(spec)
    const seedCommitCount = harness.server.commitCount()

    // 1. Move to _trash/
    const bytes = encodeUtf8("asset-binary-bytes")
    const trashChanges = createTrashChanges("public/images/test-asset.jpg", bytes)

    const trashVerdict = await runSave({
      backend: harness.backend,
      branch: "fixture-branch",
      changes: trashChanges,
    })

    expect(trashVerdict.kind).toBe("published")
    expect(harness.server.commitCount()).toBe(seedCommitCount + 1)

    // Original file is removed; tombstone file exists
    expect(
      harness.server.contents("fixture-branch", "public/images/test-asset.jpg"),
    ).toBeUndefined()
    expect(
      harness.server.contents("fixture-branch", "_trash/public/images/test-asset.jpg"),
    ).toBeDefined()

    // 2. Restore from _trash/
    const refSha = harness.server.ref("fixture-branch")
    if (!refSha) throw new Error("expected ref")
    const headTree = await harness.backend.readTree("fixture-branch", refSha)
    if (headTree.kind !== "tree") throw new Error("expected tree")

    const restoreChanges = createRestoreChanges(
      "_trash/public/images/test-asset.jpg",
      bytes,
      headTree.tree.entries,
    )
    expect(restoreChanges.ok).toBe(true)
    if (!restoreChanges.ok) return

    const restoreVerdict = await runSave({
      backend: harness.backend,
      branch: "fixture-branch",
      changes: restoreChanges.changes,
    })

    expect(restoreVerdict.kind).toBe("published")
    expect(harness.server.commitCount()).toBe(seedCommitCount + 2)

    // Restored file is back; tombstone is gone
    expect(harness.server.contents("fixture-branch", "public/images/test-asset.jpg")).toBeDefined()
    expect(
      harness.server.contents("fixture-branch", "_trash/public/images/test-asset.jpg"),
    ).toBeUndefined()
  })
})
