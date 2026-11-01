/**
 * INV test harness — chaos adapters over FakeGithubServer (ADR-0005 P2).
 *
 * The server model is TRUTHFUL; all faults live here:
 * - `faults`: respond an error status WITHOUT running the handler (no state
 *   mutation — INV-P02 fault-at-stage subjects).
 * - `dropAcks`: run the handler (mutation applied) then reject the fetch —
 *   "response lost", the unknown-outcome subject of INV-P09/P10.
 * - `moveRefBefore`: simulate a concurrent foreign push just before a request
 *   matches (INV-P01 concurrent-push fixture).
 */

import { gitBlobSha, gitCommitShaCanonical, gitTreeSha } from "../../backend/git-sha"
import { GithubBackend } from "../../backends/github"
import type { FetchLike, FetchResponseLike } from "../../composition"
import type { FakeGithubSpec, FakeRequest, FakeResponse } from "./fake-github-server"
import { FakeGithubServer } from "./fake-github-server"

export interface FaultSpec {
  readonly method: string
  readonly pathPattern: RegExp
  readonly times: number
  readonly status: number
  /** Optional response headers — rate windows ride on 403/429 faults (INV-P11). */
  readonly headers?: Readonly<Record<string, string>>
}

export interface DropAckSpec {
  readonly method: string
  readonly pathPattern: RegExp
}

export interface MoveRefSpec {
  readonly method: string
  readonly pathPattern: RegExp
  readonly sha: string
}

export interface ChaosSpec {
  readonly faults?: readonly FaultSpec[]
  readonly dropAcks?: readonly DropAckSpec[]
  readonly moveRefBefore?: readonly MoveRefSpec[]
}

export interface HarnessOptions {
  readonly chaos?: ChaosSpec
  readonly owner?: string
  readonly repo?: string
  readonly token?: string
  readonly baseUrl?: string
}

const OWNER_DEFAULT = "fixture-owner"
const REPO_DEFAULT = "fixture-repo"
const BASE_DEFAULT = "https://unit.test"
const TOKEN_DEFAULT = "ghp_fixture_token"

export function buildSpec(
  files: readonly [string, string][],
  defaultBranch = "fixture-branch",
): Promise<FakeGithubSpec> {
  return buildSpecFromBytes(
    files.map(([path, text]) => [path, new TextEncoder().encode(text)] as [string, Uint8Array]),
    defaultBranch,
  )
}

/** Deterministic seeded spec: real blob/tree/commit framing throughout. */
export async function buildSpecFromBytes(
  files: readonly [string, Uint8Array][],
  defaultBranch = "fixture-branch",
): Promise<FakeGithubSpec> {
  const entries = await Promise.all(
    files.map(async ([path, bytes]) => ({ path, sha: await gitBlobSha(bytes), bytes })),
  )
  const treeSha = await gitTreeSha(
    entries.map((entry) => ({ path: entry.path, mode: "100644", type: "blob", sha: entry.sha })),
  )
  const headSha = await gitCommitShaCanonical({
    treeSha,
    parentShas: [],
    message: "seed (fixture)",
  })
  return {
    defaultBranch,
    headSha,
    treeSha,
    files: new Map(entries.map((entry) => [entry.path, { sha: entry.sha, bytes: entry.bytes }])),
  }
}

export interface FakeGithubHarness {
  readonly server: FakeGithubServer
  readonly backend: GithubBackend
  readonly fetch: FetchLike
  /** URL prefix the adapter strips (tests may rebuild backend URLs if needed). */
  readonly prefix: string
}

