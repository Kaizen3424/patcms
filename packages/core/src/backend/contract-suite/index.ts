/**
 * Backend contract suite — ADR-0001.
 *
 * The SAME suite every backend implementation must pass (GithubBackend,
 * reference-fixture-backend exemplar, Stage-B GitLab — and the playground's
 * FakeGithub). Checks are self-contained and sequential; write checks run
 * AFTER read checks and leave HEAD in a coherent state.
 */
import { encodeUtf8 } from "../../safety/encoding"
import type { GitBackend } from "../types"
import { BackendWriteError } from "../write-errors"

export interface ContractContext {
  readonly backend: GitBackend
  /** Branch is data (INV-P14); the suite never hard-codes a branch name. */
  readonly branch: string
  readonly expectedPaths: readonly string[]
  readonly expectedFileBytes?: Uint8Array
}

export interface ContractCheck {
  readonly name: string
  run(ctx: ContractContext): Promise<void>
}

export interface ContractSuite {
  readonly name: "core-contract-suite"
  readonly checks: readonly ContractCheck[]
}

export interface ContractFailure {
  readonly name: string
  readonly error: unknown
}

export interface ContractReport {
  readonly passed: number
  readonly failures: readonly ContractFailure[]
  readonly ok: boolean
}

export interface ContractRunOptions {
  readonly branch?: string
  readonly expectedPaths?: readonly string[]
  readonly expectedFileBytes?: Uint8Array
}

/** Marks and freezes a check list — the suite cannot grow silently at runtime. */
export function defineContractSuite(checks: readonly ContractCheck[]): ContractSuite {
  return { name: "core-contract-suite", checks: Object.freeze([...checks]) }
}

/** Executes checks sequentially against one backend implementation. */
export async function runContractSuite(
  backend: GitBackend,
  suite: ContractSuite,
  options: ContractRunOptions = {},
): Promise<ContractReport> {
  const ctx: ContractContext = {
    backend,
    branch: options.branch ?? "contract-fixture",
    expectedPaths: options.expectedPaths ?? [],
    ...(options.expectedFileBytes === undefined
      ? {}
      : { expectedFileBytes: options.expectedFileBytes }),
  }
  const failures: ContractFailure[] = []
  let passed = 0
  for (const check of suite.checks) {
    try {
      await check.run(ctx)
      passed += 1
    } catch (error) {
      failures.push({ name: check.name, error })
    }
  }
  return { passed, failures, ok: failures.length === 0 }
}

/**
 * Shape check: capabilities must be the exhaustive boolean object and the
 * read/write methods must exist.
 */
export const SHAPE_CHECK: ContractCheck = {
  name: "backend-shape/capabilities-and-methods",
  async run({ backend }) {
    const { capabilities } = backend
    if (typeof capabilities !== "object" || capabilities === null) {
      throw new Error("capabilities must be an object (exhaustive literal, ADR-0005)")
    }
    for (const key of ["commitStatus", "branches"] as const) {
      if (typeof capabilities[key] !== "boolean") {
        throw new Error(`capabilities.${key} must be boolean (exhaustive literal object law)`)
      }
    }
    const requiredMethods = [
      "getRef",
      "readTree",
      "readFile",
      "listChangedFiles",
      "commitChanges",
      "readCheckRuns",
      "readCommitStatuses",
    ] as const
    for (const method of requiredMethods) {
      if (typeof backend[method] !== "function") {
        throw new Error(`GitBackend implementation missing ${method}()`)
      }
    }
  },
}

export const READ_TREE_CHECK: ContractCheck = {
  name: "backend-reads/ref-and-tree",
  async run({ backend, branch, expectedPaths }) {
    const ref = await backend.getRef(branch)
    if (!/^[0-9a-f]{40}$/.test(ref.object.sha)) {
      throw new Error(`getRef(${branch}) returned a non-40-hex sha: ${ref.object.sha}`)
    }
    const read = await backend.readTree(branch, ref.object.sha)
    if (read.kind !== "tree") throw new Error("first tree read must return a tree (not 304)")
    if (read.tree.truncated)
      throw new Error("backend returned truncated:true — fallback was not applied")
    if (read.tree.sha.length === 0) throw new Error("tree read returned an empty sha")
    for (const path of expectedPaths) {
      if (!read.tree.entries.some((entry) => entry.path === path)) {
        throw new Error(`tree read is missing expected path ${path}`)
      }
    }
    for (const entry of read.tree.entries) {
      if (!entry.path.startsWith("src/") && !entry.path.startsWith("public/")) continue
      if (!/^[0-9a-f]{40}$/.test(entry.sha)) {
        throw new Error(`tree entry ${entry.path} has a non-40-hex sha`)
      }
    }
  },
}

