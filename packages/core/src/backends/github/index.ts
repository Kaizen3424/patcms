/**
 * GithubBackend — hand-rolled fetch transport over the `FetchLike` seam.
 * ADR-0005 reads only in P1: refs, recursive trees, contents/blobs, tree diffs.
 * The token appears ONLY in the Authorization header; never in a URL.
 */

import { BackendReadError } from "../../backend/errors"
import type {
  CheckRunConclusion,
  CheckRunStatus,
  CheckRunSummary,
  CheckRunsRead,
  CommitChangeSet,
  CommitOptions,
  CommitResult,
  CommitStatusesRead,
  CommitStatusSummary,
  FileRead,
  GitBackend,
  GitBackendCapabilities,
  ReadFileOptions,
  ReadFileResult,
  ReadTreeOptions,
  ReadTreeResult,
  Ref,
  TreeEntryTuple,
} from "../../backend/types"
import {
  BackendWriteError,
  classifyWriteResponse,
  networkWriteError,
} from "../../backend/write-errors"
import type { FetchLike, FetchResponseLike } from "../../composition"
import { decodeBase64, encodeBase64 } from "../../safety/encoding"
import type { JsonValue } from "../../safety/untrusted-json"
import { parseUntrustedJson } from "../../safety/untrusted-json"

export interface GithubBackendOptions {
  readonly owner: string
  readonly repo: string
  readonly token: string | (() => string | undefined)
  readonly fetch: FetchLike
  /** API origin override (tests/proxies); defaults to https://api.github.com. */
  readonly baseUrl?: string
}

const DEFAULT_BASE_URL = "https://api.github.com"
const API_VERSION = "2022-11-28"
const MAX_TREE_BYTES = 8 * 1024 * 1024
const CONTENTS_INLINE_LIMIT = 1_000_000

interface JsonResponse {
  readonly kind: "json"
  readonly value: JsonValue
  readonly etag?: string
}

interface NotModifiedResponse {
  readonly kind: "not-modified"
  readonly etag?: string
}

type RequestResult = JsonResponse | NotModifiedResponse

export class GithubBackend implements GitBackend {
  readonly capabilities: GitBackendCapabilities = { commitStatus: true, branches: true }
  readonly #owner: string
  readonly #repo: string
  #tokenAccessor: () => string | undefined
  readonly #fetch: FetchLike
  readonly #baseUrl: string

  constructor(options: GithubBackendOptions) {
    this.#owner = options.owner
    this.#repo = options.repo
    const initialToken = options.token
    this.#tokenAccessor = typeof initialToken === "function" ? initialToken : () => initialToken
    this.#fetch = options.fetch
    this.#baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "")
  }

  /** Updates the in-memory access key for in-place re-authentication (INV-A01). */
  setToken(token: string): void {
    this.#tokenAccessor = () => token
  }

