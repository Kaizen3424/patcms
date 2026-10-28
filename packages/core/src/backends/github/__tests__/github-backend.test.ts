/// <reference types="node" />
import { Buffer } from "node:buffer"
import { describe, expect, it } from "vitest"
import { BackendReadError } from "../../../backend/errors"
import type { FetchLike, FetchRequestInitLike, FetchResponseLike } from "../../../composition"
import { encodeBranch, GithubBackend } from ".."

const HEAD = "1".repeat(40)
const TREE = "2".repeat(40)
const FILE = "3".repeat(40)
const FILE_TEXT = '{\n  "title": "iris"\n}\n'
const FILE_BASE64 = Buffer.from(FILE_TEXT, "utf8").toString("base64")
const OWNER = "owner"
const REPO = "repo"
const BASE = "https://api.github.com"
const TOKEN = "ghp_secret_token_value"

interface Call {
  readonly url: string
  readonly init: FetchRequestInitLike | undefined
}

function response(
  body: unknown,
  options: { status?: number; etag?: string; headers?: Record<string, string> } = {},
): FetchResponseLike {
  const status = options.status ?? 200
  const text = typeof body === "string" ? body : JSON.stringify(body)
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "ERR",
    headers: {
      get(name: string) {
        const lower = name.toLowerCase()
        if (lower === "etag") return options.etag ?? null
        return options.headers?.[lower] ?? null
      },
    },
    json: async () => JSON.parse(text),
    text: async () => text,
  }
}

function recordsFetch(
  handler: (url: string, init: FetchRequestInitLike | undefined) => FetchResponseLike,
) {
  const calls: Call[] = []
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, init })
    return handler(url, init)
  }
  return { fetch, calls }
}

function backend(fetch: FetchLike, token = TOKEN): GithubBackend {
  return new GithubBackend({ owner: OWNER, repo: REPO, token, fetch })
}

