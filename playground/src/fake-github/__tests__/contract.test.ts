/// <reference types="node" />
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import type { FetchLike } from "@mycms/core"
import {
  CORE_CONTRACT_SUITE,
  GithubBackend,
  probeGithubCapabilities,
  runContractSuite,
} from "@mycms/core"
import { setupServer } from "msw/node"
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"
import { loadFixtureRepoFromDisk } from "../fixture-repo"
import { createFakeGithubHandlers, DEFAULT_TAGS } from "../handlers"

const HERE = dirname(fileURLToPath(import.meta.url))
const FIXTURE_ROOT = join(HERE, "..", "..", "..", "fixtures", "repo")
const TOKEN = "github_pat_contract_fixture"

let snapshot: Awaited<ReturnType<typeof loadFixtureRepoFromDisk>>
let handlers: ReturnType<typeof createFakeGithubHandlers>["handlers"]
const server = setupServer()

beforeAll(async () => {
  snapshot = await loadFixtureRepoFromDisk(FIXTURE_ROOT)
  handlers = createFakeGithubHandlers(snapshot).handlers
  server.listen()
})

afterEach(() => server.resetHandlers())
afterAll(() => server.close())

function backend(): GithubBackend {
  return new GithubBackend({
    owner: DEFAULT_TAGS.owner,
    repo: DEFAULT_TAGS.repo,
    token: TOKEN,
    fetch: globalThis.fetch as unknown as FetchLike,
  })
}

describe("FakeGithub read-side contract (P1.7/P1.14)", () => {
  it("passes the SAME core contract suite as the reference backend", async () => {
    server.use(...handlers)
    const expectedPath = "src/content/site.json"
    const expected = snapshot.entries.get(expectedPath)
    expect(expected).toBeDefined()
    const report = await runContractSuite(backend(), CORE_CONTRACT_SUITE, {
      branch: "fixture-branch",
      expectedPaths: [expectedPath],
      expectedFileBytes: expected?.bytes,
    })
    expect(report.failures).toEqual([])
    expect(report.ok).toBe(true)
  })

  it("supports ETag 304s for tree and file reads", async () => {
    server.use(...handlers)
    const api = backend()
    const ref = await api.getRef("fixture-branch")
    const tree = await api.readTree("fixture-branch", ref.object.sha)
    expect(tree.kind).toBe("tree")
    if (tree.kind !== "tree" || tree.etag === undefined) throw new Error("expected tree etag")
    expect(await api.readTree("fixture-branch", ref.object.sha, { etag: tree.etag })).toMatchObject(
      {
        kind: "not-modified",
      },
    )

    const first = tree.tree.entries[0]
    if (first === undefined) throw new Error("expected fixture entry")
    const file = await api.readFile("fixture-branch", first.path, first.sha)
    expect(file.kind).toBe("file")
    if (file.kind !== "file" || file.etag === undefined) throw new Error("expected file etag")
    expect(
      await api.readFile("fixture-branch", first.path, first.sha, { etag: file.etag }),
    ).toMatchObject({ kind: "not-modified" })
  })

  it("serves exact bytes for JSON and binary image files", async () => {
    server.use(...handlers)
    const api = backend()
    const ref = await api.getRef("fixture-branch")
    const tree = await api.readTree("fixture-branch", ref.object.sha)
    if (tree.kind !== "tree") throw new Error("expected tree")
    for (const path of ["src/content/site.json", "public/images/site/ing-yve-collections.jpg"]) {
      const entry = tree.tree.entries.find((candidate) => candidate.path === path)
      if (entry === undefined) throw new Error(`missing ${path}`)
      const result = await api.readFile("fixture-branch", path, entry.sha)
      if (result.kind !== "file") throw new Error(`expected file ${path}`)
      expect(
        Buffer.from(result.file.bytes).equals(Buffer.from(snapshot.entries.get(path)?.bytes ?? [])),
      ).toBe(true)
    }
  })

  it("survives recursive-tree truncation via subtree fallback", async () => {
    server.use(
      ...createFakeGithubHandlers(snapshot, DEFAULT_TAGS, { chaos: { truncateTree: true } })
        .handlers,
    )
    const api = backend()
    const ref = await api.getRef("fixture-branch")
    const tree = await api.readTree("fixture-branch", ref.object.sha)
    expect(tree.kind).toBe("tree")
    if (tree.kind !== "tree") return
    expect(tree.tree.truncated).toBe(false)
    expect(tree.tree.entries.length).toBe(snapshot.entries.size)
  })

  it("fails loudly when subtree reads are also truncated", async () => {
    server.use(
      ...createFakeGithubHandlers(snapshot, DEFAULT_TAGS, {
        chaos: { truncateTree: true, truncateSubtrees: true },
      }).handlers,
    )
    const api = backend()
    const ref = await api.getRef("fixture-branch")
    await expect(api.readTree("fixture-branch", ref.object.sha)).rejects.toMatchObject({
      code: "TREE_TRUNCATED",
    })
  })

  it("maps file 404 chaos to a typed NOT_FOUND", async () => {
    server.use(
      ...createFakeGithubHandlers(snapshot, DEFAULT_TAGS, {
        chaos: { notFoundPaths: ["src/content/site.json"] },
      }).handlers,
    )
    await expect(
      backend().readFile("fixture-branch", "src/content/site.json", "a".repeat(40)),
    ).rejects.toMatchObject({ code: "NOT_FOUND" })
  })

  it("returns 429 quota chaos once, then recovers", async () => {
    server.use(
      ...createFakeGithubHandlers(snapshot, DEFAULT_TAGS, { chaos: { rateLimitOnce: true } })
        .handlers,
    )
    await expect(backend().getRef("fixture-branch")).rejects.toMatchObject({ code: "RATE_LIMIT" })
    const ref = await backend().getRef("fixture-branch")
    expect(ref.object.sha).toBe(snapshot.headSha)
  })

  it("probes capabilities against the fake repo with no token in URLs", async () => {
    server.use(...handlers)
    const result = await probeGithubCapabilities({
      owner: DEFAULT_TAGS.owner,
      repo: DEFAULT_TAGS.repo,
      token: TOKEN,
      branch: "fixture-branch",
      fetch: globalThis.fetch as unknown as FetchLike,
    })
    expect(result.repo).toBe("ok")
    expect(result.protectionAdmin).toBe("ok")
    expect(result.checksRead).toBe("ok")
    expect(result.rateLimit?.remaining).toBeGreaterThan(0)
  })
})
