/// <reference types="node" />
import { describe, expect, it } from "vitest"
import type { FakeGithubSpec } from "../../__tests__/support/fake-github-server"
import { FakeGithubServer } from "../../__tests__/support/fake-github-server"
import { encodeBase64, encodeUtf8 } from "../../safety/encoding"

/**
 * FakeGithubServer unit contract — the truthful reference model every harness
 * (core INV tests, playground MSW) delegates semantics to. Chaos lives OUTSIDE
 * this file; these tests pin the model itself.
 */

const SITE = '{\n  "title": "site"\n}\n'
const IRIS = '{\n  "title": "iris"\n}\n'

async function buildSpec(): Promise<FakeGithubSpec> {
  const { gitBlobSha, gitTreeSha, gitCommitShaCanonical } = await import("../git-sha")
  const files = new Map(
    (
      [
        ["src/content/site.json", SITE],
        ["src/content/products/iris.json", IRIS],
      ] as const
    ).map(([path, text]) => [path, { bytes: encodeUtf8(text) }] as const),
  )
  const shas = new Map<string, string>()
  for (const [path, file] of files) {
    shas.set(path, await gitBlobSha(file.bytes))
  }
  const treeSha = await gitTreeSha(
    [...shas].map(([path, sha]) => ({ path, mode: "100644", type: "blob", sha })),
  )
  const headSha = await gitCommitShaCanonical({
    treeSha,
    parentShas: [],
    message: "seed (fixture)",
  })
  return {
    defaultBranch: "fixture-branch",
    headSha,
    treeSha,
    files: new Map(
      [...files].map(([path, file]) => [
        path,
        { bytes: file.bytes, sha: shas.get(path) as string },
      ]),
    ),
  }
}

async function body(response: {
  status: number
  json?: unknown
}): Promise<Record<string, unknown>> {
  expect(response.status).toBeLessThan(400)
  return response.json as Record<string, unknown>
}

describe("FakeGithubServer — refs + contents (model truth)", () => {
  it("serves the seeded ref as GitHub would", async () => {
    const server = new FakeGithubServer(await buildSpec())
    const response = await server.handle({ method: "GET", path: "/git/ref/heads/fixture-branch" })
    expect(response.status).toBe(200)
    expect(response.json).toMatchObject({
      ref: "refs/heads/fixture-branch",
      object: { type: "commit" },
    })
  })

  it("contents resolves seeded bytes through the head tree; unknown paths miss", async () => {
    const spec = await buildSpec()
    const server = new FakeGithubServer(spec)
    const file = server.contents("fixture-branch", "src/content/site.json")
    expect(file?.bytes).toEqual(encodeUtf8(SITE))
    expect(file?.sha).toBe(spec.files.get("src/content/site.json")?.sha)
    expect(server.contents("fixture-branch", "nope.json")).toBeUndefined()
    expect(server.blobSize(file?.sha as string)).toBe(encodeUtf8(SITE).byteLength)
  })
})

describe("FakeGithubServer — deploy-status reads (ADR-0008 P2.8)", () => {
  it("serves check runs by branch name and by exact sha", async () => {
    const spec = await buildSpec()
    const server = new FakeGithubServer(spec)
    server.setCheckRuns(spec.headSha, [
      { name: "pages", status: "completed", conclusion: "success" },
      { name: "preview", status: "in_progress" },
    ])

    const byBranch = await server.handle({
      method: "GET",
      path: "/commits/fixture-branch/check-runs",
    })
    const bySha = await server.handle({
      method: "GET",
      path: `/commits/${spec.headSha}/check-runs`,
    })
    for (const response of [byBranch, bySha]) {
      expect(response.status).toBe(200)
      expect(response.json).toMatchObject({
        total_count: 2,
        check_runs: [
          { name: "pages", status: "completed", conclusion: "success" },
          { name: "preview", status: "in_progress", conclusion: null },
        ],
      })
    }
  })

  it("replaces runs and statuses, and misses unknown refs", async () => {
    const spec = await buildSpec()
    const server = new FakeGithubServer(spec)
    server.setCheckRuns(spec.headSha, [{ name: "first", conclusion: "failure" }])
    server.setCheckRuns(spec.headSha, [])
    const empty = await server.handle({
      method: "GET",
      path: `/commits/${spec.headSha}/check-runs`,
    })
    expect(empty.json).toMatchObject({ total_count: 0, check_runs: [] })

    server.setStatuses(spec.headSha, [
      { context: "ci/site", state: "pending", targetUrl: "https://ci.example/1" },
      { context: "ci/other", state: "success" },
    ])
    const statuses = await server.handle({
      method: "GET",
      path: `/commits/${spec.headSha}/status`,
    })
    expect(statuses.json).toMatchObject({
      state: "pending",
      total_count: 2,
      statuses: [
        { context: "ci/site", state: "pending", target_url: "https://ci.example/1" },
        { context: "ci/other", state: "success" },
      ],
    })

    const missing = await server.handle({ method: "GET", path: "/commits/nope/check-runs" })
    expect(missing.status).toBe(404)
  })
})

