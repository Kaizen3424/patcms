import { describe, expect, it } from "vitest"
import {
  buildEmptyRepoSpec,
  buildSpec,
  createHarness,
} from "../../../__tests__/support/fake-github-fetch"
import { BackendReadError } from "../../../backend/errors"
import { BackendWriteError } from "../../../backend/write-errors"
import { encodeUtf8 } from "../../../safety/encoding"
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
  it("bootstraps root commit + branch + file in one save, ref via POST create", async () => {
    const harness = createHarness(buildEmptyRepoSpec(BRANCH))

    const result = await harness.backend.commitChanges(
      { adds: [{ path: "src/content/site.json", bytes: encodeUtf8(SITE) }] },
      "", // NO verified base — the repository has zero commits
      BRANCH,
      { message: "chore(cms): first save bootstraps the repository" },
    )

    expect(result.commitSha).toMatch(/^[0-9a-f]{40}$/)
    // Ref was CREATED, not patched — exactly one POST /git/refs, zero PATCHes.
    const refOps = refEvents(harness)
    expect(refOps).toHaveLength(1)
    expect(refOps[0]).toMatchObject({ method: "POST", path: "/git/refs", status: 201 })
    expect(bodyOf(refOps[0]).ref).toBe(`refs/heads/${BRANCH}`)
    expect(bodyOf(refOps[0]).sha).toBe(result.commitSha)

    // Root commit: parents key ABSENT (not an empty array even).
    const commitOp = harness.server.log.find(
      (event) => event.method === "POST" && event.path === "/git/commits",
    )
    expect(commitOp?.body).toMatchObject({
      message: "chore(cms): first save bootstraps the repository",
    })
    expect(bodyOf(commitOp).parents).toBeUndefined()
    // Root tree: NO base_tree.
    const treeOp = harness.server.log.find(
      (event) => event.method === "POST" && event.path === "/git/trees",
    )
    expect(bodyOf(treeOp).base_tree).toBeUndefined()

    // The branch now reads like any other, and the file is in its tree.
    const ref = await harness.backend.getRef(BRANCH)
    expect(ref.object.sha).toBe(result.commitSha)
    const tree = await harness.backend.readTree(BRANCH, result.commitSha)
    if (tree.kind !== "tree") throw new Error("expected a tree read")
    expect(tree.tree.entries.map((entry) => entry.path)).toContain("src/content/site.json")
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

    const refOps = refEvents(harness)
    expect(refOps).toHaveLength(2)
    expect(refOps[0]).toMatchObject({ method: "POST", path: "/git/refs", status: 201 })
    expect(refOps[1]).toMatchObject({
      method: "PATCH",
      path: `/git/refs/heads/${BRANCH}`,
      status: 200,
    })
    expect(bodyOf(refOps[1]).force).toBe(false)
    const ref = await harness.backend.getRef(BRANCH)
    expect(ref.object.sha).toBe(second.commitSha)
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