export const READ_FILE_CHECK: ContractCheck = {
  name: "backend-reads/file-bytes",
  async run({ backend, branch, expectedPaths, expectedFileBytes }) {
    if (expectedPaths.length === 0) return
    const path = expectedPaths[0] as string
    const ref = await backend.getRef(branch)
    const tree = await backend.readTree(branch, ref.object.sha)
    if (tree.kind !== "tree") throw new Error("tree read returned 304 during file check")
    const entry = tree.tree.entries.find((candidate) => candidate.path === path)
    if (entry === undefined) throw new Error(`tree read is missing ${path}`)
    const file = await backend.readFile(branch, path, entry.sha)
    if (file.kind !== "file") throw new Error("first file read must return bytes (not 304)")
    if (file.file.path !== path) throw new Error("file read returned the wrong path")
    if (file.file.sha !== entry.sha) throw new Error("file sha does not match its tree entry")
    if (file.file.bytes.length !== file.file.size) {
      throw new Error("file byte length does not match the reported size")
    }
    if (expectedFileBytes !== undefined) {
      const actual = file.file.bytes
      if (actual.length !== expectedFileBytes.length) throw new Error("file bytes length mismatch")
      for (let index = 0; index < actual.length; index += 1) {
        if (actual[index] !== expectedFileBytes[index]) throw new Error("file bytes mismatch")
      }
    }
  },
}

export const ETAG_CHECK: ContractCheck = {
  name: "backend-reads/etag-not-modified",
  async run({ backend, branch }) {
    const ref = await backend.getRef(branch)
    const tree = await backend.readTree(branch, ref.object.sha)
    if (tree.kind !== "tree") throw new Error("first tree read returned 304")
    if (tree.etag !== undefined) {
      const cached = await backend.readTree(branch, ref.object.sha, { etag: tree.etag })
      if (cached.kind !== "not-modified") throw new Error("tree ETag did not produce a 304 result")
    }
    if (tree.tree.entries.length === 0) return
    const entry = tree.tree.entries[0]
    if (entry === undefined) return
    const file = await backend.readFile(branch, entry.path, entry.sha)
    if (file.kind !== "file") throw new Error("first file read returned 304")
    if (file.etag !== undefined) {
      const cached = await backend.readFile(branch, entry.path, entry.sha, { etag: file.etag })
      if (cached.kind !== "not-modified") throw new Error("file ETag did not produce a 304 result")
    }
  },
}

export const EMPTY_DIFF_CHECK: ContractCheck = {
  name: "backend-reads/empty-tree-diff",
  async run({ backend, branch }) {
    const ref = await backend.getRef(branch)
    const diff = await backend.listChangedFiles(branch, ref.object.sha, ref.object.sha)
    if (diff.size !== 0) throw new Error("identical commits produced a non-empty tree diff")
  },
}

/**
 * Status reads are required methods gated by `capabilities.commitStatus`
 * (ADR-0005 P2.8 addendum): truthful ok-shape when true, `unsupported` when
 * false. Status data itself is scenario-owned; the suite checks the contract.
 */
export const STATUS_READ_CHECK: ContractCheck = {
  name: "backend-reads/status-read-shape",
  async run({ backend, branch }) {
    const ref = await backend.getRef(branch)
    const checks = await backend.readCheckRuns(branch, ref.object.sha)
    const statuses = await backend.readCommitStatuses(branch, ref.object.sha)
    if (!backend.capabilities.commitStatus) {
      if (checks.kind !== "unsupported") {
        throw new Error("commitStatus:false must make readCheckRuns return unsupported")
      }
      if (statuses.kind !== "unsupported") {
        throw new Error("commitStatus:false must make readCommitStatuses return unsupported")
      }
      return
    }
    if (checks.kind !== "ok") {
      throw new Error("commitStatus:true but readCheckRuns returned unsupported")
    }
    if (statuses.kind !== "ok") {
      throw new Error("commitStatus:true but readCommitStatuses returned unsupported")
    }
    if (!Number.isInteger(checks.totalCount) || checks.totalCount < checks.runs.length) {
      throw new Error("check-runs totalCount must be an integer ≥ the returned run count")
    }
    for (const run of checks.runs) {
      if (!Number.isFinite(run.id) || run.name.length === 0) {
        throw new Error("check-run entries need a numeric id and a name")
      }
      if (run.detailsUrl !== undefined && !run.detailsUrl.startsWith("https://")) {
        throw new Error("check-run detailsUrl must be https when present")
      }
    }
    for (const status of statuses.statuses) {
      if (status.context.length === 0) throw new Error("commit-status entries need a context")
      if (status.targetUrl !== undefined && !status.targetUrl.startsWith("https://")) {
        throw new Error("commit-status targetUrl must be https when present")
      }
    }
  },
}

