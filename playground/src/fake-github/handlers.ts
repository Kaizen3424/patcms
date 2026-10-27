/**
 * MSW FakeGithub — P1.14 read handlers + P2 write handlers.
 *
 * ALL endpoint semantics (refs, commits, trees, blobs, contents, writes,
 * FF-only CAS) delegate to the core `FakeGithubServer` reference model, so the
 * fixture harness and the core INVs share ONE framing/permission source
 * (ADR-0005 P2 addendum). This file stays the transport layer: URL routing,
 * ETag/304, truncation chaos, auth + rate-limit guards, response shaping.
 */

import type { FakeResponse } from "@mycms/core"
import { FakeGithubServer } from "@mycms/core"
import { HttpResponse, http } from "msw"
import type { FixtureRepoFile, FixtureRepoSnapshot } from "./fixture-repo"

const API_ORIGIN = "https://api.github.com"

export interface FakeGithubTags {
  readonly owner: string
  readonly repo: string
}

export const DEFAULT_TAGS: FakeGithubTags = { owner: "mycms-fixtures", repo: "demo" }

export interface FakeGithubChaos {
  /** Return `truncated: true` on the recursive tree read (subtree fallback must save it). */
  readonly truncateTree?: boolean
  /** Return `truncated: true` on subtree reads too (loud INV-N02 failure). */
  readonly truncateSubtrees?: boolean
  /** Paths that return 404 from the contents route. */
  readonly notFoundPaths?: readonly string[]
  /** Return 429 once for the next request (quota chaos). */
  readonly rateLimitOnce?: boolean
}

export interface FakeGithubOptions {
  readonly chaos?: FakeGithubChaos
  /** When true, requests without a Bearer token get 401 (contract/probe tests). */
  readonly requireAuth?: boolean
}

/**
 * Handlers + the reference server behind them. The server is returned so the
 * playground can publish it on the e2e harness (`window.__mycmsHarness`): the
 * fake repo's state is the only place a save can be observed, because the MSW
 * worker resets it on reload.
 */
