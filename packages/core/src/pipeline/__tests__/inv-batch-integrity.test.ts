/// <reference types="node" />
import { describe, expect, it } from "vitest"
import type { DraftRecord, DraftStore } from "../../drafts"
import type { StagedMediaTileRecord } from "../../media"
import { encodeUtf8 } from "../../safety/encoding"
import { createSaveCoordinator } from "../save-controller"
import { runSave } from "../save-driver"
import type { DropAckSpec } from "./fake-github-fetch"
import { BASE_CONTENT, buildSpec, createHarness, successfulRefUpdates } from "./fake-github-fetch"

function memoryDrafts(): DraftStore & { readonly size: () => number } {
  const store = new Map<string, DraftRecord>()
  return {
    size: () => store.size,
    async get<T>(key: string): Promise<DraftRecord<T> | undefined> {
      return store.get(key) as DraftRecord<T> | undefined
    },
    async put<T>(record: DraftRecord<T>): Promise<void> {
      store.set(record.key, record as DraftRecord)
    },
    async delete(key: string): Promise<void> {
      store.delete(key)
    },
    async deletePrefix(prefix: string): Promise<void> {
      for (const k of [...store.keys()]) {
        if (k.startsWith(prefix)) store.delete(k)
      }
    },
    async list(prefix?: string): Promise<readonly DraftRecord[]> {
      const records = [...store.values()]
      if (prefix === undefined) return records
      return records.filter((r) => r.key.startsWith(prefix))
    },
  }
}

