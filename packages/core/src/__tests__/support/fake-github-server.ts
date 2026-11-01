/**
 * FakeGithubServer — the reference GitHub git-data model (ADR-0005 P2 addendum
 * + ADR-0001/0009 posture: every fake stays behind the SAME contract suite).
 *
 * HTTP-shaped and zero-dependency: adapters map transport frames onto
 * `handle()` and JSON responses out. Core INV tests drive it through a
 * `FetchLike` adapter; the playground's MSW FakeGithub delegates to it so BOTH
 * harnesses share one source of framing/CAS/permission rules.
 *
 * Truthful semantics (chaos knobs live OUTSIDE this file, in harness adapters):
 * - Branch is always a path parameter (INV-P14 law).
 * - PATCH ref is fast-forward-only: the new commit must name the current head
 *   as a parent; non-FF ⇒ 422 "Update is not a fast forward" (INV-P01). A
 *   `force: true` body IS honored like real GitHub — but every request lands
 *   in the request log, so the FF-only invariant greps for violations there.
 * - Blobs/trees/commits are content-addressed: equal payload ⇒ equal sha
 *   (INV-P03 idempotent-retry convergence).
 * - Trees accept `base_tree` + changed paths only (deletes = `sha: null`),
 *   and a no-op overlay reproduces the base tree sha exactly (INV-S02 C.1).
 */

import type { GitTreeEntry } from "../../backend/git-sha"
import { gitBlobSha, gitCommitShaCanonical, gitTreeSha } from "../../backend/git-sha"
import type {
  CheckRunConclusion,
  CheckRunStatus,
  CheckRunSummary,
  CommitStatusState,
  CommitStatusSummary,
} from "../../backend/types"
import { classifyWriteResponse, networkWriteError } from "../../backend/write-errors"
import { decodeBase64, encodeBase64 } from "../../safety/encoding"

export interface FakeGithubSpec {
  readonly defaultBranch: string
  readonly headSha: string
  readonly treeSha: string
  readonly files: ReadonlyMap<string, { readonly sha: string; readonly bytes: Uint8Array }>
}

/** Test input for `setCheckRuns` — ids/names default deterministically. */
export interface FakeCheckRunInput {
  readonly id?: number
  readonly name?: string
  readonly status?: CheckRunStatus
  readonly conclusion?: CheckRunConclusion | null
  readonly detailsUrl?: string
}

export interface FakeCommitStatusInput {
  readonly context: string
  readonly state: CommitStatusState
  readonly targetUrl?: string
}

export interface FakeRequest {
  readonly method: string
  /** Repo-relative path (no `/repos/{owner}/{repo}` prefix), queryless. */
  readonly path: string
  /** Lower-cased header lookup (optional — GETs need If-None-Match never here). */
  readonly headers?: Readonly<Record<string, string>>
  /** Parsed JSON body when present; adapter owns parsing (that IS transport). */
  readonly body?: unknown
}

export interface FakeResponse {
  readonly status: number
  readonly headers?: Readonly<Record<string, string>>
  readonly json?: unknown
}

/** Every request with its parsed mutation body — request-log assertions (INV-P01). */
export interface FakeRequestLogEvent {
  readonly method: string
  readonly path: string
  readonly status: number
  readonly body?: unknown
  /** Safe request headers (the harness strips Authorization before logging). */
  readonly headers?: Readonly<Record<string, string>>
}

interface CommitRecord {
  readonly treeSha: string
  readonly parentShas: readonly string[]
  readonly message: string
}

const RATE_HEADERS = {
  "x-ratelimit-limit": "5000",
  "x-ratelimit-remaining": "4999",
  "x-ratelimit-reset": "0",
} as const

export class FakeGithubServer {
  readonly #branches = new Map<string, string>()
  readonly #blobs = new Map<string, Uint8Array>()
  readonly #trees = new Map<string, readonly GitTreeEntry[]>()
  readonly #commits = new Map<string, CommitRecord>()
  readonly #checkRuns = new Map<string, readonly CheckRunSummary[]>()
  readonly #statuses = new Map<string, readonly CommitStatusSummary[]>()
  readonly #spec: FakeGithubSpec
  readonly log: FakeRequestLogEvent[] = []

