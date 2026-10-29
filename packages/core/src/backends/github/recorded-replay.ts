/**
 * Recorded HTTP fixture replay transport — ADR-0005 P2.11 addendum.
 *
 * Implements an in-memory FetchLike transport that replays HTTP interactions
 * recorded from a GitHub repository or the reference FakeGithubServer.
 * Uses a Keyed-Endpoint FIFO Queue matching strategy:
 * - Match keys incorporate HTTP method, canonical pathname/query, If-None-Match ETag,
 *   and SHA-1 of request body.
 * - Monotonic consecutive calls (e.g. repeated getRef) pop responses FIFO.
 * - Concurrent requests (e.g. parallel blob creation) are disambiguated by body hash.
 * - Zero external runtime dependencies; purely in-memory.
 */

import { sha1Hex } from "../../backend/git-sha"
import type { FetchLike, FetchRequestInitLike, FetchResponseLike } from "../../composition"

export interface RecordedRequest {
  readonly method: string
  readonly url: string
  readonly headers?: Record<string, string>
  readonly body?: unknown
}

export interface RecordedResponse {
  readonly status: number
  readonly statusText?: string
  readonly headers: Record<string, string>
  readonly body?: unknown
}

export interface RecordedInteraction {
  readonly request: RecordedRequest
  readonly response: RecordedResponse
}

export interface RecordedTapeMeta {
  readonly schemaVersion: 1
  readonly recordedAt: string
  readonly owner: string
  readonly repo: string
  readonly branch: string
  readonly source: "sandbox" | "synthetic"
  readonly description?: string
}

export interface RecordedTape {
  readonly schemaVersion: 1
  readonly meta: RecordedTapeMeta
  readonly interactions: readonly RecordedInteraction[]
}

export interface ReplayFetchOptions {
  /** Override the owner parameter in URLs during replay (defaults to tape.meta.owner). */
  readonly owner?: string
  /** Override the repo parameter in URLs during replay (defaults to tape.meta.repo). */
  readonly repo?: string
}

export type ReplayFetch = FetchLike & {
  /** Returns the total count of unconsumed interactions remaining across all queues. */
  readonly remainingCount: () => number
  /** True when all recorded interactions have been consumed. */
  readonly isDrained: () => boolean
  /** List of remaining match keys with their pending queue counts. */
  readonly pendingKeys: () => readonly { key: string; count: number }[]
  /** Resets queues back to the original tape state. */
  readonly reset: () => void
}

/** Recursively canonicalizes JSON values with sorted object keys. */
export function canonicalizeJson(val: unknown): string {
  if (val === null || typeof val !== "object") {
    return JSON.stringify(val)
  }
  if (Array.isArray(val)) {
    return `[${val.map(canonicalizeJson).join(",")}]`
  }
  const record = val as Record<string, unknown>
  const sortedKeys = Object.keys(record).sort()
  const entries = sortedKeys.map((k) => `${JSON.stringify(k)}:${canonicalizeJson(record[k])}`)
  return `{${entries.join(",")}}`
}

/** Normalizes a request body into a canonical string for SHA-1 hashing. */
export function normalizeBodyString(body: unknown): string {
  if (body === undefined || body === null) return ""
  if (typeof body === "string") {
    try {
      const parsed = JSON.parse(body)
      return canonicalizeJson(parsed)
    } catch {
      return body
    }
  }
  if (body instanceof Uint8Array) {
    const text = new TextDecoder().decode(body)
    try {
      const parsed = JSON.parse(text)
      return canonicalizeJson(parsed)
    } catch {
      return text
    }
  }
  return canonicalizeJson(body)
}

/** Normalizes request path + query, parameterizing owner and repo. */
export function normalizeRequestPath(urlStr: string, owner?: string, repo?: string): string {
  try {
    const parsed = new URL(urlStr, "https://api.github.com")
    let pathname = parsed.pathname
    if (owner && repo) {
      const ownerEnc = encodeURIComponent(owner)
      const repoEnc = encodeURIComponent(repo)
      const prefix = `/repos/${ownerEnc}/${repoEnc}`
      if (pathname.startsWith(prefix)) {
        pathname = `/repos/{owner}/{repo}${pathname.slice(prefix.length)}`
      }
    }
    return pathname + parsed.search
  } catch {
    return urlStr
  }
}

/** Case-insensitive header lookup helper. */
function getHeader(headers: Record<string, string> | undefined, name: string): string | undefined {
  if (!headers) return undefined
  const lower = name.toLowerCase()
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === lower) return v
  }
  return undefined
}

