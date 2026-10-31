/**
 * Invariant INV-M01: Media path bijection `/images/** ⇄ public/images/**`
 * and media budget calculation — ADR-0007 §5, §6.
 */

import { describe, expect, it } from "vitest"
import type { TreeEntryTuple } from "../../backend/types"
import type { AdminConfig } from "../../config/types"
import {
  CLIENT_BLOCK_BYTES,
  calculateMediaBudget,
  isUploadSizeBlocked,
  publicPathToRepoPath,
  repoPathToPublicPath,
  resolveMediaFolders,
  WARNING_THRESHOLD_BYTES,
  WARNING_THRESHOLD_COUNT,
} from "../index"

const ROOT_MEDIA = {
  folder: "public/images",
  publicFolder: "/images",
} as const

const PRODUCTS_OVERRIDE_MEDIA = {
  folder: "public/images/products",
  publicFolder: "/images/products",
} as const

const MOCK_CONFIG: AdminConfig = {
  schemaVersion: 1,
  media: ROOT_MEDIA,
  collections: [
    {
      name: "products",
      label: "Products",
      kind: "folder",
      folder: "src/content/products",
      format: "json",
      media: PRODUCTS_OVERRIDE_MEDIA,
      fields: [],
    },
    {
      name: "collections",
      label: "Collections",
      kind: "folder",
      folder: "src/content/collections",
      format: "json",
      fields: [],
    },
  ],
}

describe("INV-M01: Media path bijection (ADR-0007 §5)", () => {
  it("resolves collection overrides when present and falls back to root media", () => {
    expect(resolveMediaFolders(MOCK_CONFIG, "products")).toEqual(PRODUCTS_OVERRIDE_MEDIA)
    expect(resolveMediaFolders(MOCK_CONFIG, "collections")).toEqual(ROOT_MEDIA)
    expect(resolveMediaFolders(MOCK_CONFIG, undefined)).toEqual(ROOT_MEDIA)
    expect(resolveMediaFolders(MOCK_CONFIG, "nonexistent")).toEqual(ROOT_MEDIA)
  })

  it("converts public paths to repo paths under root media", () => {
    const converted = publicPathToRepoPath("/images/site/hero.jpg", ROOT_MEDIA)
    expect(converted).toEqual({
      ok: true,
      value: "public/images/site/hero.jpg",
    })
  })

  it("converts repo paths to public paths under root media", () => {
    const converted = repoPathToPublicPath("public/images/site/hero.jpg", ROOT_MEDIA)
    expect(converted).toEqual({
      ok: true,
      value: "/images/site/hero.jpg",
    })
  })

  it("converts public paths to repo paths with collection override", () => {
    const converted = publicPathToRepoPath(
      "/images/products/ring-gold.webp",
      PRODUCTS_OVERRIDE_MEDIA,
    )
    expect(converted).toEqual({
      ok: true,
      value: "public/images/products/ring-gold.webp",
    })
  })

  it("converts repo paths to public paths with collection override", () => {
    const converted = repoPathToPublicPath(
      "public/images/products/ring-gold.webp",
      PRODUCTS_OVERRIDE_MEDIA,
    )
    expect(converted).toEqual({
      ok: true,
      value: "/images/products/ring-gold.webp",
    })
  })

  it("satisfies the bijection invariant: repoToPublic(publicToRepo(p)) === p", () => {
    const paths = [
      "/images/hero.jpg",
      "/images/site/hero.jpg",
      "/images/products/stone-1.png",
      "/images/2026/04/craft-workshop.webp",
    ]
    for (const publicPath of paths) {
      const repoResult = publicPathToRepoPath(publicPath, ROOT_MEDIA)
      expect(repoResult.ok).toBe(true)
      if (repoResult.ok) {
        const roundTripped = repoPathToPublicPath(repoResult.value, ROOT_MEDIA)
        expect(roundTripped).toEqual({ ok: true, value: publicPath })
      }
    }
  })

  it("satisfies the reverse bijection invariant: publicToRepo(repoToPublic(r)) === r", () => {
    const repoPaths = [
      "public/images/hero.jpg",
      "public/images/site/hero.jpg",
      "public/images/products/stone-1.png",
      "public/images/2026/04/craft-workshop.webp",
    ]
    for (const repoPath of repoPaths) {
      const publicResult = repoPathToPublicPath(repoPath, ROOT_MEDIA)
      expect(publicResult.ok).toBe(true)
      if (publicResult.ok) {
        const roundTripped = publicPathToRepoPath(publicResult.value, ROOT_MEDIA)
        expect(roundTripped).toEqual({ ok: true, value: repoPath })
      }
    }
  })

  it("rejects path traversal attempts on both public and repo paths", () => {
    expect(publicPathToRepoPath("/images/../secrets.json", ROOT_MEDIA).ok).toBe(false)
    expect(publicPathToRepoPath("/images/%2e%2e/secrets.json", ROOT_MEDIA).ok).toBe(false)
    expect(publicPathToRepoPath("/images/sub\\bad.jpg", ROOT_MEDIA).ok).toBe(false)
    expect(repoPathToPublicPath("public/images/../secrets.json", ROOT_MEDIA).ok).toBe(false)
    expect(repoPathToPublicPath("public/images/sub\\bad.jpg", ROOT_MEDIA).ok).toBe(false)
  })

  it("rejects prefix mismatches and escapes outside the media folder boundary", () => {
    // Escaping the prefix boundary: `/images-other/foo.jpg` is not `/images`
    expect(publicPathToRepoPath("/images-other/foo.jpg", ROOT_MEDIA).ok).toBe(false)
    expect(publicPathToRepoPath("/static/foo.jpg", ROOT_MEDIA).ok).toBe(false)
    expect(repoPathToPublicPath("src/content/foo.jpg", ROOT_MEDIA).ok).toBe(false)
    expect(repoPathToPublicPath("public/images-other/foo.jpg", ROOT_MEDIA).ok).toBe(false)
  })
})