  #getToken(): string {
    return this.#tokenAccessor() ?? ""
  }

  async getRef(branch: string): Promise<Ref> {
    const url = `${this.#repoUrl()}/git/ref/heads/${encodeBranch(branch)}`
    const response = await this.#request(url)
    if (response.kind === "not-modified") {
      throw new BackendReadError(
        "UNKNOWN",
        "GitHub ref read returned 304 without a conditional request",
      )
    }
    const record = asRecord(response.value)
    const ref = getString(record, "ref")
    const object = asRecord(record?.object)
    const sha = getString(object, "sha")
    const type = getString(object, "type")
    if (ref === undefined || sha === undefined || type === undefined) {
      throw new BackendReadError("UNKNOWN", "GitHub ref response was malformed")
    }
    return { ref, object: { sha, type } }
  }

  async readTree(
    branch: string,
    commitSha: string,
    options: ReadTreeOptions = {},
  ): Promise<ReadTreeResult> {
    const sha =
      commitSha.length > 0 ? commitSha : (await this.getRef(requireBranch(branch))).object.sha
    const treeSha = await this.#resolveTreeSha(sha)
    const response = await this.#request(
      `${this.#repoUrl()}/git/trees/${treeSha}?recursive=1`,
      options.etag,
      MAX_TREE_BYTES,
      MAX_TREE_BYTES,
    )
    if (response.kind === "not-modified") {
      return {
        kind: "not-modified",
        ...(response.etag === undefined ? {} : { etag: response.etag }),
      }
    }

    const record = asRecord(response.value)
    const rootSha = getString(record, "sha") ?? treeSha
    const truncated = record?.truncated === true
    if (truncated) {
      const entries = await this.#walkSubtrees(treeSha, "")
      return {
        kind: "tree",
        tree: { sha: rootSha, truncated: false, entries },
        ...(response.etag === undefined ? {} : { etag: response.etag }),
      }
    }

    const tree = parseTreeEntries(record)
    return {
      kind: "tree",
      tree: { sha: rootSha, truncated: false, entries: tree },
      ...(response.etag === undefined ? {} : { etag: response.etag }),
    }
  }

  async readFile(
    branch: string,
    path: string,
    blobSha: string,
    options: ReadFileOptions = {},
  ): Promise<ReadFileResult> {
    const contentsUrl = `${this.#repoUrl()}/contents/${encodePath(path)}?ref=${encodeURIComponent(requireBranch(branch))}`
    const response = await this.#request(contentsUrl, options.etag)
    if (response.kind === "not-modified") {
      return {
        kind: "not-modified",
        ...(response.etag === undefined ? {} : { etag: response.etag }),
      }
    }

    const record = asRecord(response.value)
    if (record === undefined || Array.isArray(response.value)) {
      throw new BackendReadError("NOT_FOUND", `GitHub path is not a file: ${path}`)
    }
    if (record.type !== undefined && record.type !== "file") {
      throw new BackendReadError("NOT_FOUND", `GitHub path is not a file: ${path}`)
    }

    const size = getNumber(record, "size")
    const content = getString(record, "content")
    const encoding = getString(record, "encoding")
    const sha = getString(record, "sha") ?? blobSha

    if (size !== undefined && size > CONTENTS_INLINE_LIMIT) {
      const blob = await this.#readBlob(sha)
      return this.#fileResult(path, sha, blob, response.etag)
    }
    if (
      content === undefined ||
      content === "" ||
      (encoding !== undefined && encoding !== "base64")
    ) {
      if (sha.length > 0) {
        const blob = await this.#readBlob(sha)
        return this.#fileResult(path, sha, blob, response.etag)
      }
      throw new BackendReadError("UNKNOWN", `GitHub returned no content for ${path}`)
    }

    // Some responses are 200 with a 1MB+ blob marker but an empty content field.
    const bytes = decodeBase64(content)
    return this.#fileResult(path, sha, { bytes, size: size ?? bytes.length }, response.etag)
  }

  async listChangedFiles(
    branch: string,
    baseSha: string,
    headSha: string,
  ): Promise<ReadonlyMap<string, TreeEntryTuple>> {
    if (baseSha === headSha) return new Map()
    const [base, head] = await Promise.all([
      this.readTree(branch, baseSha),
      this.readTree(branch, headSha),
    ])
    if (base.kind !== "tree" || head.kind !== "tree") {
      throw new BackendReadError("UNKNOWN", "tree diff read unexpectedly returned not-modified")
    }
    const baseByPath = new Map(base.tree.entries.map((entry) => [entry.path, entry]))
    const changed = new Map<string, TreeEntryTuple>()
    for (const entry of head.tree.entries) {
      const previous = baseByPath.get(entry.path)
      if (
        previous === undefined ||
        previous.sha !== entry.sha ||
        previous.mode !== entry.mode ||
        previous.type !== entry.type
      ) {
        changed.set(entry.path, entry)
      }
    }
    return changed
  }

  async readCheckRuns(branch: string, sha: string): Promise<CheckRunsRead> {
    if (!this.capabilities.commitStatus) return { kind: "unsupported" }
    // Branch stays a parameter (INV-P14); GitHub's check-runs route is sha-scoped.
    requireBranch(branch)
    const response = await this.#request(
      `${this.#repoUrl()}/commits/${encodeURIComponent(requireSha(sha))}/check-runs?per_page=100`,
    )
    if (response.kind === "not-modified") {
      throw new BackendReadError(
        "UNKNOWN",
        "GitHub check-runs read returned 304 without a conditional request",
      )
    }
    const record = asRecord(response.value)
    const rawRuns = record?.check_runs
    if (record === undefined || !Array.isArray(rawRuns)) {
      throw new BackendReadError("UNKNOWN", "GitHub check-runs response was malformed")
    }
    const runs = parseCheckRuns(rawRuns)
    const totalCount = getNumber(record, "total_count") ?? runs.length
    return { kind: "ok", totalCount: Math.max(totalCount, runs.length), runs }
  }

  async readCommitStatuses(branch: string, sha: string): Promise<CommitStatusesRead> {
    if (!this.capabilities.commitStatus) return { kind: "unsupported" }
    requireBranch(branch)
    const response = await this.#request(
      `${this.#repoUrl()}/commits/${encodeURIComponent(requireSha(sha))}/status`,
    )
    if (response.kind === "not-modified") {
      throw new BackendReadError(
        "UNKNOWN",
        "GitHub commit-status read returned 304 without a conditional request",
      )
    }
    const record = asRecord(response.value)
    const rawStatuses = record?.statuses
    if (record === undefined || !Array.isArray(rawStatuses)) {
      throw new BackendReadError("UNKNOWN", "GitHub commit-status response was malformed")
    }
    return { kind: "ok", statuses: parseCommitStatuses(rawStatuses) }
  }

  async commitChanges(
    changes: CommitChangeSet,
    baseHeadSha: string,
    branch: string,
    options: CommitOptions = {},
  ): Promise<CommitResult> {
    const writes = [...(changes.adds ?? []), ...(changes.updates ?? [])]
    // 1. Blobs — content-addressed, pooled (≤5 concurrent, ADR-0005 §writes).
    const blobShas = await this.#mapLimited(writes, 5, async (write) => {
      const payload = asRecord(
        await this.#requestWrite(`${this.#repoUrl()}/git/blobs`, {
          content: encodeBase64(write.bytes),
          encoding: "base64",
        }),
      )
      const sha = payload?.sha
      if (typeof sha !== "string") {
        throw new BackendWriteError("UNKNOWN", "GitHub blob create returned no sha")
      }
      return { write, sha }
    })

    // 2. Tree changes on top of the verified base tree (NEVER client-assembled).
    const treeInput: Array<{ path: string; mode: string; type: string; sha: string | null }> = [
      ...blobShas.map((entry) => ({
        path: entry.write.path,
        mode: "100644",
        type: "blob",
        sha: entry.sha,
      })),
      ...(changes.deletes ?? []).map((path) => ({ path, mode: "100644", type: "blob", sha: null })),
    ]
    const baseTree = await this.#resolveTreeSha(baseHeadSha)
    const treePayload = asRecord(
      await this.#requestWrite(`${this.#repoUrl()}/git/trees`, {
        base_tree: baseTree,
        tree: treeInput,
      }),
    )
    const treeSha = treePayload?.sha
    if (typeof treeSha !== "string") {
      throw new BackendWriteError("UNKNOWN", "GitHub tree create returned no sha")
    }

    // 3. Commit naming the verified head as parent.
    const commitPayload = asRecord(
      await this.#requestWrite(`${this.#repoUrl()}/git/commits`, {
        message: options.message ?? defaultCommitMessage(changes),
        tree: treeSha,
        parents: [baseHeadSha],
      }),
    )
    const commitSha = commitPayload?.sha
    if (typeof commitSha !== "string") {
      throw new BackendWriteError("UNKNOWN", "GitHub commit create returned no sha")
    }

    // 4. FF-only ref update (CAS): explicit force:false, always (INV-P01).
    await this.#requestWrite(
      `${this.#repoUrl()}/git/refs/heads/${encodeBranch(branch)}`,
      { sha: commitSha, force: false },
      "PATCH",
    )
    return { commitSha, treeSha }
  }

  /** ≤N concurrent task pool (blob writes; INV-N01 gate posture). */
  async #mapLimited<U, R>(
    items: readonly U[],
    limit: number,
    task: (item: U) => Promise<R>,
  ): Promise<R[]> {
    const results = new Array<R>(items.length)
    let cursor = 0
    const workers = Array.from({ length: Math.min(limit, Math.max(items.length, 1)) }, async () => {
      for (;;) {
        const index = cursor
        if (index >= items.length) return
        cursor += 1
        results[index] = await task(items[index] as U)
      }
    })
    await Promise.all(workers)
    return results
  }

  /** Write-side request helper: POST/PATCH, JSON body, classified failures. */
  async #requestWrite(url: string, payload: unknown, method: "POST" | "PATCH" = "POST") {
    let response: FetchResponseLike
    try {
      response = await this.#fetch(url, {
        method,
        body: JSON.stringify(payload),
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${this.#getToken()}`,
          "Content-Type": "application/json",
          "X-GitHub-Api-Version": API_VERSION,
        },
      })
    } catch (error) {
      throw networkWriteError(error)
    }
    if (!response.ok) {
      const text = await response.text()
      throw classifyWriteResponse({
        status: response.status,
        headers: response.headers,
        bodyText: text,
      })
    }
    const text = await response.text()
    const parsed = parseUntrustedJson(text, { maxDepth: 64 })
    if (!parsed.ok) {
      throw new BackendWriteError("UNKNOWN", "GitHub write response was not valid JSON")
    }
    return parsed.value as JsonValue
  }

  async #resolveTreeSha(commitSha: string): Promise<string> {
    try {
      const response = await this.#request(
        `${this.#repoUrl()}/git/commits/${encodeURIComponent(commitSha)}`,
      )
      if (response.kind === "not-modified") return commitSha
      const record = asRecord(response.value)
      const tree = asRecord(record?.tree)
      const sha = getString(tree, "sha")
      return sha ?? commitSha
    } catch (error) {
      if (error instanceof BackendReadError && error.code === "NOT_FOUND") {
        // Fixture/fake backends may hand back a tree sha directly.
        return commitSha
      }
      throw error
    }
  }

  async #walkSubtrees(treeSha: string, prefix: string): Promise<TreeEntryTuple[]> {
    const response = await this.#request(
      `${this.#repoUrl()}/git/trees/${encodeURIComponent(treeSha)}`,
      undefined,
      MAX_TREE_BYTES,
      MAX_TREE_BYTES,
    )
    if (response.kind === "not-modified") {
      throw new BackendReadError(
        "UNKNOWN",
        "subtree walk received 304 without a conditional request",
      )
    }
    const record = asRecord(response.value)
    if (record?.truncated === true) {
      throw new BackendReadError(
        "TREE_TRUNCATED",
        `subtree ${treeSha} is still truncated — cannot build a correct tree`,
      )
    }
    const entries: TreeEntryTuple[] = []
    for (const child of treeChildren(record)) {
      const childPath = prefix.length === 0 ? child.path : `${prefix}/${child.path}`
      if (child.type === "tree") {
        entries.push(...(await this.#walkSubtrees(child.sha, childPath)))
      } else if (child.type === "blob") {
        entries.push({
          path: childPath,
          sha: child.sha,
          mode: child.mode,
          type: child.type,
        })
      }
    }
    return entries
  }

  async #readBlob(sha: string): Promise<{ bytes: Uint8Array; size: number }> {
    const response = await this.#request(`${this.#repoUrl()}/git/blobs/${encodeURIComponent(sha)}`)
    if (response.kind === "not-modified") {
      throw new BackendReadError("UNKNOWN", "blob read received 304 without a conditional request")
    }
    const record = asRecord(response.value)
    const content = getString(record, "content")
    const size = getNumber(record, "size")
    if (content === undefined)
      throw new BackendReadError("UNKNOWN", "GitHub blob response had no content")
    const bytes = decodeBase64(content)
    return { bytes, size: size ?? bytes.length }
  }

  #fileResult(
    path: string,
    sha: string,
    blob: { bytes: Uint8Array; size: number },
    etag: string | undefined,
  ): ReadFileResult {
    const file: FileRead = {
      path,
      sha,
      bytes: blob.bytes,
      size: blob.size,
    }
    return { kind: "file", file, ...(etag === undefined ? {} : { etag }) }
  }

  async #request(
    url: string,
    etag?: string,
    maxBytes = 2 * 1024 * 1024,
    maxListItems = 5_000,
  ): Promise<RequestResult> {
    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${this.#getToken()}`,
      "X-GitHub-Api-Version": API_VERSION,
    }
    if (etag !== undefined) headers["If-None-Match"] = etag

    let response: FetchResponseLike
    try {
      response = await this.#fetch(url, { method: "GET", headers })
    } catch (error) {
      throw new BackendReadError(
        "NETWORK",
        error instanceof Error ? error.message : "network request failed",
      )
    }

    const responseEtag = response.headers.get("etag") ?? undefined
    if (response.status === 304) {
      return { kind: "not-modified", ...(responseEtag === undefined ? {} : { etag: responseEtag }) }
    }
    if (!response.ok) {
      throw classifyResponse(response)
    }

    const text = await response.text()
    const parsed = parseUntrustedJson(text, {
      maxBytes,
      maxListItems,
      maxDepth: 64,
    })
    if (!parsed.ok) {
      throw new BackendReadError(
        parsed.issues[0]?.code === "TOO_LARGE" ? "UNKNOWN" : "UNKNOWN",
        `GitHub response was not valid JSON: ${parsed.issues[0]?.detail ?? "unknown"}`,
        { status: response.status },
      )
    }
    return {
      kind: "json",
      value: parsed.value,
      ...(responseEtag === undefined ? {} : { etag: responseEtag }),
    }
  }

  #repoUrl(): string {
    return `${this.#baseUrl}/repos/${encodeURIComponent(this.#owner)}/${encodeURIComponent(this.#repo)}`
  }
}