describe("GithubBackend read transport (ADR-0005 P1 addendum)", () => {
  it("encodes branch segments and keeps the token out of the URL", async () => {
    const { fetch, calls } = recordsFetch((url) => {
      if (url.includes("/git/ref/heads/")) {
        return response({ ref: "refs/heads/feature/a+b", object: { sha: HEAD, type: "commit" } })
      }
      throw new Error(`unexpected ${url}`)
    })
    const ref = await backend(fetch).getRef("feature/a+b")
    expect(ref.object.sha).toBe(HEAD)
    expect(calls[0]?.url).toBe(`${BASE}/repos/${OWNER}/${REPO}/git/ref/heads/feature/a%2Bb`)
    expect(calls[0]?.url).not.toContain(TOKEN)
    expect(calls[0]?.init?.headers?.Authorization).toBe(`Bearer ${TOKEN}`)
    expect(encodeBranch("release/2026+")).toBe("release/2026%2B")
  })

  it("reads a recursive tree, returns its ETag, and honors 304", async () => {
    const { fetch } = recordsFetch((url, init) => {
      if (url.includes("/git/commits/")) {
        return response({ sha: HEAD, tree: { sha: TREE } })
      }
      if (url.includes(`/git/trees/${TREE}?recursive=1`)) {
        const etag = init?.headers?.["If-None-Match"]
        if (etag === '"tree-v1"') return response("", { status: 304, etag: '"tree-v1"' })
        return response(
          {
            sha: TREE,
            truncated: false,
            tree: [{ path: "src/content/site.json", mode: "100644", type: "blob", sha: FILE }],
          },
          { etag: '"tree-v1"' },
        )
      }
      throw new Error(`unexpected ${url}`)
    })
    const api = backend(fetch)
    const first = await api.readTree("fixture-branch", HEAD)
    expect(first.kind).toBe("tree")
    if (first.kind !== "tree") return
    expect(first.tree.entries).toEqual([
      { path: "src/content/site.json", sha: FILE, mode: "100644", type: "blob" },
    ])
    expect(first.tree.truncated).toBe(false)
    expect(first.etag).toBe('"tree-v1"')

    const cached = await api.readTree("fixture-branch", HEAD, { etag: '"tree-v1"' })
    expect(cached).toEqual({ kind: "not-modified", etag: '"tree-v1"' })
  })

  it("falls back to walking subtrees when the recursive tree is truncated", async () => {
    const srcTree = "4".repeat(40)
    const contentTree = "5".repeat(40)
    const { fetch } = recordsFetch((url) => {
      if (url.includes("/git/commits/")) return response({ sha: HEAD, tree: { sha: TREE } })
      if (url.includes(`/git/trees/${TREE}?recursive=1`)) {
        return response({ sha: TREE, truncated: true, tree: [] }, { etag: '"root"' })
      }
      if (url.endsWith(`/git/trees/${TREE}`)) {
        return response({
          sha: TREE,
          truncated: false,
          tree: [{ path: "src", mode: "040000", type: "tree", sha: srcTree }],
        })
      }
      if (url.endsWith(`/git/trees/${srcTree}`)) {
        return response({
          sha: srcTree,
          truncated: false,
          tree: [{ path: "content", mode: "040000", type: "tree", sha: contentTree }],
        })
      }
      if (url.endsWith(`/git/trees/${contentTree}`)) {
        return response({
          sha: contentTree,
          truncated: false,
          tree: [{ path: "site.json", mode: "100644", type: "blob", sha: FILE }],
        })
      }
      throw new Error(`unexpected ${url}`)
    })
    const result = await backend(fetch).readTree("fixture-branch", HEAD)
    expect(result.kind).toBe("tree")
    if (result.kind !== "tree") return
    expect(result.tree.truncated).toBe(false)
    expect(result.tree.entries).toEqual([
      { path: "src/content/site.json", sha: FILE, mode: "100644", type: "blob" },
    ])
  })

  it("fails loudly when a subtree is still truncated", async () => {
    const { fetch } = recordsFetch((url) => {
      if (url.includes("/git/commits/")) return response({ sha: HEAD, tree: { sha: TREE } })
      if (url.includes("?recursive=1")) return response({ sha: TREE, truncated: true, tree: [] })
      return response({ sha: TREE, truncated: true, tree: [] })
    })
    await expect(backend(fetch).readTree("fixture-branch", HEAD)).rejects.toMatchObject({
      code: "TREE_TRUNCATED",
    })
  })

  it("reads file bytes from contents and honors its ETag", async () => {
    const { fetch } = recordsFetch((url, init) => {
      if (url.includes("/contents/src/content/site.json")) {
        if (init?.headers?.["If-None-Match"] === '"file-v1"') {
          return response("", { status: 304, etag: '"file-v1"' })
        }
        expect(url).toContain("ref=fixture-branch")
        return response(
          {
            type: "file",
            sha: FILE,
            size: Buffer.byteLength(FILE_TEXT),
            encoding: "base64",
            content: FILE_BASE64,
          },
          { etag: '"file-v1"' },
        )
      }
      throw new Error(`unexpected ${url}`)
    })
    const api = backend(fetch)
    const first = await api.readFile("fixture-branch", "src/content/site.json", FILE)
    expect(first.kind).toBe("file")
    if (first.kind !== "file") return
    expect(Buffer.from(first.file.bytes).toString("utf8")).toBe(FILE_TEXT)
    expect(first.file.sha).toBe(FILE)
    expect(first.etag).toBe('"file-v1"')

    const cached = await api.readFile("fixture-branch", "src/content/site.json", FILE, {
      etag: '"file-v1"',
    })
    expect(cached).toEqual({ kind: "not-modified", etag: '"file-v1"' })
  })

  it("falls back to git blobs for files above the contents inline limit", async () => {
    const big = "x".repeat(1_000_001)
    const bigBase64 = Buffer.from(big, "utf8").toString("base64")
    const { fetch, calls } = recordsFetch((url) => {
      if (url.includes("/contents/")) {
        return response({ type: "file", sha: FILE, size: 1_000_001, encoding: "none", content: "" })
      }
      if (url.includes(`/git/blobs/${FILE}`)) {
        return response({ sha: FILE, size: 1_000_001, encoding: "base64", content: bigBase64 })
      }
      throw new Error(`unexpected ${url}`)
    })
    const result = await backend(fetch).readFile("fixture-branch", "src/content/big.json", FILE)
    expect(result.kind).toBe("file")
    if (result.kind !== "file") return
    expect(result.file.size).toBe(1_000_001)
    expect(new TextDecoder().decode(result.file.bytes)).toBe(big)
    expect(calls.some((call) => call.url.includes("/git/blobs/"))).toBe(true)
  })

  it("maps transport failures to typed read errors", async () => {
    const cases: Array<[number, Record<string, string>, string]> = [
      [401, {}, "AUTH_EXPIRED"],
      [403, { "x-ratelimit-remaining": "0" }, "RATE_LIMIT"],
      [403, {}, "SCOPE"],
      [404, {}, "NOT_FOUND"],
      [429, { "retry-after": "30" }, "RATE_LIMIT"],
      [500, {}, "UNKNOWN"],
    ]
    for (const [status, headers, code] of cases) {
      const { fetch } = recordsFetch(() => response({ message: "x" }, { status, headers }))
      const caught = await backend(fetch)
        .getRef("fixture-branch")
        .catch((error: unknown) => error)
      expect(caught).toBeInstanceOf(BackendReadError)
      expect((caught as BackendReadError).code).toBe(code)
    }

    const network = backend(async () => {
      throw new Error("offline")
    })
    await expect(network.getRef("fixture-branch")).rejects.toMatchObject({ code: "NETWORK" })
  })

  it("refuses malformed JSON without leaking response bodies", async () => {
    const { fetch } = recordsFetch(() => response("{not-json"))
    const caught = await backend(fetch)
      .getRef("fixture-branch")
      .catch((error: unknown) => error)
    expect(caught).toBeInstanceOf(BackendReadError)
    expect((caught as BackendReadError).code).toBe("UNKNOWN")
    expect((caught as Error).message).not.toContain("not-json")
  })

  it("diffs trees and returns an empty map for identical commits", async () => {
    const { fetch } = recordsFetch((url) => {
      if (url.includes("/git/commits/")) return response({ sha: HEAD, tree: { sha: TREE } })
      if (url.includes("?recursive=1")) {
        return response({
          sha: TREE,
          truncated: false,
          tree: [{ path: "src/content/site.json", mode: "100644", type: "blob", sha: FILE }],
        })
      }
      throw new Error(`unexpected ${url}`)
    })
    const api = backend(fetch)
    expect((await api.listChangedFiles("fixture-branch", HEAD, HEAD)).size).toBe(0)
  })

  it("reads check runs by exact sha with per_page=100 and honest totals", async () => {
    const { fetch, calls } = recordsFetch(() =>
      response({
        total_count: 3,
        check_runs: [
          {
            id: 1,
            name: "pages",
            status: "completed",
            conclusion: "success",
            details_url: "https://github.com/owner/repo/runs/1",
          },
          { id: 2, name: "mystery", status: "unknown-status", conclusion: "mystery" },
          {
            id: 3,
            name: "unsafe-link",
            status: "completed",
            conclusion: "neutral",
            details_url: "javascript:alert(1)",
          },
        ],
      }),
    )
    const read = await backend(fetch).readCheckRuns("fixture-branch", HEAD)
    expect(read).toMatchObject({ kind: "ok", totalCount: 3 })
    if (read.kind !== "ok") return
    expect(read.runs[0]).toEqual({
      id: 1,
      name: "pages",
      status: "completed",
      conclusion: "success",
      detailsUrl: "https://github.com/owner/repo/runs/1",
    })
    expect(read.runs[1]).toMatchObject({ name: "mystery", status: "pending", conclusion: null })
    expect(read.runs[2]?.detailsUrl).toBeUndefined()
    expect(calls[0]?.url).toBe(
      `${BASE}/repos/${OWNER}/${REPO}/commits/${HEAD}/check-runs?per_page=100`,
    )
    // Branch is a contract parameter, never part of GitHub's sha-scoped route.
    expect(calls[0]?.url).not.toContain("fixture-branch")
  })

  it("surfaces an incomplete check-run page as totalCount > runs", async () => {
    const { fetch } = recordsFetch(() =>
      response({
        total_count: 120,
        check_runs: [{ id: 1, name: "pages", status: "in_progress", conclusion: null }],
      }),
    )
    const read = await backend(fetch).readCheckRuns("fixture-branch", HEAD)
    expect(read).toMatchObject({ kind: "ok", totalCount: 120 })
    if (read.kind === "ok") expect(read.runs).toHaveLength(1)
  })

  it("reads combined statuses, keeping the newest per context", async () => {
    const { fetch, calls } = recordsFetch(() =>
      response({
        state: "failure",
        total_count: 3,
        statuses: [
          { context: "ci/site", state: "failure", target_url: "https://ci.example/1" },
          { context: "ci/site", state: "success" },
          { context: "other", state: "weird", target_url: "http://ci.example/2" },
        ],
      }),
    )
    const read = await backend(fetch).readCommitStatuses("fixture-branch", HEAD)
    expect(read).toMatchObject({
      kind: "ok",
      statuses: [
        { context: "ci/site", state: "failure", targetUrl: "https://ci.example/1" },
        { context: "other", state: "pending" },
      ],
    })
    expect(calls[0]?.url).toBe(`${BASE}/repos/${OWNER}/${REPO}/commits/${HEAD}/status`)
  })
})