/** Builds the composite match key for an interaction. */
export async function buildMatchKey(
  method: string,
  url: string,
  headers: Record<string, string> | undefined,
  body: unknown,
  owner?: string,
  repo?: string,
): Promise<string> {
  const normMethod = method.toUpperCase()
  const normPath = normalizeRequestPath(url, owner, repo)
  const ifNoneMatch = getHeader(headers, "if-none-match")
  const etagPart = ifNoneMatch ? ` [etag=${ifNoneMatch}]` : ""

  const bodyStr = normalizeBodyString(body)
  let bodyPart = ""
  if (bodyStr.length > 0) {
    const hash = await sha1Hex(new TextEncoder().encode(bodyStr))
    bodyPart = ` [body=${hash}]`
  }

  return `${normMethod} ${normPath}${etagPart}${bodyPart}`
}

function createFetchResponse(recorded: RecordedResponse): FetchResponseLike {
  const status = recorded.status
  const headersMap = new Map<string, string>()
  if (recorded.headers) {
    for (const [key, value] of Object.entries(recorded.headers)) {
      headersMap.set(key.toLowerCase(), String(value))
    }
  }
  const bodyText =
    typeof recorded.body === "string"
      ? recorded.body
      : recorded.body !== undefined
        ? JSON.stringify(recorded.body)
        : ""

  return {
    ok: status >= 200 && status < 300,
    status,
    statusText:
      recorded.statusText ??
      (status === 200 ? "OK" : status === 304 ? "Not Modified" : `Status ${status}`),
    headers: {
      get(name: string): string | null {
        return headersMap.get(name.toLowerCase()) ?? null
      },
    },
    async text(): Promise<string> {
      return bodyText
    },
    async json(): Promise<unknown> {
      if (typeof recorded.body === "object" && recorded.body !== null) {
        return recorded.body
      }
      if (bodyText.length === 0) return null
      return JSON.parse(bodyText)
    },
  }
}

/**
 * Creates an in-memory FetchLike implementation that deterministically
 * replays recorded interactions from a RecordedTape.
 */
export async function createReplayFetch(
  tape: RecordedTape,
  options: ReplayFetchOptions = {},
): Promise<ReplayFetch> {
  const effectiveOwner = options.owner ?? tape.meta.owner
  const effectiveRepo = options.repo ?? tape.meta.repo

  // Pre-index interactions by matchKey into FIFO queues.
  const initialQueues = new Map<string, RecordedResponse[]>()

  for (const interaction of tape.interactions) {
    const key = await buildMatchKey(
      interaction.request.method,
      interaction.request.url,
      interaction.request.headers,
      interaction.request.body,
      tape.meta.owner,
      tape.meta.repo,
    )
    const queue = initialQueues.get(key)
    if (queue) {
      queue.push(interaction.response)
    } else {
      initialQueues.set(key, [interaction.response])
    }
  }

  // Live mutable working queues cloned from initial state.
  let queues = new Map<string, RecordedResponse[]>()
  function initQueues() {
    queues = new Map()
    for (const [k, v] of initialQueues.entries()) {
      queues.set(k, [...v])
    }
  }
  initQueues()

  const replayFn: FetchLike = async (
    url: string,
    init?: FetchRequestInitLike,
  ): Promise<FetchResponseLike> => {
    const method = init?.method ?? "GET"
    const key = await buildMatchKey(
      method,
      url,
      init?.headers,
      init?.body,
      effectiveOwner,
      effectiveRepo,
    )

    const queue = queues.get(key)
    if (!queue || queue.length === 0) {
      const remainingKeys: string[] = []
      for (const [k, list] of queues.entries()) {
        if (list.length > 0) {
          remainingKeys.push(`  - ${k} (${list.length} remaining)`)
        }
      }
      const hint =
        remainingKeys.length > 0
          ? `\nAvailable unconsumed keys in tape:\n${remainingKeys.join("\n")}`
          : "\nAll tape interactions have been exhausted."
      throw new Error(
        `[createReplayFetch] Unexpected request (no matching interaction found):\n  Method: ${method}\n  URL: ${url}\n  Key: ${key}${hint}`,
      )
    }

    const nextResponse = queue.shift() as RecordedResponse
    return createFetchResponse(nextResponse)
  }

  const remainingCount = (): number => {
    let count = 0
    for (const list of queues.values()) {
      count += list.length
    }
    return count
  }

  const isDrained = (): boolean => remainingCount() === 0

  const pendingKeys = (): readonly { key: string; count: number }[] => {
    const result: { key: string; count: number }[] = []
    for (const [key, list] of queues.entries()) {
      if (list.length > 0) {
        result.push({ key, count: list.length })
      }
    }
    return result
  }

  const reset = (): void => {
    initQueues()
  }

  const replay = replayFn as unknown as {
    [K in keyof ReplayFetch]: ReplayFetch[K]
  } & FetchLike
  replay.remainingCount = remainingCount
  replay.isDrained = isDrained
  replay.pendingKeys = pendingKeys
  replay.reset = reset

  return replay as ReplayFetch
}