const WRITE_CHECK_PATH = "src/content/contract-write-check.json"
const WRITE_CHECK_CAS_PATH = "src/content/contract-cas-check.json"
const WRITE_CHECK_BYTES = '{\n  "contract": "write-check"\n}\n'
const WRITE_CHECK_CAS_BYTES = '{\n  "contract": "cas-check"\n}\n'

/** Transactional green path: one commit, exact diff, byte-exact read-back. */
export const WRITE_COMMIT_CHECK: ContractCheck = {
  name: "backend-writes/single-commit-roundtrip",
  async run({ backend, branch }) {
    const baseline = await backend.getRef(branch)
    const result = await backend.commitChanges(
      { adds: [{ path: WRITE_CHECK_PATH, bytes: encodeUtf8(WRITE_CHECK_BYTES) }] },
      baseline.object.sha,
      branch,
      { message: "chore(cms): contract suite write check" },
    )
    if (!/^[0-9a-f]{40}$/.test(result.commitSha)) {
      throw new Error("commitChanges returned a non-40-hex commitSha")
    }
    if (!/^[0-9a-f]{40}$/.test(result.treeSha)) {
      throw new Error("commitChanges returned a non-40-hex treeSha")
    }
    const head = await backend.getRef(branch)
    if (head.object.sha !== result.commitSha) {
      throw new Error("ref did not advance to the created commit after commitChanges")
    }
    const diff = await backend.listChangedFiles(branch, baseline.object.sha, result.commitSha)
    if (diff.size !== 1 || !diff.has(WRITE_CHECK_PATH)) {
      throw new Error("write produced a diff other than exactly its own path")
    }
    const written = diff.get(WRITE_CHECK_PATH)
    const file = await backend.readFile(branch, WRITE_CHECK_PATH, written?.sha ?? "")
    if (file.kind !== "file") throw new Error("written file is not readable back")
    const bytes = encodeUtf8(WRITE_CHECK_BYTES)
    if (file.file.bytes.length !== bytes.length) throw new Error("written bytes length mismatch")
    for (let index = 0; index < bytes.length; index += 1) {
      if (file.file.bytes[index] !== bytes[index]) throw new Error("written bytes mismatch")
    }
  },
}

/** CAS law: a stale-base commit is refused; HEAD never moves backwards. */
export const WRITE_CAS_CHECK: ContractCheck = {
  name: "backend-writes/stale-base-refusal",
  async run({ backend, branch }) {
    const current = await backend.getRef(branch)
    const landed = await backend.commitChanges(
      { adds: [{ path: WRITE_CHECK_PATH, bytes: encodeUtf8(WRITE_CHECK_BYTES) }] },
      current.object.sha,
      branch,
      { message: "chore(cms): contract suite CAS pre-step" },
    )
    let refused: unknown
    try {
      await backend.commitChanges(
        { adds: [{ path: WRITE_CHECK_CAS_PATH, bytes: encodeUtf8(WRITE_CHECK_CAS_BYTES) }] },
        current.object.sha,
        branch,
        { message: "chore(cms): contract suite stale attempt" },
      )
    } catch (error) {
      refused = error
    }
    if (!(refused instanceof BackendWriteError) || refused.code !== "CAS_CONFLICT") {
      throw new Error("a stale-base commit did not refuse as CAS_CONFLICT")
    }
    const head = await backend.getRef(branch)
    if (head.object.sha !== landed.commitSha) {
      throw new Error("HEAD moved as a result of the refused stale commit")
    }
  },
}

export const CORE_CONTRACT_SUITE = defineContractSuite([
  SHAPE_CHECK,
  READ_TREE_CHECK,
  READ_FILE_CHECK,
  ETAG_CHECK,
  EMPTY_DIFF_CHECK,
  STATUS_READ_CHECK,
  WRITE_COMMIT_CHECK,
  WRITE_CAS_CHECK,
])