function classifyResponse(response: FetchResponseLike): BackendReadError {
  const status = response.status
  const retryAfter = response.headers.get("retry-after") ?? undefined
  const remaining = response.headers.get("x-ratelimit-remaining")
  const resetAt = response.headers.get("x-ratelimit-reset") ?? undefined
  if (status === 401)
    return new BackendReadError("AUTH_EXPIRED", "GitHub token expired", { status })
  if (status === 403) {
    if (remaining === "0" || retryAfter !== undefined || resetAt !== undefined) {
      return new BackendReadError("RATE_LIMIT", "GitHub rate limit reached", {
        status,
        ...(retryAfter === undefined ? {} : { retryAfter }),
        ...(resetAt === undefined ? {} : { resetAt }),
      })
    }
    return new BackendReadError("SCOPE", "GitHub token lacks the required scope", { status })
  }
  if (status === 429) {
    return new BackendReadError("RATE_LIMIT", "GitHub rate limit reached", {
      status,
      ...(retryAfter === undefined ? {} : { retryAfter }),
      ...(resetAt === undefined ? {} : { resetAt }),
    })
  }
  if (status === 404)
    return new BackendReadError("NOT_FOUND", "GitHub resource not found", { status })
  return new BackendReadError("UNKNOWN", `GitHub request failed (${status})`, { status })
}