describe("Media budget calculation (ADR-0007 §6)", () => {
  it("computes total bytes and count for blobs inside configured media folders", () => {
    const entries: TreeEntryTuple[] = [
      {
        path: "public/images/site/hero.jpg",
        sha: "a1",
        mode: "100644",
        type: "blob",
        size: 400_000,
      },
      {
        path: "public/images/products/ring.webp",
        sha: "a2",
        mode: "100644",
        type: "blob",
        size: 300_000,
      },
      { path: "src/content/home.json", sha: "a3", mode: "100644", type: "blob", size: 2_000 }, // Ignored: outside media
      { path: "public/images/sub", sha: "a4", mode: "040000", type: "tree" }, // Ignored: tree
    ]

    const budget = calculateMediaBudget(entries, ROOT_MEDIA)
    expect(budget.count).toBe(2)
    expect(budget.totalBytes).toBe(700_000)
    expect(budget.warning).toBe(false)
    expect(budget.warningReason).toBeUndefined()
  })

  it("supports multiple configured media folders (root + collection overrides)", () => {
    const entries: TreeEntryTuple[] = [
      {
        path: "public/images/site/hero.jpg",
        sha: "a1",
        mode: "100644",
        type: "blob",
        size: 400_000,
      },
      {
        path: "public/images/products/ring.webp",
        sha: "a2",
        mode: "100644",
        type: "blob",
        size: 300_000,
      },
      { path: "src/content/home.json", sha: "a3", mode: "100644", type: "blob", size: 2_000 },
    ]

    const budget = calculateMediaBudget(entries, [ROOT_MEDIA, PRODUCTS_OVERRIDE_MEDIA])
    expect(budget.count).toBe(2)
    expect(budget.totalBytes).toBe(700_000)
  })

  it("surfaces a size warning when total media bytes >= 800MB", () => {
    const entries: TreeEntryTuple[] = [
      {
        path: "public/images/large-collection.tar",
        sha: "a1",
        mode: "100644",
        type: "blob",
        size: WARNING_THRESHOLD_BYTES,
      },
    ]

    const budget = calculateMediaBudget(entries, ROOT_MEDIA)
    expect(budget.warning).toBe(true)
    expect(budget.warningReason).toBe("size")
  })

  it("surfaces a count warning when media count >= 2,500 files", () => {
    const entries: TreeEntryTuple[] = Array.from({ length: WARNING_THRESHOLD_COUNT }, (_, i) => ({
      path: `public/images/photo-${i}.webp`,
      sha: `sha-${i}`,
      mode: "100644",
      type: "blob",
      size: 1_000,
    }))

    const budget = calculateMediaBudget(entries, ROOT_MEDIA)
    expect(budget.count).toBe(WARNING_THRESHOLD_COUNT)
    expect(budget.warning).toBe(true)
    expect(budget.warningReason).toBe("count")
  })

  it("surfaces 'both' warning when both size and count thresholds are met", () => {
    const entries: TreeEntryTuple[] = Array.from({ length: WARNING_THRESHOLD_COUNT }, (_, i) => ({
      path: `public/images/photo-${i}.webp`,
      sha: `sha-${i}`,
      mode: "100644",
      type: "blob",
      size: Math.ceil(WARNING_THRESHOLD_BYTES / WARNING_THRESHOLD_COUNT),
    }))

    const budget = calculateMediaBudget(entries, ROOT_MEDIA)
    expect(budget.warning).toBe(true)
    expect(budget.warningReason).toBe("both")
  })

  it("identifies single-file uploads exceeding 90MiB as blocked", () => {
    expect(isUploadSizeBlocked(CLIENT_BLOCK_BYTES)).toBe(false)
    expect(isUploadSizeBlocked(CLIENT_BLOCK_BYTES + 1)).toBe(true)
    expect(isUploadSizeBlocked(15 * 1024 * 1024)).toBe(false) // 15MB file is permitted by 90MiB cap
    expect(isUploadSizeBlocked(100 * 1024 * 1024)).toBe(true)
  })
})