describe("FakeGithubServer — content-addressed writes (INV-P03 model basis)", () => {
  it("equal blob payloads collapse into one slot", async () => {
    const server = new FakeGithubServer(await buildSpec())
    const first = await server.handle({
      method: "POST",
      path: "/git/blobs",
      body: { content: "eHl6", encoding: "base64" },
    })
    const second = await server.handle({
      method: "POST",
      path: "/git/blobs",
      body: { content: "eHl6", encoding: "base64" },
    })
    expect((first.json as { sha: string }).sha).toBe((second.json as { sha: string }).sha)
  })

  it("an identical overlay reproduces the base tree sha; deletes actually delete", async () => {
    const spec = await buildSpec()
    const server = new FakeGithubServer(spec)
    const equal = await server.handle({
      method: "POST",
      path: "/git/trees",
      body: {
        base_tree: spec.treeSha,
        tree: [
          { path: "src/content/site.json", sha: spec.files.get("src/content/site.json")?.sha },
        ],
      },
    })
    expect((equal.json as { sha: string }).sha).toBe(spec.treeSha)

    const removed = await server.handle({
      method: "POST",
      path: "/git/trees",
      body: { base_tree: spec.treeSha, tree: [{ path: "src/content/site.json", sha: null }] },
    })
    expect((removed.json as { sha: string }).sha).not.toBe(spec.treeSha)
  })

  it("unknown blob shas are 422 validation (never silent ghost entries)", async () => {
    const spec = await buildSpec()
    const server = new FakeGithubServer(spec)
    const response = await server.handle({
      method: "POST",
      path: "/git/trees",
      body: { base_tree: spec.treeSha, tree: [{ path: "x.json", sha: "ff".repeat(20) }] },
    })
    expect(response.status).toBe(422)
  })

  it("commits are canonical: equal content ⇒ equal sha, count grows once", async () => {
    const spec = await buildSpec()
    const server = new FakeGithubServer(spec)
    const payload = {
      message: "chore(cms): save 1 file(s)",
      tree: spec.treeSha,
      parents: [spec.headSha],
    }
    const first = await body(
      await server.handle({ method: "POST", path: "/git/commits", body: payload }),
    )
    const second = await body(
      await server.handle({ method: "POST", path: "/git/commits", body: payload }),
    )
    expect(first.sha).toBe(second.sha)
    expect(server.commitCount()).toBe(2) // seed + the single canonical commit
  })

  it("unknown parents or trees fail 422", async () => {
    const spec = await buildSpec()
    const server = new FakeGithubServer(spec)
    const badParent = await server.handle({
      method: "POST",
      path: "/git/commits",
      body: { message: "x", tree: spec.treeSha, parents: ["ef".repeat(20)] },
    })
    const badTree = await server.handle({
      method: "POST",
      path: "/git/commits",
      body: { message: "x", tree: "ef".repeat(20), parents: [spec.headSha] },
    })
    expect(badParent.status).toBe(422)
    expect(badTree.status).toBe(422)
  })
})

