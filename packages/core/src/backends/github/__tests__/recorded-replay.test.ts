import { describe, expect, it } from "vitest"
import type { RecordedTape } from "../recorded-replay"
import {
  canonicalizeJson,
  createReplayFetch,
  normalizeBodyString,
  normalizeRequestPath,
} from "../recorded-replay"

const SAMPLE_TAPE: RecordedTape = {
  schemaVersion: 1,
  meta: {
    schemaVersion: 1,
    recordedAt: "2026-10-29T12:00:00Z",
    owner: "test-owner",
    repo: "test-repo",
    branch: "contract-fixture",
    source: "synthetic",
  },
  interactions: [
    {
      request: {
        method: "GET",
        url: "https://api.github.com/repos/test-owner/test-repo/git/ref/heads/contract-fixture",
      },
      response: {
        status: 200,
        headers: { "content-type": "application/json" },
        body: { ref: "refs/heads/contract-fixture", object: { sha: "11".repeat(20) } },
      },
    },
    {
      request: {
        method: "GET",
        url: "https://api.github.com/repos/test-owner/test-repo/git/ref/heads/contract-fixture",
      },
      response: {
        status: 200,
        headers: { "content-type": "application/json" },
        body: { ref: "refs/heads/contract-fixture", object: { sha: "22".repeat(20) } },
      },
    },
    {
      request: {
        method: "GET",
        url: "https://api.github.com/repos/test-owner/test-repo/git/trees/tree-sha?recursive=1",
      },
      response: {
        status: 200,
        headers: { etag: '"tree-etag-v1"', "content-type": "application/json" },
        body: { sha: "tree-sha", truncated: false, tree: [] },
      },
    },
    {
      request: {
        method: "GET",
        url: "https://api.github.com/repos/test-owner/test-repo/git/trees/tree-sha?recursive=1",
        headers: { "if-none-match": '"tree-etag-v1"' },
      },
      response: {
        status: 304,
        headers: { etag: '"tree-etag-v1"' },
      },
    },
    {
      request: {
        method: "POST",
        url: "https://api.github.com/repos/test-owner/test-repo/git/blobs",
        body: { content: "alpha", encoding: "utf-8" },
      },
      response: {
        status: 201,
        headers: { "content-type": "application/json" },
        body: { sha: "blob-sha-alpha" },
      },
    },
    {
      request: {
        method: "POST",
        url: "https://api.github.com/repos/test-owner/test-repo/git/blobs",
        body: { content: "beta", encoding: "utf-8" },
      },
      response: {
        status: 201,
        headers: { "content-type": "application/json" },
        body: { sha: "blob-sha-beta" },
      },
    },
  ],
}

describe("createReplayFetch", () => {
  it("normalizes json and body strings deterministically", () => {
    expect(canonicalizeJson({ b: 2, a: 1 })).toBe('{"a":1,"b":2}')
    expect(normalizeBodyString('{"y":2,"x":1}')).toBe('{"x":1,"y":2}')
    expect(
      normalizeRequestPath(
        "https://api.github.com/repos/custom-owner/custom-repo/git/commits?page=1",
        "custom-owner",
        "custom-repo",
      ),
    ).toBe("/repos/{owner}/{repo}/git/commits?page=1")
  })

  it("handles case-insensitive header retrieval", async () => {
    const replay = await createReplayFetch(SAMPLE_TAPE)
    const res = await replay(
      "https://api.github.com/repos/test-owner/test-repo/git/ref/heads/contract-fixture",
    )
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toBe("application/json")
    expect(res.headers.get("Content-Type")).toBe("application/json")
    expect(res.headers.get("CONTENT-TYPE")).toBe("application/json")
    expect(res.headers.get("non-existent")).toBeNull()
  })

  it("pops repeated sequential calls in FIFO order", async () => {
    const replay = await createReplayFetch(SAMPLE_TAPE)
    const url = "https://api.github.com/repos/test-owner/test-repo/git/ref/heads/contract-fixture"

    const first = await replay(url)
    const firstJson = (await first.json()) as { object: { sha: string } }
    expect(firstJson.object.sha).toBe("11".repeat(20))

    const second = await replay(url)
    const secondJson = (await second.json()) as { object: { sha: string } }
    expect(secondJson.object.sha).toBe("22".repeat(20))
  })

  it("distinguishes unconditional reads from conditional 304 reads via If-None-Match", async () => {
    const replay = await createReplayFetch(SAMPLE_TAPE)
    const url = "https://api.github.com/repos/test-owner/test-repo/git/trees/tree-sha?recursive=1"

    // 1. Unconditional read -> 200
    const res1 = await replay(url)
    expect(res1.status).toBe(200)
    expect(res1.headers.get("etag")).toBe('"tree-etag-v1"')

    // 2. Conditional read with matching ETag -> 304
    const res2 = await replay(url, {
      headers: { "If-None-Match": '"tree-etag-v1"' },
    })
    expect(res2.status).toBe(304)
    expect(res2.headers.get("etag")).toBe('"tree-etag-v1"')
  })

  it("disambiguates concurrent requests with distinct bodies regardless of call order", async () => {
    const replay = await createReplayFetch(SAMPLE_TAPE)
    const url = "https://api.github.com/repos/test-owner/test-repo/git/blobs"

    // Dispatch "beta" first even though "alpha" was recorded first
    const betaPromise = replay(url, {
      method: "POST",
      body: JSON.stringify({ content: "beta", encoding: "utf-8" }),
    })
    const alphaPromise = replay(url, {
      method: "POST",
      body: JSON.stringify({ encoding: "utf-8", content: "alpha" }), // note key order inverted
    })

    const [resBeta, resAlpha] = await Promise.all([betaPromise, alphaPromise])
    const betaJson = (await resBeta.json()) as { sha: string }
    const alphaJson = (await resAlpha.json()) as { sha: string }

    expect(betaJson.sha).toBe("blob-sha-beta")
    expect(alphaJson.sha).toBe("blob-sha-alpha")
  })

  it("supports parameterized owner and repo mapping", async () => {
    const replay = await createReplayFetch(SAMPLE_TAPE, {
      owner: "custom-org",
      repo: "custom-site",
    })

    const res = await replay(
      "https://api.github.com/repos/custom-org/custom-site/git/ref/heads/contract-fixture",
    )
    expect(res.status).toBe(200)
    const json = (await res.json()) as { ref: string }
    expect(json.ref).toBe("refs/heads/contract-fixture")
  })

  it("reports remainingCount, isDrained, pendingKeys, and supports reset", async () => {
    const replay = await createReplayFetch(SAMPLE_TAPE)
    expect(replay.remainingCount()).toBe(6)
    expect(replay.isDrained()).toBe(false)
    expect(replay.pendingKeys().length).toBe(5)

    // Consume one
    await replay("https://api.github.com/repos/test-owner/test-repo/git/ref/heads/contract-fixture")
    expect(replay.remainingCount()).toBe(5)

    // Reset
    replay.reset()
    expect(replay.remainingCount()).toBe(6)
    expect(replay.isDrained()).toBe(false)
  })

  it("throws rich diagnostic error when request is unrecorded or exhausted", async () => {
    const replay = await createReplayFetch(SAMPLE_TAPE)
    await expect(
      replay("https://api.github.com/repos/test-owner/test-repo/git/unknown-endpoint"),
    ).rejects.toThrow(/\[createReplayFetch\] Unexpected request \(no matching interaction found\)/)
  })
})
