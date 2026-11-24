import { describe, expect, it } from "vitest"
import {
  buildEmptyRepoSpec,
  buildSpec,
  createHarness,
} from "../../../__tests__/support/fake-github-fetch"
import { BackendReadError } from "../../../backend/errors"
import { BackendWriteError } from "../../../backend/write-errors"
import type { FetchResponseLike } from "../../../composition"
import { encodeBase64, encodeUtf8 } from "../../../safety/encoding"
import { GithubBackend } from ".."

/**
 * Empty-repository transport behavior (ADR-0011): GitHub answers branch reads
 * of a ZERO-commit repo HTTP 409 with a "Git Repository is empty" body, and
 * the write path bootstraps the root commit + branch — never a force, never a
 * PATCH against a ref that does not exist.
 */

const SITE = '{\n  "title": "site"\n}\n'
const UPDATED = '{\n  "title": "updated"\n}\n'
const BRANCH = "fixture-branch"
const HOSTILE_409_BODY = { message: "Merge conflict: pull request #7 conflict with base branch" }

function refEvents(harness: ReturnType<typeof createHarness>): typeof harness.server.log {
  return harness.server.log.filter((event) => event.path.startsWith("/git/refs"))
}

/** The logged mutation body of a request the test proves was logged. */
function bodyOf(event: { readonly body?: unknown } | undefined): Record<string, unknown> {
  if (event?.body === undefined) throw new Error("expected the request body to be logged")
  return event.body as Record<string, unknown>
}

/** GET /git/commits/{sha} through the model (GitHub-truth parents + tree). */
async function commitRecordOf(
  harness: ReturnType<typeof createHarness>,
  commitSha: string,
): Promise<{ parents: readonly string[]; treeSha: string }> {
  const response = await harness.server.handle({
    method: "GET",
    path: `/git/commits/${commitSha}`,
  })
  if (response.status !== 200) throw new Error("expected the commit record to be readable")
  const payload = response.json as {
    parents?: ReadonlyArray<unknown>
    tree?: { sha?: unknown }
  }
  const parents = (payload.parents ?? []).map((entry) =>
    typeof entry === "string" ? entry : (entry as { sha?: unknown }).sha,
  )
  if (parents.some((sha) => typeof sha !== "string") || typeof payload.tree?.sha !== "string") {
    throw new Error("model served an unusable commit record")
  }
  return { parents: parents as readonly string[], treeSha: payload.tree.sha }
}

/** Another writer wins the bootstrap race with a DISJOINT path (root commit). */
async function seedForeignRoot(
  harness: ReturnType<typeof createHarness>,
  branch: string,
): Promise<string> {
  const response = await harness.server.handle({
    method: "PUT",
    path: "/contents/theirs/foreign.json",
    body: {
      message: "chore(cms): winner, disjoint path",
      content: encodeBase64(encodeUtf8(UPDATED)),
      branch,
    },
  })
  if (response.status !== 201) throw new Error("the foreign bootstrap seed did not create")
  const payload = response.json as { commit: { sha: string } }
  return payload.commit.sha
}

describe("GithubBackend — empty repository ref reads (ADR-0011)", () => {
  it("types a 409 'Git Repository is empty' read EMPTY_REPO, never UNKNOWN", async () => {
    const harness = createHarness(buildEmptyRepoSpec(BRANCH))
    const error = (await harness.backend.getRef(BRANCH).then(
      () => new Error("expected a rejection"),
      (caught: unknown) => caught,
    )) as unknown
    expect(error).toBeInstanceOf(BackendReadError)
    expect((error as BackendReadError).code).toBe("EMPTY_REPO")
    expect((error as BackendReadError).status).toBe(409)
  })

  it("does NOT mistake an unrelated 409 body for an empty repository", async () => {
    // The discriminator is the BODY class: a merge-conflict 409 must stay
    // UNKNOWN-classified so hosts never treat a real conflict as "no content".
    const backend = hostileEmptyBodyBackend()
    const error = (await backend.getRef(BRANCH).then(
      () => new Error("expected a rejection"),
      (caught: unknown) => caught,
    )) as unknown
    expect(error).toBeInstanceOf(BackendReadError)
    expect((error as BackendReadError).code).not.toBe("EMPTY_REPO")
  })
})