describe("FakeGithubServer — fast-forward ref law (INV-P01 model basis)", () => {
  it("accepts a child of the current head; refuses a commit parented on a stale head", async () => {
    const spec = await buildSpec()
    const server = new FakeGithubServer(spec)
    const child = await body(
      await server.handle({
        method: "POST",
        path: "/git/commits",
        body: { message: "edit", tree: spec.treeSha, parents: [spec.headSha] },
      }),
    )
    const ok = await server.handle({
      method: "PATCH",
      path: "/git/refs/heads/fixture-branch",
      body: { sha: child.sha as string, force: false },
    })
    expect(ok.status).toBe(200)

    // New commit parented on the OLD head — no longer fast-forward.
    const stale = await body(
      await server.handle({
        method: "POST",
        path: "/git/commits",
        body: { message: "stale base edit", tree: spec.treeSha, parents: [spec.headSha] },
      }),
    )
    expect(stale.sha).not.toBe(child.sha)
    const refused = await server.handle({
      method: "PATCH",
      path: "/git/refs/heads/fixture-branch",
      body: { sha: stale.sha as string, force: false },
    })
    expect(refused.status).toBe(422)
    expect((refused.json as { message: string }).message.toLowerCase()).toContain("fast forward")
  })

  it("non-FF PATCH returns 422 with the fast-forward body", async () => {
    const spec = await buildSpec()
    const server = new FakeGithubServer(spec)
    server.setRef("fixture-branch", "9e".repeat(20))
    const response = await server.handle({
      method: "PATCH",
      path: "/git/refs/heads/fixture-branch",
      body: { sha: spec.headSha, force: false },
    })
    expect(response.status).toBe(422)
    expect((response.json as { message: string }).message.toLowerCase()).toContain("fast forward")
  })

  it("force:true IS honored (real-github truth) but leaves a log fingerprint", async () => {
    const spec = await buildSpec()
    const server = new FakeGithubServer(spec)
    server.setRef("fixture-branch", "9e".repeat(20))
    const response = await server.handle({
      method: "PATCH",
      path: "/git/refs/heads/fixture-branch",
      body: { sha: spec.headSha, force: true },
    })
    expect(response.status).toBe(200)
    const fingerprint = server.log.find(
      (event) => event.method === "PATCH" && (event.body as { force?: unknown })?.force === true,
    )
    expect(fingerprint).toBeDefined()
  })

  it("same-sha PATCH is a no-op 200; malformed bodies 422", async () => {
    const spec = await buildSpec()
    const server = new FakeGithubServer(spec)
    const noOp = await server.handle({
      method: "PATCH",
      path: "/git/refs/heads/fixture-branch",
      body: { sha: spec.headSha, force: false },
    })
    expect(noOp.status).toBe(200)
    const malformed = await server.handle({
      method: "PATCH",
      path: "/git/refs/heads/fixture-branch",
      body: { sha: "not-a-sha" },
    })
    expect(malformed.status).toBe(422)
  })

  it("never-written branches fall back to the seeded head (fixture parity)", async () => {
    const spec = await buildSpec()
    const server = new FakeGithubServer(spec)
    const response = await server.handle({ method: "GET", path: "/git/ref/heads/quiet-branch" })
    // Reads: MSW layer adds the legacy any-branch fallback; the model reports
    // what it tracks — unknown branches miss.
    expect(response.status).toBe(404)
  })
})