  constructor(spec: FakeGithubSpec) {
    this.#spec = spec
    this.#branches.set(spec.defaultBranch, spec.headSha)
    for (const file of spec.files.values()) {
      this.#blobs.set(file.sha, file.bytes)
    }
    const seeded: GitTreeEntry[] = [...spec.files]
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([path, file]) => ({
        path,
        mode: "100644",
        type: "blob",
        sha: file.sha,
        size: file.bytes.byteLength,
      }))
    this.#trees.set(spec.treeSha, seeded)
    this.#commits.set(spec.headSha, { treeSha: spec.treeSha, parentShas: [], message: "seed" })
  }

  /** Current head (40-hex) for a branch, or undefined when unknown. */
  ref(branch: string): string | undefined {
    return this.#branches.get(branch)
  }

  /**
   * Contents-route backing for harness adapters (path → bytes via the branch
   * head's tree). Returns undefined for unknown paths — 404 shaping is the
   * adapter's transport concern.
   */
  contents(
    branch: string,
    path: string,
  ): { readonly bytes: Uint8Array; readonly sha: string } | undefined {
    const head = this.#branches.get(branch) ?? this.#spec.headSha
    const headCommit = this.#commits.get(head)
    if (headCommit === undefined) return undefined
    const entries = this.#trees.get(headCommit.treeSha)
    if (entries === undefined) return undefined
    const entry = entries.find((candidate) => candidate.path === path)
    if (entry?.type !== "blob") return undefined
    const bytes = this.#blobs.get(entry.sha) ?? this.specBytes(entry.sha)
    if (bytes === undefined) return undefined
    return { bytes, sha: entry.sha }
  }

  /** Blob byte size by sha (tree responses add `size` at the adapter layer). */
  blobSize(sha: string): number | undefined {
    return (this.#blobs.get(sha) ?? this.specBytes(sha))?.byteLength
  }

  /** Harness hook: simulate a concurrent push (satisfies INV-P01 fixtures). */
  setRef(branch: string, sha: string): void {
    if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error(`fake setRef: non-40-hex sha ${sha}`)
    this.#branches.set(branch, sha)
  }

  /**
   * Attach/replace check runs for a commit (branch heads resolve through the
   * same route). An empty list means "no run has landed" (grace subject).
   */
  setCheckRuns(sha: string, runs: readonly FakeCheckRunInput[]): void {
    this.#checkRuns.set(
      sha,
      runs.map((run, index) => {
        const id = run.id ?? index + 1
        return {
          id,
          name: run.name ?? `check-${id}`,
          status: run.status ?? "completed",
          conclusion: run.conclusion === undefined ? null : run.conclusion,
          ...(run.detailsUrl === undefined ? {} : { detailsUrl: run.detailsUrl }),
        }
      }),
    )
  }

  /** Attach/replace commit statuses (the `contexts[]` fallback source). */
  setStatuses(sha: string, statuses: readonly FakeCommitStatusInput[]): void {
    this.#statuses.set(
      sha,
      statuses.map((status) => ({
        context: status.context,
        state: status.state,
        ...(status.targetUrl === undefined ? {} : { targetUrl: status.targetUrl }),
      })),
    )
  }

  /** Parsed commit count AFTER a save (INV-P02 "exactly one commit"). */
  commitCount(): number {
    return this.#commits.size
  }

  async handle(request: FakeRequest): Promise<FakeResponse> {
    try {
      const response = await this.#dispatch(request)
      this.log.push({
        method: request.method,
        path: request.path,
        status: response.status,
        ...(request.headers === undefined ? {} : { headers: request.headers }),
        ...(request.body === undefined ? {} : { body: request.body }),
      })
      return response
    } catch (error) {
      // Transport-model code failure surfaces as a 500; never a thrown frame.
      const failure = error instanceof Error ? error : new Error(String(error))
      this.log.push({ method: request.method, path: request.path, status: 500 })
      return { status: 500, json: { message: failure.message } }
    }
  }

  async #dispatch(request: FakeRequest): Promise<FakeResponse> {
    const method = request.method.toUpperCase()
    if (method === "GET" || method === "HEAD") {
      const read = this.#dispatchRead(request)
      if (read !== undefined) return read
      return notFoundResponse()
    }

    if (method === "POST" && request.path === "/git/commits") {
      return this.#createCommit(asRecord(request.body))
    }
    if (method === "POST" && request.path === "/git/trees") {
      return this.#createTree(asRecord(request.body))
    }
    if (method === "POST" && request.path === "/git/blobs") {
      return this.#createBlob(asRecord(request.body))
    }
    const refMatch = /^\/git\/refs\/heads\/(.+)$/.exec(request.path)
    if (method === "PATCH" && refMatch !== null) {
      return this.#updateRef(decodeBranchSegment(refMatch[1] as string), asRecord(request.body))
    }
    return notFoundResponse()
  }

  #dispatchRead(request: FakeRequest): FakeResponse | undefined {
    const refMatch = /^\/git\/ref\/heads\/(.+)$/.exec(request.path)
    if (refMatch !== null) {
      const branch = decodeBranchSegment(refMatch[1] as string)
      const sha = this.#branches.get(branch)
      if (sha === undefined) return notFoundResponse()
      return {
        status: 200,
        json: {
          ref: `refs/heads/${branch}`,
          object: { sha, type: "commit" },
        },
        headers: RATE_HEADERS,
      }
    }

    const commitMatch = /^\/git\/commits\/([^/]+)$/.exec(request.path)
    if (commitMatch !== null) {
      const sha = commitMatch[1] as string
      const record = this.#commits.get(sha)
      if (record === undefined) return notFoundResponse()
      return {
        status: 200,
        json: { sha, tree: { sha: record.treeSha }, parents: record.parentShas },
        headers: RATE_HEADERS,
      }
    }

    const treeMatch = /^\/git\/trees\/([^/]+)$/.exec(request.path)
    if (treeMatch !== null) {
      const sha = treeMatch[1] as string
      const entries = this.#trees.get(sha)
      if (entries === undefined) return notFoundResponse()
      return {
        status: 200,
        json: { sha, truncated: false, tree: entries },
        headers: { ...RATE_HEADERS, etag: `"tree-${sha}"` },
      }
    }

    const blobGetMatch = /^\/git\/blobs\/([^/]+)$/.exec(request.path)
    if (blobGetMatch !== null) {
      const sha = blobGetMatch[1] as string
      const bytes = this.#blobs.get(sha) ?? this.specBytes(sha)
      if (bytes === undefined) return notFoundResponse()
      return {
        status: 200,
        json: { sha, size: bytes.byteLength, encoding: "base64", content: encodeBase64(bytes) },
        headers: RATE_HEADERS,
      }
    }

    // Deploy-status reads (ADR-0008 P2.8): branch name OR 40-hex sha.
    const checkRunsMatch = /^\/commits\/(.+)\/check-runs$/.exec(request.path)
    if (checkRunsMatch !== null) {
      const sha = this.#resolveCommitRef(checkRunsMatch[1] as string)
      if (sha === undefined) return notFoundResponse()
      const runs = this.#checkRuns.get(sha) ?? []
      return {
        status: 200,
        json: {
          total_count: runs.length,
          check_runs: runs.map((run) => ({
            id: run.id,
            name: run.name,
            status: run.status,
            conclusion: run.conclusion,
            ...(run.detailsUrl === undefined ? {} : { details_url: run.detailsUrl }),
          })),
        },
        headers: RATE_HEADERS,
      }
    }

    const statusesMatch = /^\/commits\/(.+)\/status$/.exec(request.path)
    if (statusesMatch !== null) {
      const sha = this.#resolveCommitRef(statusesMatch[1] as string)
      if (sha === undefined) return notFoundResponse()
      const statuses = this.#statuses.get(sha) ?? []
      return {
        status: 200,
        json: {
          state: combinedStatusState(statuses),
          total_count: statuses.length,
          statuses: statuses.map((status) => ({
            context: status.context,
            state: status.state,
            ...(status.targetUrl === undefined ? {} : { target_url: status.targetUrl }),
          })),
        },
        headers: RATE_HEADERS,
      }
    }

    // Contents route (single-branch fidelity: resolved against the default
    // branch head; multi-branch tests use /git/blobs directly).
    const contentsMatch = /^\/contents\/(.+)$/.exec(request.path)
    if (contentsMatch !== null) {
      const decoded = decodeURIComponent(contentsMatch[1] as string)
      const found = this.contents(this.#spec.defaultBranch, decoded)
      if (found === undefined) return notFoundResponse()
      return {
        status: 200,
        json: {
          name: decoded.split("/").pop(),
          path: decoded,
          sha: found.sha,
          size: found.bytes.byteLength,
          type: "file",
          encoding: "base64",
          content: encodeBase64(found.bytes),
        },
        headers: { ...RATE_HEADERS, etag: `"blob-${found.sha}"` },
      }
    }
    return undefined
  }

  /**
   * Check-runs/statuses accept either a commit sha or a branch name (the login
   * probe uses the branch). Status-only synthetic shas are allowed so a test
   * can model a run landing before any local commit object exists.
   */
  #resolveCommitRef(encodedRef: string): string | undefined {
    const ref = decodeBranchSegment(encodedRef)
    if (this.#commits.has(ref)) return ref
    const branchHead = this.#branches.get(ref)
    if (branchHead !== undefined) return branchHead
    return /^[0-9a-f]{40}$/.test(ref) ? ref : undefined
  }

  /** Bytes seeded from the fixture spec (blob reads beyond created blobs). */
  specBytes(sha: string): Uint8Array | undefined {
    for (const file of this.#spec.files.values()) {
      if (file.sha === sha) return file.bytes
    }
    return undefined
  }

  async #createBlob(body: Record<string, unknown> | undefined): Promise<FakeResponse> {
    const content = body?.content
    const encoding = body?.encoding
    if (typeof content !== "string") {
      return { status: 422, json: { message: "Validation Failed" }, headers: RATE_HEADERS }
    }
    const bytes =
      encoding === "base64" || encoding === undefined
        ? tryDecodeBase64(content)
        : new TextEncoder().encode(content)
    if (bytes === undefined) {
      return { status: 422, json: { message: "Validation Failed" }, headers: RATE_HEADERS }
    }
    const sha = await gitBlobSha(bytes)
    this.#blobs.set(sha, bytes) // content addressing: equal bytes ⇒ same slot (INV-P03)
    return { status: 201, json: { sha }, headers: RATE_HEADERS }
  }

  async #createTree(body: Record<string, unknown> | undefined): Promise<FakeResponse> {
    const baseTreeSha = body?.base_tree
    const entriesInput = body?.tree
    if (baseTreeSha !== undefined && typeof baseTreeSha !== "string") {
      return { status: 422, json: { message: "Validation Failed" }, headers: RATE_HEADERS }
    }
    if (!Array.isArray(entriesInput)) {
      return { status: 422, json: { message: "Validation Failed" }, headers: RATE_HEADERS }
    }
    const base =
      baseTreeSha === undefined ? [] : (this.#trees.get(baseTreeSha as string)?.slice() ?? null)
    if (base === null) return notFoundResponse()

    const byPath = new Map(base.map((entry) => [entry.path, entry]))
    for (const item of entriesInput) {
      const record = asRecord(item)
      const path = record?.path
      if (typeof path !== "string" || path.length === 0 || path.includes("\\")) {
        return { status: 422, json: { message: "Validation Failed" }, headers: RATE_HEADERS }
      }
      const sha = record?.sha
      if (sha === undefined) {
        return { status: 422, json: { message: "Validation Failed" }, headers: RATE_HEADERS }
      }
      if (sha === null) {
        byPath.delete(path) // SHA-0 delete semantics (ADR-0005 §writes)
        continue
      }
      const mode = typeof record?.mode === "string" ? record.mode : "100644"
      const type = typeof record?.type === "string" ? record.type : "blob"
      if (typeof sha !== "string" || !/^[0-9a-f]{40}$/.test(sha)) {
        return { status: 422, json: { message: "Validation Failed" }, headers: RATE_HEADERS }
      }
      if (type === "blob") {
        if (!this.#blobs.has(sha)) {
          return { status: 422, json: { message: "Validation Failed" }, headers: RATE_HEADERS }
        }
      } else if (type === "commit") {
        // Gitlink (submodule): the pointer may live in an EXTERNAL repo —
        // existence in this repo is not required (real GitHub parity;
        // ADR-0005 P2/C.2 addendum).
      } else {
        return { status: 422, json: { message: "Validation Failed" }, headers: RATE_HEADERS }
      }
      const size = type === "blob" ? this.#blobs.get(sha)?.byteLength : undefined
      byPath.set(path, { path, mode, type, sha, ...(size !== undefined ? { size } : {}) })
    }

    const entries = [...byPath.values()].sort((left, right) => (left.path < right.path ? -1 : 1))
    const sha = await gitTreeSha(entries)
    const prior = this.#trees.get(sha)
    if (prior === undefined || !sameEntries(prior, entries)) {
      this.#trees.set(sha, entries)
    }
    // Idempotent overlay: identical map ⇒ identical sha (INV-P03; INV-S02 C.1).
    return { status: 201, json: { sha, tree: entries }, headers: RATE_HEADERS }
  }

  async #createCommit(body: Record<string, unknown> | undefined): Promise<FakeResponse> {
    const message = body?.message
    const treeSha = body?.tree
    const parentsInput = body?.parents
    if (
      typeof message !== "string" ||
      typeof treeSha !== "string" ||
      !Array.isArray(parentsInput) ||
      parentsInput.some((parent) => typeof parent !== "string")
    ) {
      return { status: 422, json: { message: "Validation Failed" }, headers: RATE_HEADERS }
    }
    const parentShas = parentsInput as string[]
    if (this.#trees.get(treeSha) === undefined) {
      return { status: 422, json: { message: "Validation Failed" }, headers: RATE_HEADERS }
    }
    for (const parent of parentShas) {
      if (!this.#commits.has(parent)) {
        return { status: 422, json: { message: "Validation Failed" }, headers: RATE_HEADERS }
      }
    }
    const sha = await gitCommitShaCanonical({ treeSha, parentShas, message })
    if (!this.#commits.has(sha)) {
      this.#commits.set(sha, { treeSha, parentShas, message })
    }
    return {
      status: 201,
      json: {
        sha,
        tree: { sha: treeSha },
        message,
        parents: parentShas.map((parent) => ({ sha: parent })),
      },
      headers: RATE_HEADERS,
    }
  }

  #updateRef(branch: string, body: Record<string, unknown> | undefined): FakeResponse {
    const sha = body?.sha
    if (typeof sha !== "string" || !/^[0-9a-f]{40}$/.test(sha)) {
      return { status: 422, json: { message: "Validation Failed" }, headers: RATE_HEADERS }
    }
    // Parameter-fallback parity with the reference fixture backend: a branch
    // with no local state starts at the seeded head.
    const current = this.#branches.get(branch) ?? this.#spec.headSha

    // Fast-forward law (ADR-0005): no-advance ok; otherwise the new commit must
    // name the current head as its parent. force:true is honored (real GitHub
    // truth) but ALWAYS leaves a request-log fingerprint for INV-P01 to grep.
    const force = body?.force
    if (typeof force !== "boolean" && force !== undefined) {
      return { status: 422, json: { message: "Validation Failed" }, headers: RATE_HEADERS }
    }
    if (sha === current) {
      return {
        status: 200,
        json: { ref: `refs/heads/${branch}`, object: { sha, type: "commit" } },
        headers: RATE_HEADERS,
      }
    }
    if (force === true) {
      if (!this.#commits.has(sha)) {
        return { status: 422, json: { message: "Validation Failed" }, headers: RATE_HEADERS }
      }
      this.#branches.set(branch, sha)
      return {
        status: 200,
        json: { ref: `refs/heads/${branch}`, object: { sha, type: "commit" } },
        headers: RATE_HEADERS,
      }
    }
    const newCommit = this.#commits.get(sha)
    if (newCommit === undefined || !newCommit.parentShas.includes(current)) {
      return {
        status: 422,
        json: { message: "Update is not a fast forward" },
        headers: RATE_HEADERS,
      }
    }
    this.#branches.set(branch, sha)
    return {
      status: 200,
      json: { ref: `refs/heads/${branch}`, object: { sha, type: "commit" } },
      headers: RATE_HEADERS,
    }
  }
}

function sameEntries(left: readonly GitTreeEntry[], right: readonly GitTreeEntry[]): boolean {
  if (left.length !== right.length) return false
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index] as GitTreeEntry
    const b = right[index] as GitTreeEntry
    if (a.path !== b.path || a.sha !== b.sha || a.mode !== b.mode || a.type !== b.type) {
      return false
    }
  }
  return true
}

function decodeBranchSegment(encoded: string): string {
  return encoded
    .split("/")
    .map((segment) => decodeURIComponent(segment))
    .join("/")
}

function tryDecodeBase64(content: string): Uint8Array | undefined {
  try {
    return decodeBase64(content)
  } catch {
    return undefined
  }
}

function combinedStatusState(statuses: readonly CommitStatusSummary[]): string {
  if (statuses.some((status) => status.state === "error" || status.state === "failure")) {
    return "failure"
  }
  if (statuses.some((status) => status.state === "pending")) return "pending"
  return statuses.length > 0 ? "success" : "pending"
}

export function notFoundResponse(): FakeResponse {
  return { status: 404, json: { message: "Not Found" }, headers: RATE_HEADERS }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

export { classifyWriteResponse, networkWriteError }