function requireBranch(branch: string): string {
  if (branch.length === 0) throw new BackendReadError("UNKNOWN", "branch must not be empty")
  return branch
}

function requireSha(sha: string): string {
  if (sha.length === 0) throw new BackendReadError("UNKNOWN", "commit sha must not be empty")
  return sha
}

const CHECK_RUN_STATUSES: ReadonlySet<string> = new Set<CheckRunStatus>([
  "queued",
  "in_progress",
  "completed",
  "pending",
  "requested",
  "waiting",
])

const CHECK_RUN_CONCLUSIONS: ReadonlySet<string> = new Set<CheckRunConclusion>([
  "success",
  "failure",
  "neutral",
  "cancelled",
  "skipped",
  "timed_out",
  "action_required",
  "stale",
])

const COMMIT_STATUS_STATES: ReadonlySet<string> = new Set([
  "error",
  "failure",
  "pending",
  "success",
])

function parseCheckRuns(list: readonly JsonValue[]): CheckRunSummary[] {
  const runs: CheckRunSummary[] = []
  list.forEach((item, index) => {
    const run = asRecord(item)
    if (run === undefined) return
    const id = getNumber(run, "id") ?? index + 1
    const rawStatus = getString(run, "status")
    const rawConclusion = getString(run, "conclusion")
    const detailsUrl = httpsUrl(getString(run, "details_url"))
    runs.push({
      id,
      name: getString(run, "name") ?? `check-${id}`,
      status:
        rawStatus !== undefined && CHECK_RUN_STATUSES.has(rawStatus)
          ? (rawStatus as CheckRunStatus)
          : "pending",
      conclusion:
        rawConclusion !== undefined && CHECK_RUN_CONCLUSIONS.has(rawConclusion)
          ? (rawConclusion as CheckRunConclusion)
          : null,
      ...(detailsUrl === undefined ? {} : { detailsUrl }),
    })
  })
  return runs
}