describe("FakeGithubServer — empty-repository mode (ADR-0011 model truth)", () => {
  function emptySpec(): FakeGithubSpec {
    return {
      defaultBranch: "fixture-branch",
      headSha: "",
      treeSha: "",
      files: new Map(),
      empty: true,
    }
  }

  it("answers every branch-addressed ref read 409 with the empty-repo body", async () => {
    const server = new FakeGithubServer(emptySpec())
    for (const branch of ["fixture-branch", "any-other-branch"]) {
      const response = await server.handle({
        method: "GET",
        path: `/git/ref/heads/${branch}`,
      })
      expect(response.status).toBe(409)
      expect((response.json as { message?: string }).message).toMatch(/git repository is empty/i)
    }
  })

  it("serves no contents and answers the commit log 409 like the ref route", async () => {
    const server = new FakeGithubServer(emptySpec())
    expect(server.contents("fixture-branch", "src/content/anything.json")).toBeUndefined()
    const log = await server.handle({ method: "GET", path: "/commits" })
    expect(log.status).toBe(409)
    expect((log.json as { message?: string }).message).toMatch(/git repository is empty/i)
  })

  it("closes EVERY git-data write on the empty state with the 409 empty body", async () => {
    // Live-verified truth (ADR-0011): a zero-commit repo does not merely refuse
    // ref writes — the ENTIRE git-data API (blobs/trees/commits/refs) answers
    // 409. Only the REST contents PUT stays open (#putContents below).
    const server = new FakeGithubServer(emptySpec())
    const writes: readonly { method: string; path: string; body?: unknown }[] = [
      { method: "POST", path: "/git/blobs", body: { content: "aGk=", encoding: "base64" } },
      { method: "POST", path: "/git/trees", body: { tree: [] } },
      { method: "POST", path: "/git/commits", body: { message: "x", tree: "ab".repeat(20) } },
      {
        method: "POST",
        path: "/git/refs",
        body: { ref: "refs/heads/fixture-branch", sha: "ab".repeat(20) },
      },
      {
        method: "PATCH",
        path: "/git/refs/heads/fixture-branch",
        body: { sha: "ab".repeat(20), force: false },
      },
    ]
    for (const write of writes) {
      const response = await server.handle({
        method: write.method,
        path: write.path,
        body: write.body,
      })
      expect(response.status).toBe(409)
      expect((response.json as { message?: string }).message).toMatch(/git repository is empty/i)
    }
    expect(server.ref("fixture-branch")).toBeUndefined()
    expect(server.commitCount()).toBe(0)
  })

  it("PUT /contents creates the root commit AND the branch in one request", async () => {
    const server = new FakeGithubServer(emptySpec())
    const response = await server.handle({
      method: "PUT",
      path: "/contents/src/content/seed.json",
      body: {
        message: "chore(cms): bootstrap",
        content: encodeBase64(encodeUtf8(SITE)),
        branch: "fixture-branch",
      },
    })
    expect(response.status).toBe(201)
    const payload = (await body(response)) as {
      content: { sha: string }
      commit: { sha: string; tree: { sha: string } }
    }
    expect(payload.commit.sha).toMatch(/^[0-9a-f]{40}$/)
    expect(server.ref("fixture-branch")).toBe(payload.commit.sha)
    // The first commit IS a root commit (the CAS premise of a bootstrap).
    const commit = await server.handle({
      method: "GET",
      path: `/git/commits/${payload.commit.sha}`,
    })
    expect(((await body(commit)) as { parents: string[] }).parents).toEqual([])
    // Once seeded, the git-data API opens up (emptiness is live commit state).
    const refRead = await server.handle({ method: "GET", path: "/git/ref/heads/fixture-branch" })
    expect(refRead.status).toBe(200)
    expect(server.contents("fixture-branch", "src/content/seed.json")?.sha).toBe(
      payload.content.sha,
    )
  })

  it("refuses PUT /contents of an existing path without its sha (422 sha wasn't supplied)", async () => {
    const server = new FakeGithubServer(emptySpec())
    const first = await server.handle({
      method: "PUT",
      path: "/contents/src/content/seed.json",
      body: { message: "seed", content: encodeBase64(encodeUtf8(SITE)), branch: "fixture-branch" },
    })
    expect(first.status).toBe(201)
    const seededSha = ((await body(first)) as { commit: { sha: string } }).commit.sha
    const second = await server.handle({
      method: "PUT",
      path: "/contents/src/content/seed.json",
      body: {
        message: "collide",
        content: encodeBase64(encodeUtf8(SITE)),
        branch: "fixture-branch",
      },
    })
    expect(second.status).toBe(422)
    // The wire body is the JSON-serialized form: quotes around `sha` escaped —
    // this exact class is what the write classifier maps to CAS_CONFLICT.
    expect(JSON.stringify(second.json)).toContain('\\"sha\\" wasn')
    // The collided PUT mutated nothing: the branch keeps the seed commit.
    expect(server.ref("fixture-branch")).toBe(seededSha)
  })
})
