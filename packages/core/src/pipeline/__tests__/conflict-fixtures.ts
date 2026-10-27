/**
 * Conflict-engine INV fixtures — harness plumbing shared by INV-P05/P06/P07/P08.
 * Foreign commits are pushed through the REAL transport adapter (harness.fetch),
 * so every assertion observes what GithubBackend observes.
 */

import type { TreeEntryTuple, TreeRead } from "../../backend/types"
import { encodeBase64, encodeUtf8 } from "../../safety/encoding"
import type { ConflictEngineInput, OurWrite } from "../invariant-engine"
import type { FakeGithubHarness } from "./fake-github-fetch"

export const BRANCH = "fixture-branch"

/** Creates a foreign blob through the real transport — tree entries need an existing sha. */
export async function createForeignBlob(harness: FakeGithubHarness, text: string): Promise<string> {
  const response = await harness.fetch(`${harness.prefix}/git/blobs`, {
    method: "POST",
    body: JSON.stringify({ content: encodeBase64(encodeUtf8(text)), encoding: "base64" }),
  })
  const json = (await response.json()) as { sha?: string }
  if (typeof json.sha !== "string") throw new Error("conflict fixtures: blob create failed")
  return json.sha
}

export interface ForeignTreeEntry {
  readonly path: string
  /** Existing blob sha; `null` deletes the path. */
  readonly sha: string | null
  readonly mode?: string
  readonly type?: string
}

/** Resolves the tree sha backing a commit (recursive read carries its own sha). */
async function treeReadAt(harness: FakeGithubHarness, commitSha: string): Promise<TreeRead> {
  const read = await harness.backend.readTree(BRANCH, commitSha)
  if (read.kind !== "tree") {
    throw new Error("conflict fixtures: tree read unexpectedly returned not-modified")
  }
  return read.tree
}

export interface ForeignCommit {
  /** New commit sha. */
  readonly commitSha: string
  readonly treeSha: string
}

/**
 * Creates a foreign commit ON TOP of the CURRENT branch head through the real
 * transport (tree with base_tree → commit). The ref is NOT moved unless
 * `updateRef` — P08's conflict epoch needs the commit to exist while the ref
 * still names the base, so `moveRefBefore` can move it mid-save.
 */
export async function createForeignCommit(
  harness: FakeGithubHarness,
  entries: readonly ForeignTreeEntry[],
  options: { readonly message?: string; readonly updateRef?: boolean } = {},
): Promise<ForeignCommit> {
  const head = harness.server.ref(BRANCH)
  if (head === undefined) throw new Error("conflict fixtures: branch has no head")
  const baseTree = (await treeReadAt(harness, head)).sha
  const treeResponse = await harness.fetch(`${harness.prefix}/git/trees`, {
    method: "POST",
    body: JSON.stringify({ base_tree: baseTree, tree: entries }),
  })
  const tree = (await treeResponse.json()) as { sha?: string }
  if (typeof tree.sha !== "string") throw new Error("conflict fixtures: tree create failed")
  const commitResponse = await harness.fetch(`${harness.prefix}/git/commits`, {
    method: "POST",
    body: JSON.stringify({
      message: options.message ?? "foreign (concurrent push)",
      tree: tree.sha,
      parents: [head],
    }),
  })
  const commit = (await commitResponse.json()) as { sha?: string }
  if (typeof commit.sha !== "string") throw new Error("conflict fixtures: commit create failed")
  if (options.updateRef ?? true) {
    await harness.fetch(`${harness.prefix}/git/refs/heads/${encodeURIComponent(BRANCH)}`, {
      method: "PATCH",
      body: JSON.stringify({ sha: commit.sha, force: false }),
    })
  }
  return { commitSha: commit.sha, treeSha: tree.sha }
}

/** `createForeignCommit` + the FF ref update (the ordinary foreign push). */
export function pushForeignCommit(
  harness: FakeGithubHarness,
  entries: readonly ForeignTreeEntry[],
  message = "foreign (concurrent push)",
): Promise<ForeignCommit> {
  return createForeignCommit(harness, entries, { message, updateRef: true })
}

/** Flat tuple map at a commit (INV-N02 law: callers own truncation asserts upstream). */
export async function treeEntriesAt(
  harness: FakeGithubHarness,
  commitSha: string,
): Promise<ReadonlyMap<string, TreeEntryTuple>> {
  const tree = await treeReadAt(harness, commitSha)
  return new Map(tree.entries.map((entry) => [entry.path, entry]))
}

/** Blob bytes at an arbitrary commit (tree walk → git-blobs read). */
export async function blobBytesAt(
  harness: FakeGithubHarness,
  commitSha: string,
  path: string,
): Promise<Uint8Array> {
  const entry = (await treeEntriesAt(harness, commitSha)).get(path)
  if (entry === undefined) throw new Error(`conflict fixtures: ${path} not in tree at commit`)
  const blob = await harness.backend.readFile(BRANCH, path, entry.sha)
  if (blob.kind !== "file") {
    throw new Error(`conflict fixtures: ${path} blob read unexpectedly returned not-modified`)
  }
  return blob.file.bytes
}

/**
 * The INV-P08 seam: challenge reads go through the backend WITHOUT an ETag —
 * unconditional by construction (the request log can prove it). Any read
 * failure resolves `undefined` — the engine's conservative `blocked:
 * unreadable` (matrix #9), never a thrown crash mid-adjudication.
 */
export function makeReadFreshBlob(
  harness: FakeGithubHarness,
): ConflictEngineInput["readFreshBlob"] {
  return async (path, tuple) => {
    try {
      const read = await harness.backend.readFile(BRANCH, path, tuple.sha)
      return read.kind === "file" ? read.file.bytes : undefined
    } catch {
      return undefined
    }
  }
}

export interface ConflictInputsOptions {
  readonly baseSha: string
  readonly headSha: string
  readonly ourWrites?: ReadonlyMap<string, OurWrite>
  readonly ourDeletes?: ReadonlySet<string>
  /** Raw bytes our attempt serialized from (the base commit's files). */
  readonly baseRaw?: ReadonlyMap<string, Uint8Array>
}

export async function conflictInputs(
  harness: FakeGithubHarness,
  options: ConflictInputsOptions,
): Promise<ConflictEngineInput> {
  const [baseEntries, headEntries, changed] = await Promise.all([
    treeEntriesAt(harness, options.baseSha),
    treeEntriesAt(harness, options.headSha),
    harness.backend.listChangedFiles(BRANCH, options.baseSha, options.headSha),
  ])
  return {
    changed,
    headEntries,
    baseEntries,
    ourWrites: options.ourWrites ?? new Map(),
    ourDeletes: options.ourDeletes ?? new Set(),
    readFreshBlob: makeReadFreshBlob(harness),
    baseRawBytes: (path) => options.baseRaw?.get(path),
  }
}

/** baseRawBytes provider over the files we seeded (the attempt's raw source). */
export function baseRawBytesFrom(files: readonly [string, string][]): Map<string, Uint8Array> {
  return new Map(files.map(([path, text]) => [path, encodeUtf8(text)]))
}