describe("GithubBackend — empty repository writes (ADR-0011 bootstrap)", () => {
  it("git-data writes are CLOSED on an empty repo and classify EMPTY_REPO, not VALIDATION", async () => {
    // Live-verified truth (ADR-0011): GitHub closes the ENTIRE git-data API on
    // a zero-commit repo, and the marshalled 409 empty body must arrive as
    // typed EMPTY_REPO — never the 422-class VALIDATION that made the real
    // E2E run display "content needs attention" for an ordinary first save.
    const error409Empty: FetchResponseLike = {
      ok: false,
      status: 409,
      statusText: "Conflict",
      headers: { get: () => null },
      json: async () => ({ message: "Git Repository is empty.", status: "409" }),
      text: async () => '{"message":"Git Repository is empty.","status":"409"}',
    }
    const backend = new GithubBackend({
      owner: "owner",
      repo: "repo",
      token: "token",
      fetch: async () => error409Empty,
    })
    let caught: unknown
    try {
      await backend.commitChanges(
        { adds: [{ path: "src/content/site.json", bytes: encodeUtf8(SITE) }] },
        "",
        BRANCH,
        { message: "chore(cms): bootstrap attempt" },
      )
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(BackendWriteError)
    expect((caught as BackendWriteError).code).toBe("EMPTY_REPO")
  })

  it("bootstraps the root commit + branch + file as ONE contents-API PUT", async () => {
    const harness = createHarness(buildEmptyRepoSpec(BRANCH))

    const result = await harness.backend.commitChanges(
      { adds: [{ path: "src/content/site.json", bytes: encodeUtf8(SITE) }] },
      "", // NO verified base — the repository has zero commits
      BRANCH,
      { message: "chore(cms): first save bootstraps the repository" },
    )

    expect(result.commitSha).toMatch(/^[0-9a-f]{40}$/)
    // The first commit is made through the REST contents API — the only write
    // GitHub keeps open on a zero-commit repo. Exactly one PUT, with the save
    // message, the base64 content, and the branch in the body.
    const puts = harness.server.log.filter(
      (event) => event.method === "PUT" && !event.path.startsWith("/git/"),
    )
    expect(puts).toHaveLength(1)
    expect(puts[0]?.path).toBe("/contents/src/content/site.json")
    expect(bodyOf(puts[0]).message).toBe("chore(cms): first save bootstraps the repository")
    expect(bodyOf(puts[0]).content).toBe(encodeBase64(encodeUtf8(SITE)))
    expect(bodyOf(puts[0]).branch).toBe(BRANCH)
    // No git-data write request at all: no blobs, trees, commits, or ref routes.
    expect(
      harness.server.log.filter(
        (event) =>
          (event.method === "POST" || event.method === "PATCH") && event.path.startsWith("/git/"),
      ),
    ).toEqual([])

    // Root commit: the branch reads like any other and the file is in its tree.
    const ref = await harness.backend.getRef(BRANCH)
    expect(ref.object.sha).toBe(result.commitSha)
    const tree = await harness.backend.readTree(BRANCH, result.commitSha)
    if (tree.kind !== "tree") throw new Error("expected a tree read")
    expect(tree.tree.entries.map((entry) => entry.path)).toContain("src/content/site.json")
    // The published commit IS a root commit (the CAS premise, verified).
    expect((await commitRecordOf(harness, result.commitSha)).parents).toEqual([])
  })

  it("the second save on the same repo is a NORMAL fast-forward ref PATCH", async () => {
    const harness = createHarness(buildEmptyRepoSpec(BRANCH))
    const first = await harness.backend.commitChanges(
      { adds: [{ path: "src/content/site.json", bytes: encodeUtf8(SITE) }] },
      "",
      BRANCH,
      { message: "chore(cms): bootstrap" },
    )

    const second = await harness.backend.commitChanges(
      { updates: [{ path: "src/content/site.json", bytes: encodeUtf8(UPDATED) }] },
      first.commitSha, // verified base from the bootstrap commit
      BRANCH,
      { message: "chore(cms): ordinary save" },
    )
    expect(second.commitSha).toMatch(/^[0-9a-f]{40}$/)

    // Save #1 made NO ref requests (the contents PUT anchored the branch
    // server-side); save #2 is the ordinary FF PATCH with force:false.
    const refOps = refEvents(harness)
    expect(refOps).toHaveLength(1)
    expect(refOps[0]).toMatchObject({
      method: "PATCH",
      path: `/git/refs/heads/${BRANCH}`,
      status: 200,
    })
    expect(bodyOf(refOps[0]).force).toBe(false)
    expect(bodyOf(refOps[0]).sha).toBe(second.commitSha)
    const ref = await harness.backend.getRef(BRANCH)
    expect(ref.object.sha).toBe(second.commitSha)
  })

  it("a MULTI-file first save is exactly two commits: seed PUT + one normal commit", async () => {
    const harness = createHarness(buildEmptyRepoSpec(BRANCH))

    const result = await harness.backend.commitChanges(
      {
        adds: [
          { path: "src/content/zeta.json", bytes: encodeUtf8(SITE) },
          { path: "src/content/alpha.json", bytes: encodeUtf8(UPDATED) },
          { path: "src/content/mid.json", bytes: encodeUtf8(SITE) },
        ],
      },
      "",
      BRANCH,
      { message: "chore(cms): multi-file first save" },
    )
    const puts = harness.server.log.filter(
      (event) => event.method === "PUT" && !event.path.startsWith("/git/"),
    )
    expect(puts).toHaveLength(1)
    // The seed is the lexicographically FIRST add, carrying the save message.
    expect(puts[0]?.path).toBe("/contents/src/content/alpha.json")
    expect(bodyOf(puts[0]).message).toBe("chore(cms): multi-file first save")
    // Then exactly ONE git-data pipeline commit on top of the seed commit.
    const treeOps = harness.server.log.filter(
      (event) => event.method === "POST" && event.path === "/git/trees",
    )
    expect(treeOps).toHaveLength(1)
    // The seed commit is the parent of the follow-up commit: a two-commit
    // chain, root ← seed with only the seed file. (Documented bootstrap
    // exception to one-commit-per-save, ADR-0011.)
    const headRecord = await commitRecordOf(harness, result.commitSha)
    expect(headRecord.parents).toHaveLength(1)
    const seedRecord = await commitRecordOf(harness, headRecord.parents[0] as string)
    expect(seedRecord.parents).toEqual([])
    expect(bodyOf(treeOps[0]).base_tree).toBe(seedRecord.treeSha)
    const seedTree = await harness.backend.readTree(BRANCH, seedRecord.treeSha)
    if (seedTree.kind !== "tree") throw new Error("expected a tree read")
    expect(seedTree.tree.entries.map((entry) => entry.path)).toEqual(["src/content/alpha.json"])

    const ref = await harness.backend.getRef(BRANCH)
    expect(ref.object.sha).toBe(result.commitSha)
    const tree = await harness.backend.readTree(BRANCH, result.commitSha)
    if (tree.kind !== "tree") throw new Error("expected a tree read")
    expect(tree.tree.entries.map((entry) => entry.path).sort()).toEqual([
      "src/content/alpha.json",
      "src/content/mid.json",
      "src/content/zeta.json",
    ])
  })

  it("a losing bootstrap race refuses as CAS_CONFLICT and never moves the ref", async () => {
    const harness = createHarness(buildEmptyRepoSpec(BRANCH))
    const winner = await harness.backend.commitChanges(
      { adds: [{ path: "src/content/site.json", bytes: encodeUtf8(SITE) }] },
      "",
      BRANCH,
      { message: "chore(cms): winner" },
    )

    let loser: unknown
    try {
      await harness.backend.commitChanges(
        { adds: [{ path: "src/content/site.json", bytes: encodeUtf8(UPDATED) }] },
        "", // stale premise: the repository stopped being empty mid-flight
        BRANCH,
        { message: "chore(cms): loser" },
      )
    } catch (error) {
      loser = error
    }
    expect(loser).toBeInstanceOf(BackendWriteError)
    expect((loser as BackendWriteError).code).toBe("CAS_CONFLICT")
    expect((await harness.backend.getRef(BRANCH)).object.sha).toBe(winner.commitSha)
    // No force anywhere in the losing attempt's log.
    for (const event of harness.server.log) {
      if (event.method === "PATCH") {
        expect((event.body as { force?: unknown }).force).not.toBe(true)
      }
    }
  })

  it("a disjoint-path bootstrap race refuses as CAS_CONFLICT; the winner's chain stands", async () => {
    // A race where the winner's files do NOT overlap our seed path: real
    // GitHub has no atomic "create only if branch absent" on the contents API,
    // so the PUT lands as a CHILD of the winner's head and only then the
    // parent-chain verification refuses the save (never adopted as the save's
    // result, never forced back — that would need a force). The host's rebind
    // sees the loser's file as plain remote content and re-decides (ADR-0011).
    const harness = createHarness(buildEmptyRepoSpec(BRANCH))
    const winnerSha = await seedForeignRoot(harness, BRANCH)

    let loser: unknown
    try {
      await harness.backend.commitChanges(
        { adds: [{ path: "src/content/ours.json", bytes: encodeUtf8(SITE) }] },
        "", // stale empty premise
        BRANCH,
        { message: "chore(cms): loser, disjoint path" },
      )
    } catch (error) {
      loser = error
    }
    expect(loser).toBeInstanceOf(BackendWriteError)
    expect((loser as BackendWriteError).code).toBe("CAS_CONFLICT")

    // GitHub truth: the refused save's PUT still landed (a child commit) — the
    // winner's commit is its PARENT (chain intact, nothing lost, no force).
    const head = (await harness.backend.getRef(BRANCH)).object.sha
    expect(head).not.toBe(winnerSha)
    const loserRecord = await commitRecordOf(harness, head)
    expect(loserRecord.parents).toEqual([winnerSha])
    for (const event of harness.server.log) {
      if (event.method === "PATCH") {
        expect((event.body as { force?: unknown }).force).not.toBe(true)
      }
    }
  })
})

describe("GithubBackend — missing branch on a NON-empty repository (ADR-0011)", () => {
  it("names the branch in a NOT_FOUND, not a generic 404/422", async () => {
    const spec = await buildSpec([["src/content/site.json", SITE]])
    const harness = createHarness(spec)
    const error = (await harness.backend.getRef("no-such-branch").then(
      () => new Error("expected a rejection"),
      (caught: unknown) => caught,
    )) as unknown
    expect(error).toBeInstanceOf(BackendReadError)
    expect((error as BackendReadError).code).toBe("NOT_FOUND")
    expect((error as BackendReadError).message).toBe("GitHub branch not found: no-such-branch")
    // The save path binds its base from THIS read before writing, so the
    // driver refuses a missing branch before any write request (the
    // end-to-end behavior is pinned at client level).
  })
})

function hostileEmptyBodyBackend(): GithubBackend {
  // A 409 that says something else (e.g. the merge-conflict class) must keep
  // its UNKNOWN classification: the body signature is the discriminator.
  const response = {
    ok: false,
    status: 409,
    statusText: "ERR",
    headers: { get: () => null },
    json: async () => HOSTILE_409_BODY,
    text: async () => JSON.stringify(HOSTILE_409_BODY),
  }
  return new GithubBackend({
    owner: "owner",
    repo: "repo",
    token: "token",
    fetch: async () => response,
  })
}