export function createHarness(
  spec: FakeGithubSpec,
  options: HarnessOptions = {},
): FakeGithubHarness {
  const server = new FakeGithubServer(spec)
  const chaos = options.chaos ?? {}
  const owner = options.owner ?? OWNER_DEFAULT
  const repo = options.repo ?? REPO_DEFAULT
  const baseUrl = options.baseUrl ?? BASE_DEFAULT
  const prefix = `${baseUrl}/repos/${owner}/${repo}`
  const faultBudget = (chaos.faults ?? []).map((fault) => ({ fault, remaining: fault.times }))
  const dropBudget = (chaos.dropAcks ?? []).map((drop) => ({ drop, remaining: 1 }))
  const moveBudget = (chaos.moveRefBefore ?? []).map((move) => ({ move, remaining: 1 }))

  const fetch: FetchLike = async (url, init) => {
    const method = (init?.method ?? "GET").toUpperCase()
    const path = inlineUrlPath(url, prefix)
    let body: unknown
    if (typeof init?.body === "string") {
      body = JSON.parse(init.body)
    }

    for (const move of moveBudget) {
      if (move.remaining <= 0) continue
      if (move.move.method.toUpperCase() !== method || !move.move.pathPattern.test(path)) continue
      move.remaining -= 1
      server.setRef(spec.defaultBranch, move.move.sha)
    }
    for (const fault of faultBudget) {
      if (fault.remaining <= 0) continue
      if (fault.fault.method.toUpperCase() !== method || !fault.fault.pathPattern.test(path)) {
        continue
      }
      fault.remaining -= 1
      return toResponse({
        status: fault.fault.status,
        json: { message: fault.fault.status >= 500 ? "Internal Server Error" : "fixture fault" },
        ...(fault.fault.headers === undefined ? {} : { headers: fault.fault.headers }),
      })
    }
    for (const drop of dropBudget) {
      if (drop.remaining <= 0) continue
      if (drop.drop.method.toUpperCase() !== method || !drop.drop.pathPattern.test(path)) continue
      drop.remaining -= 1
      await server.handle({ method, path, body } satisfies FakeRequest)
      // The remote state advanced; the response never arrived.
      throw new Error("response lost (dropAck chaos)")
    }
    const response = await server.handle({
      method,
      path,
      body,
      headers: safeRequestHeaders(init?.headers),
    } satisfies FakeRequest)
    return toResponse(response)
  }

  const backend = new GithubBackend({
    owner,
    repo,
    token: options.token ?? TOKEN_DEFAULT,
    fetch,
    baseUrl,
  })
  return { server, backend, fetch, prefix }
}

/** Baseline successful save content, reused by several invariant fixtures. */
export const BASE_CONTENT: readonly [string, string][] = [
  ["src/content/site.json", '{\n  "title": "site"\n}\n'],
  ["src/content/products/iris.json", '{\n  "title": "iris"\n}\n'],
]

function inlineUrlPath(url: string, prefix: string): string {
  const withoutQuery = url.split("?")[0] ?? url
  if (withoutQuery.startsWith(prefix)) return withoutQuery.slice(prefix.length)
  return withoutQuery
}

/**
 * Request headers worth logging — Authorization NEVER lands in a log
 * (INV-A05 posture; fixture token or not, the discipline is the point).
 */
function safeRequestHeaders(headers: unknown): Record<string, string> | undefined {
  if (typeof headers !== "object" || headers === null) return undefined
  const safe: Record<string, string> = {}
  for (const [key, value] of Object.entries(headers as Record<string, unknown>)) {
    if (typeof value !== "string") continue
    const lower = key.toLowerCase()
    if (lower === "authorization") continue
    safe[lower] = value
  }
  return Object.keys(safe).length === 0 ? undefined : safe
}

function toResponse(response: FakeResponse): FetchResponseLike {
  const headers = new Map<string, string>(
    Object.entries(response.headers ?? {}).map(([key, value]) => [key.toLowerCase(), value]),
  )
  const text = response.json === undefined ? "" : JSON.stringify(response.json)
  return {
    ok: response.status >= 200 && response.status < 300,
    status: response.status,
    statusText: response.status >= 200 && response.status < 300 ? "OK" : "FAULT",
    headers: {
      get(name: string) {
        return headers.get(name.toLowerCase()) ?? null
      },
    },
    json: async () => (response.json === undefined ? {} : response.json),
    text: async () => text,
  }
}

/** Count successful ref updates (HEAD advanced exactly once subjects). */
export function successfulRefUpdates(server: FakeGithubServer): number {
  return server.log.filter(
    (event) =>
      event.method === "PATCH" && event.path.startsWith("/git/refs/heads/") && event.status === 200,
  ).length
}

/** Blob-sha observations: repeated equal-content creates converge (INV-P03). */
export function blobCreateShas(server: FakeGithubServer): string[] {
  return server.log
    .filter(
      (event) => event.method === "POST" && event.path === "/git/blobs" && event.status === 201,
    )
    .map((event) => (event.body as { sha?: string } | undefined)?.sha ?? "")
}

export function patchBodies(server: FakeGithubServer): unknown[] {
  return server.log.filter((event) => event.method === "PATCH").map((event) => event.body)
}

export function hasForceTrue(server: FakeGithubServer): boolean {
  return patchBodies(server).some((body) => forceFlag(body) === true)
}

function forceFlag(body: unknown): unknown {
  if (typeof body !== "object" || body === null) return undefined
  return (body as { force?: unknown }).force
}