export function createFakeGithubHandlers(
  snapshot: FixtureRepoSnapshot,
  tags: FakeGithubTags = DEFAULT_TAGS,
  options: FakeGithubOptions = {},
) {
  const repoPath = `${API_ORIGIN}/repos/${tags.owner}/${tags.repo}`
  const chaos = options.chaos ?? {}
  const server = new FakeGithubServer({
    defaultBranch: snapshot.defaultBranch,
    headSha: snapshot.headSha,
    treeSha: snapshot.treeSha,
    files: new Map(
      [...snapshot.entries.values()].map((entry) => [
        entry.path,
        { bytes: entry.bytes, sha: entry.sha },
      ]),
    ),
  })
  let rateLimited = false

  const guarded = (resolver: (args: RequestGuardArgs) => Response | Promise<Response>) => {
    return (args: RequestGuardArgs) => {
      if (
        options.requireAuth === true &&
        !args.request.headers.get("authorization")?.startsWith("Bearer ")
      ) {
        return HttpResponse.json(
          { message: "Bad credentials" },
          { status: 401, headers: rateHeaders() },
        )
      }
      if (chaos.rateLimitOnce === true && !rateLimited) {
        rateLimited = true
        return HttpResponse.json(
          { message: "API rate limit exceeded" },
          { status: 429, headers: { ...rateHeaders(), "retry-after": "30" } },
        )
      }
      return resolver(args)
    }
  }

  /** Adapter: repo-relative path → FakeGithubServer → HttpResponse. */
  const toHttp = (response: FakeResponse): Response =>
    HttpResponse.json(response.json ?? {}, {
      status: response.status,
      headers: { ...rateHeaders(), ...(response.headers ?? {}) },
    })

  const handlers = [
    http.get(
      repoPath,
      guarded(() =>
        HttpResponse.json(
          {
            name: tags.repo,
            full_name: `${tags.owner}/${tags.repo}`,
            default_branch: snapshot.defaultBranch,
            private: true,
          },
          { headers: rateHeaders() },
        ),
      ),
    ),
    http.get(
      `${API_ORIGIN}/rate_limit`,
      guarded(() =>
        HttpResponse.json(
          {
            resources: {
              core: { limit: 5000, remaining: 4999, reset: Math.floor(Date.now() / 1000) + 3600 },
            },
          },
          { headers: rateHeaders() },
        ),
      ),
    ),
    http.get(
      `${repoPath}/branches/*/protection`,
      guarded(() =>
        HttpResponse.json({ required_status_checks: null }, { headers: rateHeaders() }),
      ),
    ),
    http.get(
      `${repoPath}/commits/*/check-runs`,
      guarded(() =>
        HttpResponse.json({ total_count: 0, check_runs: [] }, { headers: rateHeaders() }),
      ),
    ),
    http.get(
      `${repoPath}/git/ref/*`,
      guarded(({ request }) => {
        const branch = refBranch(request.url)
        if (branch === null) return notFound()
        const sha = server.ref(branch) ?? snapshot.headSha
        return HttpResponse.json(
          {
            ref: `refs/heads/${branch}`,
            node_id: fixtureNodeId(branch),
            object: { sha, type: "commit" },
          },
          { headers: rateHeaders() },
        )
      }),
    ),
    http.get(
      `${repoPath}/git/commits/:sha`,
      guarded(async ({ params }) => {
        return toHttp(
          await server.handle({
            method: "GET",
            path: `/git/commits/${String(params.sha)}`,
          }),
        )
      }),
    ),
    http.get(
      `${repoPath}/git/trees/:sha`,
      guarded(async ({ request, params }) => {
        const sha = String(params.sha)
        const response = await server.handle({ method: "GET", path: `/git/trees/${sha}` })
        if (response.status === 404) return notFound()
        const recursive = new URL(request.url).searchParams.get("recursive") === "1"
        const etag = recursive ? `"tree-${sha}"` : `"${sha}-flat"`
        if (request.headers.get("if-none-match") === etag) {
          return new HttpResponse(null, { status: 304, headers: { etag } })
        }
        if (recursive && chaos.truncateTree === true) {
          return HttpResponse.json(
            { sha, truncated: true, tree: [] },
            { headers: { ...rateHeaders(), etag } },
          )
        }
        if (!recursive && chaos.truncateSubtrees === true) {
          return HttpResponse.json(
            { sha, truncated: true, tree: [] },
            { headers: { ...rateHeaders(), etag } },
          )
        }
        const payload = (response.json ?? {}) as {
          sha: string
          truncated: boolean
          tree: Array<{ path: string; mode: string; type: string; sha: string }>
        }
        return HttpResponse.json(
          {
            sha: payload.sha,
            truncated: payload.truncated,
            tree: payload.tree.map((entry) => {
              const size = server.blobSize(entry.sha)
              return size === undefined ? entry : { ...entry, size }
            }),
          },
          { headers: { ...rateHeaders(), etag } },
        )
      }),
    ),
    http.get(
      `${repoPath}/contents/*`,
      guarded(({ request }) => {
        const path = contentsPath(request.url)
        if (path === null) return notFound()
        if (chaos.notFoundPaths?.includes(path) === true) return notFound()
        const ref = new URL(request.url).searchParams.get("ref") ?? snapshot.defaultBranch
        const resolved = server.contents(ref, path) ?? snapshot.entries.get(path)
        const entry: FixtureRepoFile | undefined =
          resolved === undefined
            ? undefined
            : {
                path,
                bytes: resolved.bytes,
                sha: resolved.sha,
                etag: `"${resolved.sha}"`,
              }
        if (entry === undefined) return notFound()
        const etag = `"${entry.sha}"`
        if (request.headers.get("if-none-match") === etag) {
          return new HttpResponse(null, { status: 304, headers: { etag } })
        }
        if (entry.bytes.byteLength > 1_000_000) {
          return HttpResponse.json(
            {
              type: "file",
              sha: entry.sha,
              size: entry.bytes.byteLength,
              encoding: "none",
              content: "",
            },
            { headers: { ...rateHeaders(), etag } },
          )
        }
        return HttpResponse.json(
          {
            type: "file",
            sha: entry.sha,
            size: entry.bytes.byteLength,
            encoding: "base64",
            content: bytesToBase64(entry.bytes),
          },
          { headers: { ...rateHeaders(), etag } },
        )
      }),
    ),
    http.get(
      `${repoPath}/git/blobs/:sha`,
      guarded(async ({ params }) => {
        const response = await server.handle({
          method: "GET",
          path: `/git/blobs/${String(params.sha)}`,
        })
        if (response.status !== 404) return toHttp(response)
        const legacy = findEntryBySha(snapshot.entries, String(params.sha))
        if (legacy === undefined) return notFound()
        return HttpResponse.json(
          {
            sha: legacy.sha,
            size: legacy.bytes.byteLength,
            encoding: "base64",
            content: bytesToBase64(legacy.bytes),
          },
          { headers: rateHeaders() },
        )
      }),
    ),
    // ---- P2 write handlers (same reference model, hence same CAS laws) ----
    http.post(
      `${repoPath}/git/blobs`,
      guarded(async ({ request }) => {
        return toHttp(
          await server.handle({
            method: "POST",
            path: "/git/blobs",
            body: await readJson(request),
          }),
        )
      }),
    ),
    http.post(
      `${repoPath}/git/trees`,
      guarded(async ({ request }) => {
        return toHttp(
          await server.handle({
            method: "POST",
            path: "/git/trees",
            body: await readJson(request),
          }),
        )
      }),
    ),
    http.post(
      `${repoPath}/git/commits`,
      guarded(async ({ request }) => {
        return toHttp(
          await server.handle({
            method: "POST",
            path: "/git/commits",
            body: await readJson(request),
          }),
        )
      }),
    ),
    http.patch(
      `${repoPath}/git/refs/heads/*`,
      guarded(async ({ request }) => {
        const branch = patchBranch(request.url)
        if (branch === null) return notFound()
        return toHttp(
          await server.handle({
            method: "PATCH",
            path: `/git/refs/heads/${branch}`,
            body: await readJson(request),
          }),
        )
      }),
    ),
  ]

  return { handlers, server }
}