function parseCommitStatuses(list: readonly JsonValue[]): CommitStatusSummary[] {
  const statuses: CommitStatusSummary[] = []
  const seen = new Set<string>()
  for (const item of list) {
    const status = asRecord(item)
    const context = getString(status, "context")
    if (status === undefined || context === undefined || context.length === 0) continue
    // Combined-status responses are newest-first per context; keep the newest.
    if (seen.has(context)) continue
    seen.add(context)
    const rawState = getString(status, "state")
    const targetUrl = httpsUrl(getString(status, "target_url"))
    statuses.push({
      context,
      state:
        rawState !== undefined && COMMIT_STATUS_STATES.has(rawState)
          ? (rawState as CommitStatusSummary["state"])
          : "pending",
      ...(targetUrl === undefined ? {} : { targetUrl }),
    })
  }
  return statuses
}

/** Untrusted links survive only as https URLs (ADR-0006 render rules). */
function httpsUrl(value: string | undefined): string | undefined {
  return value?.startsWith("https://") === true ? value : undefined
}

/** Machine-checkable default — never carries skip tokens (ADR-0008 §4). */
function defaultCommitMessage(changes: CommitChangeSet): string {
  const count =
    (changes.adds?.length ?? 0) + (changes.updates?.length ?? 0) + (changes.deletes?.length ?? 0)
  return `chore(cms): save ${count} file(s)`
}

