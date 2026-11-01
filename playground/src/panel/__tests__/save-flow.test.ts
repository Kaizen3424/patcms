/**
 * Save-flow tests — the panel's core flows driven against the playground's
 * FakeGithub through msw/node: sign-in probe, edit+save with untouched
 * preservation, conflict-as-a-value resolved with the panel's pairing logic,
 * drafts, and the media trash ladder. Each test boots a fresh fake so commit
 * counts and file bytes are deterministic.
 */

import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { setupServer } from "msw/node"
import type { CMSError } from "patcms"
import { createCMS, isCMSError } from "patcms"
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"
import { yveConfig } from "../../config/yve"
import { loadFixtureRepoFromDisk } from "../../fake-github/fixture-repo"
import { pushForeignEntryCommit } from "../../fake-github/foreign-commit"
import { createFakeGithubHandlers, DEFAULT_TAGS } from "../../fake-github/handlers"
import type { FakeGithubServer } from "../../fake-github/server"
import { defaultPicks, mergePickedFields, pairConflictFields } from "../lib/conflict"

const HERE = dirname(fileURLToPath(import.meta.url))
const FIXTURE_ROOT = join(HERE, "..", "..", "..", "fixtures", "repo")
const TARGET = "src/content/products/the-rock-pendant.json"

const snapshot = await loadFixtureRepoFromDisk(FIXTURE_ROOT)
const msw = setupServer()

beforeAll(() => msw.listen())
afterEach(() => msw.resetHandlers())
afterAll(() => msw.close())

function boot(options: { invalidTokens?: readonly string[] } = {}): {
  cms: ReturnType<typeof createCMS>
  fake: FakeGithubServer
} {
  const { handlers, server: fake } = createFakeGithubHandlers(snapshot, DEFAULT_TAGS, {
    requireAuth: true,
    chaos: {
      ...(options.invalidTokens === undefined ? {} : { invalidTokens: options.invalidTokens }),
    },
  })
  msw.use(...handlers)
  const cms = createCMS({
    config: yveConfig,
    repository: {
      owner: DEFAULT_TAGS.owner,
      repo: DEFAULT_TAGS.repo,
      branch: snapshot.defaultBranch,
    },
  })
  return { cms, fake }
}

function fileText(fake: FakeGithubServer, path: string): string {
  const file = fake.contents(snapshot.defaultBranch, path)
  if (file === undefined) throw new Error(`missing fixture file ${path}`)
  return new TextDecoder().decode(file.bytes)
}