// Handler arg types differ per verb at runtime only; the guard cares about the
// request. MSW's PathParams allows arrays/undefined per key — read sites cast.
interface RequestGuardArgs {
  readonly request: Request
  readonly params: { readonly [key: string]: string | readonly string[] | undefined }
}

async function readJson(request: Request): Promise<unknown> {
  const text = await request.text()
  if (text.length === 0) return undefined
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

function contentsPath(url: string): string | null {
  const marker = "/contents/"
  const index = url.indexOf(marker)
  if (index < 0) return null
  const encoded = url.slice(index + marker.length).split("?")[0] ?? ""
  try {
    return encoded
      .split("/")
      .map((segment) => decodeURIComponent(segment))
      .join("/")
  } catch {
    return null
  }
}

function findEntryBySha(
  entries: ReadonlyMap<string, FixtureRepoFile>,
  sha: string,
): FixtureRepoFile | undefined {
  for (const entry of entries.values()) {
    if (entry.sha === sha) return entry
  }
  return undefined
}

/** Browser-safe base64 (no Buffer dependency). */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = ""
  const chunk = 0x8000
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk))
  }
  return btoa(binary)
}

/** Branch names URL-decode here; malformed segments refuse (INV-P14 posture). */
function refBranch(url: string): string | null {
  const marker = "/git/ref/"
  const index = url.indexOf(marker)
  if (index < 0) return null
  const ref = url.slice(index + marker.length).split("?")[0] ?? ""
  const prefix = "heads/"
  if (!ref.startsWith(prefix)) return null
  try {
    return ref
      .slice(prefix.length)
      .split("/")
      .map((segment) => decodeURIComponent(segment))
      .join("/")
  } catch {
    return null
  }
}

function patchBranch(url: string): string | null {
  const marker = "/git/refs/heads/"
  const index = url.indexOf(marker)
  if (index < 0) return null
  try {
    return (
      url
        .slice(index + marker.length)
        .split("?")[0]
        ?.split("/")
        .map((segment) => decodeURIComponent(segment))
        .join("/") ?? null
    )
  } catch {
    return null
  }
}

function notFound() {
  return HttpResponse.json({ message: "Not Found" }, { status: 404, headers: rateHeaders() })
}

/** Stable pseudo-node-id for a branch name (fixture determinism, sha-ish hex). */
function fixtureNodeId(branch: string): string {
  let hex = ""
  for (const char of `${branch}#node`) {
    hex += char.charCodeAt(0).toString(16).padStart(2, "0")
  }
  return (hex + hex).slice(0, 40)
}

function rateHeaders() {
  return {
    "x-ratelimit-limit": "5000",
    "x-ratelimit-remaining": "4999",
    "x-ratelimit-reset": "0",
  }
}