/** Encodes each branch segment, including `+` (INV-P14 branch-name test). */
export function encodeBranch(branch: string): string {
  return branch
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/")
}

function encodePath(path: string): string {
  return path
    .split("/")
    .filter((segment) => segment.length > 0)
    .map((segment) => encodeURIComponent(segment))
    .join("/")
}

function asRecord(value: JsonValue | undefined): Record<string, JsonValue> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined
  return value as Record<string, JsonValue>
}

function getString(record: Record<string, JsonValue> | undefined, key: string): string | undefined {
  const value = record?.[key]
  return typeof value === "string" ? value : undefined
}

function getNumber(record: Record<string, JsonValue> | undefined, key: string): number | undefined {
  const value = record?.[key]
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

interface TreeChild {
  readonly path: string
  readonly sha: string
  readonly mode: string
  readonly type: string
}

function treeChildren(record: Record<string, JsonValue> | undefined): TreeChild[] {
  const tree = record?.tree
  if (!Array.isArray(tree)) return []
  const children: TreeChild[] = []
  for (const item of tree) {
    const child = asRecord(item)
    const path = getString(child, "path")
    const sha = getString(child, "sha")
    const mode = getString(child, "mode")
    const type = getString(child, "type")
    if (path !== undefined && sha !== undefined && mode !== undefined && type !== undefined) {
      children.push({ path, sha, mode, type })
    }
  }
  return children
}

function parseTreeEntries(record: Record<string, JsonValue> | undefined): TreeEntryTuple[] {
  // `blob` + `commit`: recursive trees flatten subtrees, but submodule entries
  // are real — hiding them would turn a foreign submodule swap into a phantom
  // deletion and break tuple truth for the conflict engine (ADR-0005 P2/C.2
  // addendum; INV-P06).
  return treeChildren(record)
    .filter((child) => child.type === "blob" || child.type === "commit")
    .map((child) => ({ path: child.path, sha: child.sha, mode: child.mode, type: child.type }))
}

export type {
  RecordedInteraction,
  RecordedRequest,
  RecordedResponse,
  RecordedTape,
  RecordedTapeMeta,
  ReplayFetch,
  ReplayFetchOptions,
} from "./recorded-replay"
export {
  buildMatchKey,
  canonicalizeJson,
  createReplayFetch,
  normalizeBodyString,
  normalizeRequestPath,
} from "./recorded-replay"