describe("INV-M02 — Batch integrity ($N$ images + JSON atomic publish)", () => {
  it("commits entry JSON and 9 staged images in exactly ONE commit and ONE ref update", async () => {
    const spec = await buildSpec(BASE_CONTENT)
    const harness = createHarness(spec)
    const drafts = memoryDrafts()
    const draftKey = "owner/repo/products/iris-test"

    // Stage entry draft
    await drafts.put({
      key: draftKey,
      savedAt: new Date().toISOString(),
      value: {
        filePath: "src/content/products/iris-test.json",
        baseSha: spec.headSha,
        baseRaw: '{\n  "title": "Iris Test"\n}\n',
        formValue: { title: "Iris Test Updated", images: [] },
      },
    })

    // Stage 9 media tiles alongside entry
    const stagedAdds = []
    for (let i = 1; i <= 9; i++) {
      const tileId = `tile-${i}`
      const repoPath = `public/images/products/iris-test-${i}.jpg`
      const bytes = encodeUtf8(`image-bytes-data-${i}`)
      const tile: StagedMediaTileRecord = {
        tileId,
        repoPath,
        publicPath: `/images/products/iris-test-${i}.jpg`,
        originalFilename: `photo-${i}.jpg`,
        sanitizedFilename: `iris-test-${i}.jpg`,
        bytes,
        mimeType: "image/jpeg",
        size: bytes.byteLength,
        sha: `sha-fake-${i}`,
        status: "ready",
      }
      await drafts.put({
        key: `${draftKey}/media/${tileId}`,
        savedAt: new Date().toISOString(),
        value: tile,
      })
      stagedAdds.push({ path: repoPath, bytes })
    }

    expect(drafts.size()).toBe(10) // 1 entry + 9 tiles
    const seedCommitCount = harness.server.commitCount()

    const coordinator = createSaveCoordinator({
      backend: harness.backend,
      branch: "fixture-branch",
      drafts,
      retryDelaysMs: [0, 0],
    })

    const changes = {
      adds: [
        {
          path: "src/content/products/iris-test.json",
          bytes: encodeUtf8('{\n  "title": "Iris Test Updated"\n}\n'),
        },
        ...stagedAdds,
      ],
    }

    const verdict = await coordinator.save({
      draftKey,
      changes,
      baseSha: spec.headSha,
      draft: {
        filePath: "src/content/products/iris-test.json",
        baseSha: spec.headSha,
        baseRaw: '{\n  "title": "Iris Test"\n}\n',
        formValue: { title: "Iris Test Updated" },
      },
    })

    expect(verdict.kind).toBe("published")
    if (verdict.kind !== "published") return

    // INV-M02: Exactly ONE commit created
    expect(harness.server.commitCount()).toBe(seedCommitCount + 1)
    // Exactly ONE ref update
    expect(successfulRefUpdates(harness.server)).toBe(1)
    expect(harness.server.ref("fixture-branch")).toBe(verdict.commitSha)

    // Verify all 10 files (1 JSON + 9 images) exist in the tree
    const jsonContent = harness.server.contents(
      "fixture-branch",
      "src/content/products/iris-test.json",
    )
    expect(jsonContent).toBeDefined()
    for (let i = 1; i <= 9; i++) {
      const imgContent = harness.server.contents(
        "fixture-branch",
        `public/images/products/iris-test-${i}.jpg`,
      )
      expect(imgContent).toBeDefined()
      expect(imgContent?.bytes).toEqual(encodeUtf8(`image-bytes-data-${i}`))
    }

    // Post-publish cleanup: entry draft AND all staged tiles purged via deletePrefix
    expect(await drafts.get(draftKey)).toBeUndefined()
    const remainingStaged = await drafts.list(`${draftKey}/media/`)
    expect(remainingStaged.length).toBe(0)
    expect(drafts.size()).toBe(0)
  })

  it("cleans up staged media tiles when save is a no-op", async () => {
    const spec = await buildSpec(BASE_CONTENT)
    const harness = createHarness(spec)
    const drafts = memoryDrafts()
    const draftKey = "owner/repo/site"

    // Stage entry draft equal to current content
    await drafts.put({
      key: draftKey,
      savedAt: new Date().toISOString(),
      value: {
        filePath: "src/content/site.json",
        baseSha: spec.headSha,
        baseRaw: '{\n  "title": "site"\n}\n',
        formValue: { title: "site" },
      },
    })

    // Stage orphaned tile
    await drafts.put({
      key: `${draftKey}/media/staged-1`,
      savedAt: new Date().toISOString(),
      value: {
        tileId: "staged-1",
        repoPath: "public/images/logo.png",
        originalFilename: "logo.png",
        sanitizedFilename: "logo.png",
        publicPath: "/images/logo.png",
        bytes: encodeUtf8("abc"),
        mimeType: "image/png",
        size: 3,
        sha: "fake",
        status: "ready",
      },
    })

    const coordinator = createSaveCoordinator({
      backend: harness.backend,
      branch: "fixture-branch",
      drafts,
    })

    const verdict = await coordinator.save({
      draftKey,
      changes: {
        updates: [
          {
            path: "src/content/site.json",
            bytes: encodeUtf8('{\n  "title": "site"\n}\n'),
          },
        ],
      },
      baseSha: spec.headSha,
      draft: {
        filePath: "src/content/site.json",
        baseSha: spec.headSha,
        baseRaw: '{\n  "title": "site"\n}\n',
        formValue: { title: "site" },
      },
    })

    expect(verdict.kind).toBe("noop")
    expect(await drafts.get(draftKey)).toBeUndefined()
    const remainingStaged = await drafts.list(`${draftKey}/media/`)
    expect(remainingStaged.length).toBe(0)
  })

  it("handles response lost at ref update with 9 images + JSON without duplicate commits", async () => {
    const spec = await buildSpec(BASE_CONTENT)
    const dropRefAck: DropAckSpec = { method: "PATCH", pathPattern: /\/git\/refs\/heads\// }
    const harness = createHarness(spec, { chaos: { dropAcks: [dropRefAck] } })
    const seedCommitCount = harness.server.commitCount()

    const stagedAdds = []
    for (let i = 1; i <= 9; i++) {
      stagedAdds.push({
        path: `public/images/products/photo-${i}.jpg`,
        bytes: encodeUtf8(`bytes-${i}`),
      })
    }

    const verdict = await runSave({
      backend: harness.backend,
      branch: "fixture-branch",
      changes: {
        adds: [
          {
            path: "src/content/products/test.json",
            bytes: encodeUtf8('{"title":"test"}'),
          },
          ...stagedAdds,
        ],
      },
    })

    expect(verdict.kind).toBe("published")
    // Exactly 1 new commit created despite dropped ack (idempotent recovery confirms by content)
    expect(harness.server.commitCount()).toBe(seedCommitCount + 1)
  })
})