describe("panel save flow against the fake GitHub", () => {
  it("signs in through the capability probe and refuses a bad token", async () => {
    const { cms } = boot({ invalidTokens: ["bad_pat"] })
    await expect(cms.auth.signIn("bad_pat")).rejects.toMatchObject({ code: expect.any(String) })
    const session = await cms.auth.signIn("test-token")
    expect(session.repository.repo).toBe(DEFAULT_TAGS.repo)
  })

  it("edits one field, saves one commit, and preserves untouched bytes", async () => {
    const { cms, fake } = boot()
    await cms.auth.signIn("test-token")

    const before = fileText(fake, TARGET)
    const beforeJson = JSON.parse(before) as Record<string, unknown>
    const commitsBefore = fake.commitCount()
    const entry = await cms.entries.get("products", "the-rock-pendant")
    const result = await cms.entries.save(entry, { ...entry.value, material: "Test edit" })
    expect(result.status).toBe("saved")
    if (result.status !== "saved") return

    expect(fake.commitCount()).toBe(commitsBefore + 1)
    const afterJson = JSON.parse(fileText(fake, TARGET)) as Record<string, unknown>
    expect(afterJson.material).toBe("Test edit")
    expect(afterJson).toEqual({ ...beforeJson, material: "Test edit" })
    for (const key of Object.keys(beforeJson)) {
      if (key !== "material") {
        expect(JSON.stringify(afterJson[key])).toBe(JSON.stringify(beforeJson[key]))
      }
    }
  })

  it("surfaces a conflict value and resolves it with the panel's pairing", async () => {
    const { cms, fake } = boot()
    await cms.auth.signIn("test-token")

    const entry = await cms.entries.get("products", "the-rock-pendant")
    await pushForeignEntryCommit({
      server: fake,
      branch: snapshot.defaultBranch,
      path: TARGET,
      mutator: (content) => ({ ...content, material: "Foreign push" }),
      message: "foreign push (panel test)",
    })

    const attempted = { ...entry.value, material: "My edit" }
    const result = await cms.entries.save(entry, attempted)
    expect(result.status).toBe("conflict")
    if (result.status !== "conflict") return

    expect(result.current.value.material).toBe("Foreign push")
    expect(result.local.material).toBe("My edit")

    const rows = pairConflictFields(result.current.value, attempted, result.current.fields)
    const picks = defaultPicks(rows)
    expect(picks.material).toBe("mine")

    const commitsBefore = fake.commitCount()
    const merged = mergePickedFields(result.current, attempted, result.current.fields, picks)
    const resolved = await cms.entries.save(result.current, merged)
    expect(resolved.status).toBe("saved")
    if (resolved.status !== "saved") return
    expect(fileText(fake, TARGET)).toContain("My edit")
    expect(fake.commitCount()).toBe(commitsBefore + 1)
  })

  it("keeps the whole current version when every pick says current", async () => {
    const { cms, fake } = boot()
    await cms.auth.signIn("test-token")

    const entry = await cms.entries.get("products", "the-rock-pendant")
    await pushForeignEntryCommit({
      server: fake,
      branch: snapshot.defaultBranch,
      path: TARGET,
      mutator: (content) => ({ ...content, material: "Foreign push 2" }),
    })

    const result = await cms.entries.save(entry, { ...entry.value, material: "Mine" })
    expect(result.status).toBe("conflict")
    if (result.status !== "conflict") return

    const rows = pairConflictFields(result.current.value, result.local, result.current.fields)
    const picks = defaultPicks(rows)
    picks.material = "current"
    const merged = mergePickedFields(result.current, result.local, result.current.fields, picks)
    const resolved = await cms.entries.save(result.current, merged)
    expect(resolved.status).toBe("noop")
    expect(fileText(fake, TARGET)).toContain("Foreign push 2")
  })

  it("round-trips drafts through the client's draft store", async () => {
    const { cms } = boot()
    await cms.auth.signIn("test-token")

    const entry = await cms.entries.get("products", "the-rock-pendant")
    await cms.drafts.save(entry, { ...entry.value, material: "Draft edit" })
    const stored = await cms.drafts.get(entry)
    expect(stored?.value.material).toBe("Draft edit")
    expect(stored?.baseSha).toBe(entry.sha)
    expect((await cms.drafts.list("products")).length).toBe(1)

    await cms.drafts.delete(entry)
    expect(await cms.drafts.get(entry)).toBeUndefined()
  })

  it("uploads, blocks on references, trashes, and restores media", async () => {
    const { cms, fake } = boot()
    await cms.auth.signIn("test-token")
    const commitsBefore = fake.commitCount()

    const uploaded = await cms.media.upload(
      { name: "panel-test.png", bytes: new Uint8Array([1, 2, 3]) },
      { collection: "products" },
    )
    expect(uploaded.publicPath).toBe("/images/products/panel-test.png")

    // Reference the new file from an entry, exactly like the editor's image widget.
    const entry = await cms.entries.get("products", "the-rock-pendant")
    const images = Array.isArray(entry.value.images) ? [...entry.value.images] : []
    const first = typeof images[0] === "object" && images[0] !== null ? images[0] : {}
    images[0] = { ...(first as Record<string, unknown>), image: uploaded.publicPath }
    const referenced = await cms.entries.save(entry, { ...entry.value, images })
    expect(referenced.status).toBe("saved")

    const blocked = await cms.media.delete(uploaded.publicPath)
    expect(blocked.status).toBe("referenced")
    if (blocked.status === "referenced") {
      expect(blocked.references.length).toBeGreaterThan(0)
    }

    const forced = await cms.media.delete(uploaded.publicPath, { checkReferences: false })
    expect(forced.status).toBe("deleted")

    const trash = await cms.media.list({ includeTrash: true, collection: "products" })
    const tombstone = trash.find((file) => file.name === "panel-test.png")
    expect(tombstone).toBeDefined()
    expect(tombstone?.path.startsWith("_trash/")).toBe(true)

    const restored = await cms.media.restore(tombstone?.path ?? "")
    expect(restored.publicPath).toBe(uploaded.publicPath)
    expect(await cms.media.list({ includeTrash: true })).toHaveLength(0)
    expect(fake.commitCount()).toBe(commitsBefore + 4)
  })

  it("throws a typed CMSError when listing without signing in", async () => {
    const { cms } = boot()
    try {
      await cms.entries.list("products")
      expect.unreachable("list should have thrown")
    } catch (cause) {
      expect(isCMSError(cause)).toBe(true)
      expect((cause as CMSError).code).toBe("AUTH_REQUIRED")
    }
  })
})
