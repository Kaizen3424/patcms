/// <reference types="node" />
import { describe, expect, it } from "vitest"
import {
  BASE_CONTENT,
  buildSpec,
  createHarness,
  type FakeGithubHarness,
  successfulRefUpdates,
} from "../../__tests__/support/fake-github-fetch"
import type { GitBackend } from "../../backend/types"
import { GithubBackend } from "../../backends/github"
import type { FetchLike } from "../../composition"
import type { DraftRecord, DraftStore } from "../../drafts"
import { encodeBase64, encodeUtf8 } from "../../safety/encoding"
import type { Logger } from "../../safety/logger"
import type { JsonValue } from "../../safety/untrusted-json"
import { canonicalJson } from "../../serialization/document"
import { createSaveCoordinator, type SaveRequest } from "../save-controller"
import { createForeignBlob, createForeignCommit } from "./conflict-fixtures"

/**
 * P2.5 — the coordinator's conflict machinery (ADR-0004 C.3 pins + INV-P05):
 *  - a SATISFIED predicate (foreign commit left our file alone) self-rebases
 *    by re-entering the CAS against the fresh head — the save publishes;
 *  - a DISJOINT field merge (rebase without frozen fields) auto-commits the
 *    merged bytes — the founder's edits AND the foreign edits both survive;
 *  - an OVERLAPPING field merge freezes with the merge preview + verdicts
 *    for the P2.9 freeze UI; the draft is retained verbatim;
 *  - the rebase budget bounds self-rebases; challenge/engine failures yield
 *    honest, UNENRICHED conflicts (never a silent publish, never a crash);
 *  - backoff (retryable failures) wakes on the schedule; the cap parks for
 *    MANUAL resume; wake gates coalesce (a wake between waits is not lost).
 */

const SITE_PATH = "src/content/site.json"
const IRIS_PATH = "src/content/products/iris.json"
const SITE_BASE_RAW = '{\n  "title": "site"\n}\n'

const OWNER = "fixture-owner"
const REPO = "fixture-repo"
const BASE_URL = "https://unit.test"

function backendOf(_harness: FakeGithubHarness, fetch: FetchLike): GithubBackend {
  return new GithubBackend({ owner: OWNER, repo: REPO, token: "t", fetch, baseUrl: BASE_URL })
}

/**
 * Mid-flight ref race: the FIRST PATCH-ref call in OUR save observes the ref
 * silently moved to `sha` (a concurrent foreign push landing between our base
 * binding and our CAS). Deterministic stand-in for real-world interleavings.
 */
function backendWithRefMoveAtPatch(
  harness: FakeGithubHarness,
  branch: string,
  foreignSha: string,
): GithubBackend {
  const inner = harness.fetch
  let moved = false
  const fetch: FetchLike = async (url, init) => {
    const method = (init?.method ?? "GET").toUpperCase()
    if (method === "PATCH" && String(url).includes("/git/refs/heads/") && !moved) {
      moved = true
      harness.server.setRef(branch, foreignSha)
    }
    return inner(url, init)
  }
  return backendOf(harness, fetch)
}

/** Pushes a foreign commit ON TOP of the current head via server.handle directly. */
async function foreignPushOnHead(
  harness: FakeGithubHarness,
  branch: string,
  files: readonly [string, string][],
): Promise<string> {
  const server = harness.server
  const head = server.ref(branch) as string
  const headTree = (await server.handle({ method: "GET", path: `/git/trees/${head}` })).json as {
    sha?: string
  }
  const entries: Array<{ path: string; mode: string; type: string; sha: string | null }> = []
  for (const [path, text] of files) {
    const blob = (
      await server.handle({
        method: "POST",
        path: "/git/blobs",
        body: { content: encodeBase64(encodeUtf8(text)), encoding: "base64" },
      })
    ).json as { sha?: string }
    if (typeof blob.sha !== "string") throw new Error("foreignPushOnHead: blob failed")
    entries.push({ path, mode: "100644", type: "blob", sha: blob.sha })
  }
  const tree = (
    await server.handle({
      method: "POST",
      path: "/git/trees",
      body: { base_tree: headTree.sha, tree: entries },
    })
  ).json as { sha?: string }
  if (typeof tree.sha !== "string") throw new Error("foreignPushOnHead: tree failed")
  const commit = (
    await server.handle({
      method: "POST",
      path: "/git/commits",
      body: { message: "foreign push (post-ack)", tree: tree.sha, parents: [head] },
    })
  ).json as { sha?: string }
  if (typeof commit.sha !== "string") throw new Error("foreignPushOnHead: commit failed")
  const ref = await server.handle({
    method: "PATCH",
    path: `/git/refs/heads/${encodeURIComponent(branch)}`,
    body: { sha: commit.sha, force: false },
  })
  if (ref.status !== 200) throw new Error("foreignPushOnHead: ref update failed")
  return commit.sha
}

function siteRequest(
  draftKey: string,
  baseSha: string,
  formValue: Record<string, unknown>,
): SaveRequest {
  return {
    draftKey,
    changes: {
      updates: [{ path: SITE_PATH, bytes: encodeUtf8(canonicalJson(formValue as JsonValue)) }],
    },
    baseSha,
    draft: {
      filePath: SITE_PATH,
      baseSha,
      baseRaw: SITE_BASE_RAW,
      formValue,
    },
  }
}

function recordingLogger(): Logger & { readonly debugs: string[] } {
  const debugs: string[] = []
  return {
    debugs,
    debug(message: string) {
      debugs.push(message)
    },
    info(): void {},
    warn(): void {},
    error(): void {},
    history: [],
  }
}

const settle = (ms = 40): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

describe("P2.5 coordinator — a satisfied predicate self-rebases (INV-P05)", () => {
  it("a foreign commit to ANOTHER file does not block our save", async () => {
    const spec = await buildSpec(BASE_CONTENT)
    const harness = createHarness(spec)
    const foreignRaw = '{\n  "title": "iris",\n  "note": "foreign"\n}\n'
    const foreignBlob = await createForeignBlob(harness, foreignRaw)
    const foreign = await createForeignCommit(
      harness,
      [{ path: IRIS_PATH, sha: foreignBlob }],
      { updateRef: false }, // objects exist; the ref move happens at PATCH time
    )
    const logger = recordingLogger()
    const coordinator = createSaveCoordinator({
      backend: backendWithRefMoveAtPatch(harness, spec.defaultBranch, foreign.commitSha),
      branch: spec.defaultBranch,
      drafts: memoryDrafts(),
      logger,
    })

    const verdict = await coordinator.save(siteRequest("site", spec.headSha, { title: "ours" }))

    expect(verdict.kind).toBe("published")
    // Re-entry: our second attempt re-based on the foreign head. Attempt #1's
    // commit still exists in the object DB (the 422 only refused the REF
    // update) — orphaned objects are never cleaned (INV-P10).
    expect(harness.server.commitCount()).toBe(4) // seed + foreign + attempt1 + attempt2
    const iris = harness.server.contents(spec.defaultBranch, IRIS_PATH)
    expect(iris && new TextDecoder().decode(iris.bytes)).toBe(foreignRaw)
    const site = harness.server.contents(spec.defaultBranch, SITE_PATH)
    expect(site && new TextDecoder().decode(site.bytes)).toBe('{\n  "title": "ours"\n}\n')
    // The no-op START on re-entry is logged, not a state corruption.
    expect(logger.debugs.some((message) => message.includes("no-op"))).toBe(true)
  })
})

describe("P2.5 coordinator — disjoint field merge auto-commits", () => {
  it("the merged bytes (ours + foreign) publish; both survive", async () => {
    const spec = await buildSpec(BASE_CONTENT)
    const harness = createHarness(spec)
    const foreignRaw = '{\n  "title": "site",\n  "description": "kept"\n}\n'
    const foreignBlob = await createForeignBlob(harness, foreignRaw)
    const foreign = await createForeignCommit(harness, [{ path: SITE_PATH, sha: foreignBlob }], {
      updateRef: false,
    })
    const coordinator = createSaveCoordinator({
      backend: backendWithRefMoveAtPatch(harness, spec.defaultBranch, foreign.commitSha),
      branch: spec.defaultBranch,
      drafts: memoryDrafts(),
    })

    const verdict = await coordinator.save(siteRequest("site", spec.headSha, { title: "v2" }))

    expect(verdict.kind).toBe("published")
    if (verdict.kind !== "published") return
    // P2.9 INV-P17: the merged bytes landed, so the verdict carries the
    // reconciliation — the editor must adopt them as its next base.
    expect(verdict.reconciliation).toBeDefined()
    expect(verdict.reconciliation?.reconciledRaw).toBe(
      '{\n  "title": "v2",\n  "description": "kept"\n}\n',
    )
    expect(verdict.reconciliation?.reconciledSha).toBe(verdict.commitSha)
    const site = harness.server.contents(spec.defaultBranch, SITE_PATH)
    expect(site && new TextDecoder().decode(site.bytes)).toBe(
      '{\n  "title": "v2",\n  "description": "kept"\n}\n',
    )
    expect(harness.server.commitCount()).toBe(4) // seed + foreign + attempt1 + auto-merge
  })

  it("an ordinary publish (no auto-merge) carries NO reconciliation", async () => {
    const spec = await buildSpec(BASE_CONTENT)
    const harness = createHarness(spec)
    const coordinator = createSaveCoordinator({
      backend: backendOf(harness, harness.fetch),
      branch: spec.defaultBranch,
      drafts: memoryDrafts(),
    })

    const verdict = await coordinator.save(siteRequest("site", spec.headSha, { title: "plain" }))

    expect(verdict.kind).toBe("published")
    if (verdict.kind !== "published") return
    expect(verdict.reconciliation).toBeUndefined()
  })
})

describe("P2.5 coordinator — overlapping fields freeze (P2.9 input shape)", () => {
  it("conflict carries the merge preview + verdicts; the draft is retained", async () => {
    const spec = await buildSpec(BASE_CONTENT)
    const harness = createHarness(spec)
    const foreignRaw = '{\n  "title": "foreign title"\n}\n'
    const foreignBlob = await createForeignBlob(harness, foreignRaw)
    const foreign = await createForeignCommit(harness, [{ path: SITE_PATH, sha: foreignBlob }], {
      updateRef: false,
    })
    const drafts = memoryDrafts()
    const coordinator = createSaveCoordinator({
      backend: backendWithRefMoveAtPatch(harness, spec.defaultBranch, foreign.commitSha),
      branch: spec.defaultBranch,
      drafts,
    })

    const verdict = await coordinator.save(siteRequest("site", spec.headSha, { title: "my title" }))

    expect(verdict.kind).toBe("conflict")
    if (verdict.kind !== "conflict") return
    expect(verdict.details.currentHeadSha).toBe(foreign.commitSha)
    expect(verdict.details.merge).toBeDefined()
    expect(verdict.details.merge?.frozenFieldPaths.length).toBe(1)
    // P2.9: the preview carries the foreign bytes (the freeze UI's "theirs").
    // The only dirty path (`title`) IS the frozen one, so nothing survives
    // outside the freeze — ourFieldPaths is empty by law.
    expect(verdict.details.merge?.remoteRaw).toBe(foreignRaw)
    expect(verdict.details.merge?.ourFieldPaths).toEqual([])
    expect(verdict.details.verdicts?.get(SITE_PATH)?.kind).toBe("field-merge")
    // Freeze, not data loss: the draft survives verbatim for the freeze UI.
    expect(await drafts.get("site")).toBeDefined()
    expect(successfulRefUpdates(harness.server)).toBe(0) // our PATCH 422'd; foreign never PATCHed
    expect(harness.server.commitCount()).toBe(3) // seed + foreign + attempt1 (orphaned)
  })
})

describe("P2.5 coordinator — the rebase budget bounds self-rebases", () => {
  it("maxSelfRebases: 0 freezes even a satisfied predicate", async () => {
    const spec = await buildSpec(BASE_CONTENT)
    const harness = createHarness(spec)
    const foreignBlob = await createForeignBlob(
      harness,
      '{\n  "title": "iris",\n  "note": "f"\n}\n',
    )
    const foreign = await createForeignCommit(harness, [{ path: IRIS_PATH, sha: foreignBlob }], {
      updateRef: false,
    })
    const coordinator = createSaveCoordinator({
      backend: backendWithRefMoveAtPatch(harness, spec.defaultBranch, foreign.commitSha),
      branch: spec.defaultBranch,
      drafts: memoryDrafts(),
      maxSelfRebases: 0,
    })

    const verdict = await coordinator.save(siteRequest("site", spec.headSha, { title: "ours" }))

    expect(verdict.kind).toBe("conflict")
    if (verdict.kind !== "conflict") return
    expect(verdict.details.currentHeadSha).toBe(foreign.commitSha)
    expect(verdict.details.merge).toBeUndefined() // satisfied predicate: no merge preview ran
    expect(successfulRefUpdates(harness.server)).toBe(0)
  })
})

describe("P2.5 coordinator — degraded adjudication yields honest conflicts", () => {
  it("a failed challenge read freezes with an EMPTY head (no invented truth)", async () => {
    const spec = await buildSpec(BASE_CONTENT)
    const harness = createHarness(spec)
    const foreignBlob = await createForeignBlob(
      harness,
      '{\n  "title": "iris",\n  "note": "f"\n}\n',
    )
    const foreign = await createForeignCommit(harness, [{ path: IRIS_PATH, sha: foreignBlob }], {
      updateRef: false,
    })
    const inner = harness.fetch
    let refReads = 0
    const fetch: FetchLike = async (url, init) => {
      const method = (init?.method ?? "GET").toUpperCase()
      if (method === "GET" && String(url).includes("/git/ref/heads/")) {
        refReads += 1
        if (refReads === 2) {
          // The post-CAS re-probe dies — the conflict stays honest-and-empty.
          return {
            ok: false,
            status: 500,
            statusText: "FAULT",
            headers: { get: () => null },
            json: async () => ({}),
            text: async () => "{}",
          }
        }
      }
      if (method === "PATCH" && String(url).includes("/git/refs/heads/") && refReads < 2) {
        harness.server.setRef(spec.defaultBranch, foreign.commitSha)
      }
      return inner(url, init)
    }
    const coordinator = createSaveCoordinator({
      backend: backendOf(harness, fetch),
      branch: spec.defaultBranch,
      drafts: memoryDrafts(),
    })

    const verdict = await coordinator.save(siteRequest("site", spec.headSha, { title: "ours" }))

    expect(verdict.kind).toBe("conflict")
    if (verdict.kind !== "conflict") return
    expect(verdict.details.currentHeadSha).toBe("")
    expect(verdict.details.merge).toBeUndefined()
    expect(verdict.details.verdicts).toBeUndefined()
  })

  it("a throwing challenge tree read freezes conservatively (never crashes)", async () => {
    const spec = await buildSpec(BASE_CONTENT)
    const harness = createHarness(spec)
    const foreignBlob = await createForeignBlob(
      harness,
      '{\n  "title": "iris",\n  "note": "f"\n}\n',
    )
    const foreign = await createForeignCommit(harness, [{ path: IRIS_PATH, sha: foreignBlob }], {
      updateRef: false,
    })
    const moving = backendWithRefMoveAtPatch(harness, spec.defaultBranch, foreign.commitSha)
    let treeReads = 0
    const backend: GitBackend = {
      capabilities: moving.capabilities,
      getRef: (branch) => moving.getRef(branch),
      readTree: (branch, sha, options) => {
        treeReads += 1
        if (treeReads >= 2) throw new Error("challenge machinery exploded")
        return moving.readTree(branch, sha, options)
      },
      readFile: (branch, path, sha, options) => moving.readFile(branch, path, sha, options),
      readBlob: (sha) => moving.readBlob(sha),
      listChangedFiles: (branch, baseSha, headSha) =>
        moving.listChangedFiles(branch, baseSha, headSha),
      commitChanges: (changes, baseHeadSha, branch, options) =>
        moving.commitChanges(changes, baseHeadSha, branch, options),
      readCheckRuns: (branch, sha) => moving.readCheckRuns(branch, sha),
      readCommitStatuses: (branch, sha) => moving.readCommitStatuses(branch, sha),
    }
    const coordinator = createSaveCoordinator({
      backend,
      branch: spec.defaultBranch,
      drafts: memoryDrafts(),
    })

    const verdict = await coordinator.save(siteRequest("site", spec.headSha, { title: "ours" }))

    expect(verdict.kind).toBe("conflict")
    if (verdict.kind !== "conflict") return
    expect(verdict.details.currentHeadSha).toBe(foreign.commitSha)
    expect(verdict.details.merge).toBeUndefined()
    expect(verdict.details.verdicts).toBeUndefined()
    expect(treeReads).toBeGreaterThanOrEqual(1)
  })

  it("an unserializable form value skips the merge preview (conflict, no crash)", async () => {
    const spec = await buildSpec(BASE_CONTENT)
    const harness = createHarness(spec)
    const foreignRaw = '{\n  "title": "site",\n  "description": "kept"\n}\n'
    const foreignBlob = await createForeignBlob(harness, foreignRaw)
    const foreign = await createForeignCommit(harness, [{ path: SITE_PATH, sha: foreignBlob }], {
      updateRef: false,
    })
    const circular: Record<string, unknown> = { title: "v2" }
    circular.self = circular
    const coordinator = createSaveCoordinator({
      backend: backendWithRefMoveAtPatch(harness, spec.defaultBranch, foreign.commitSha),
      branch: spec.defaultBranch,
      drafts: memoryDrafts(),
    })
    const request: SaveRequest = {
      draftKey: "site",
      changes: { updates: [{ path: SITE_PATH, bytes: encodeUtf8('{\n  "title": "v2"\n}\n') }] },
      baseSha: spec.headSha,
      draft: {
        filePath: SITE_PATH,
        baseSha: spec.headSha,
        baseRaw: SITE_BASE_RAW,
        formValue: circular,
      },
    }

    const verdict = await coordinator.save(request)

    expect(verdict.kind).toBe("conflict")
    if (verdict.kind !== "conflict") return
    expect(verdict.details.merge).toBeUndefined()
  })
})

describe("P2.5 coordinator — backoff and manual parks (retryable failures)", () => {
  it("a retryable failure retries on the schedule, then publishes", async () => {
    const spec = await buildSpec(BASE_CONTENT)
    // THREE blob failures exhaust the driver's rebuild budget (maxRebuilds 2
    // → 3 attempts) so the driver returns failed(UNKNOWN) — retryable at the
    // CONTROLLER level, which parks-and-wakes instead of tight-looping.
    const harness = createHarness(spec, {
      chaos: { faults: [{ method: "POST", pathPattern: /^\/git\/blobs$/, times: 3, status: 500 }] },
    })
    const wakes: Array<{ waitMs: number; wake: () => void }> = []
    const coordinator = createSaveCoordinator({
      backend: harness.backend,
      branch: spec.defaultBranch,
      drafts: memoryDrafts(),
      retryDelaysMs: [1, 1],
      scheduleWake: (waitMs, wake) => wakes.push({ waitMs, wake }),
    })
    const request: SaveRequest = {
      draftKey: "site",
      changes: { updates: [{ path: SITE_PATH, bytes: encodeUtf8('{\n  "title": "v2"\n}\n') }] },
      baseSha: spec.headSha,
    }

    const pending = coordinator.save(request)
    await settle()
    expect(wakes).toHaveLength(1)
    expect(wakes[0]?.waitMs).toBe(1)
    wakes[0]?.wake()
    const verdict = await pending

    expect(verdict.kind).toBe("published")
    // Chaos faults resolve BEFORE the fake server — only the successful
    // attempt reaches it; the three faulted blob attempts are invisible here.
    const blobPosts = harness.server.log.filter(
      (event) => event.method === "POST" && event.path === "/git/blobs",
    )
    expect(blobPosts).toHaveLength(1)
    expect(coordinator.state("site")?.phase).toBe("published")
  })

  it("the backoff cap parks for MANUAL resume; resume() completes the save", async () => {
    const spec = await buildSpec(BASE_CONTENT)
    const harness = createHarness(spec, {
      chaos: { faults: [{ method: "POST", pathPattern: /^\/git\/blobs$/, times: 3, status: 500 }] },
    })
    const coordinator = createSaveCoordinator({
      backend: harness.backend,
      branch: spec.defaultBranch,
      drafts: memoryDrafts(),
      retryDelaysMs: [], // zero budget → park immediately
    })
    const request: SaveRequest = {
      draftKey: "site",
      changes: { updates: [{ path: SITE_PATH, bytes: encodeUtf8('{\n  "title": "v2"\n}\n') }] },
      baseSha: spec.headSha,
    }

    const pending = coordinator.save(request)
    await settle()
    const state = coordinator.state("site")
    expect(state?.phase).toBe("paused")
    expect(state !== undefined && state.phase === "paused" && state.reason).toBe("network")
    coordinator.resume("site")
    const verdict = await pending
    expect(verdict.kind).toBe("published")
    // Faulted attempts never reach the fake server (chaos resolves first).
    const blobPosts = harness.server.log.filter(
      (event) => event.method === "POST" && event.path === "/git/blobs",
    )
    expect(blobPosts).toHaveLength(1)
  })

  it("resume/resumeAuth guards are safe no-ops outside their windows", () => {
    const coordinator = createSaveCoordinator({
      backend: dummyBackend(),
      branch: "main",
      drafts: memoryDrafts(),
    })
    expect(() => coordinator.resume("nope")).not.toThrow()
    expect(() => coordinator.resumeAuth()).not.toThrow()
    expect(coordinator.authPaused).toBe(false)
  })
})

describe("P2.5 coordinator — subscription + default wake", () => {
  it("subscribers see state snapshots; unsubscribe stops them", async () => {
    const spec = await buildSpec(BASE_CONTENT)
    const harness = createHarness(spec)
    const coordinator = createSaveCoordinator({
      backend: harness.backend,
      branch: spec.defaultBranch,
      drafts: memoryDrafts(),
    })
    const snapshots: Array<number> = []
    const unsubscribe = coordinator.subscribe((snapshot) => {
      snapshots.push(snapshot.states.size)
    })

    const verdict = await coordinator.save(siteRequest("site", spec.headSha, { title: "v2" }))
    expect(verdict.kind).toBe("published")
    expect(snapshots.length).toBeGreaterThan(0)

    unsubscribe()
    const before = snapshots.length
    // A noop save still transitions internally — but the listener is gone.
    await coordinator.save({
      draftKey: "site",
      changes: { updates: [{ path: SITE_PATH, bytes: encodeUtf8(SITE_BASE_RAW) }] },
      baseSha: spec.headSha,
    })
    expect(snapshots.length).toBe(before)
  })

  it("a rate park with the DEFAULT scheduler wakes on the real timer", async () => {
    const spec = await buildSpec(BASE_CONTENT)
    const harness = createHarness(spec)
    const inner = harness.fetch
    let refReads = 0
    const fetch: FetchLike = async (url, init) => {
      const method = (init?.method ?? "GET").toUpperCase()
      if (method === "GET" && String(url).includes("/git/ref/heads/") && refReads === 0) {
        refReads += 1
        return {
          ok: false,
          status: 429,
          statusText: "FAULT",
          headers: { get: (name: string) => (name === "retry-after" ? "0.01" : null) },
          json: async () => ({}),
          text: async () => "{}",
        }
      }
      return inner(url, init)
    }
    const coordinator = createSaveCoordinator({
      backend: backendOf(harness, fetch),
      branch: spec.defaultBranch,
      drafts: memoryDrafts(),
      // scheduleWake deliberately NOT injected — the default timer runs.
    })

    const verdict = await coordinator.save(siteRequest("site", spec.headSha, { title: "v2" }))
    expect(verdict.kind).toBe("published")
  })

  it("a wake arriving BETWEEN waits is coalesced, not lost", async () => {
    const spec = await buildSpec(BASE_CONTENT)
    const harness = createHarness(spec)
    const inner = harness.fetch
    let refReads = 0
    const fetch: FetchLike = async (url, init) => {
      const method = (init?.method ?? "GET").toUpperCase()
      if (method === "GET" && String(url).includes("/git/ref/heads/") && refReads < 2) {
        refReads += 1
        return {
          ok: false,
          status: 429,
          statusText: "FAULT",
          headers: { get: (name: string) => (name === "retry-after" ? "0.01" : null) },
          json: async () => ({}),
          text: async () => "{}",
        }
      }
      return inner(url, init)
    }
    const wakes: Array<{ waitMs: number; wake: () => void }> = []
    const coordinator = createSaveCoordinator({
      backend: backendOf(harness, fetch),
      branch: spec.defaultBranch,
      drafts: memoryDrafts(),
      scheduleWake: (waitMs, wake) => wakes.push({ waitMs, wake }),
    })

    const pending = coordinator.save(siteRequest("site", spec.headSha, { title: "v2" }))
    await settle()
    expect(wakes).toHaveLength(1) // park #1
    // Two synchronous wakes: the first releases the waiter, the second lands
    // BETWEEN waits (coalesced as `pending`) — consumed by the next wait.
    wakes[0]?.wake()
    wakes[0]?.wake()
    const verdict = await pending

    expect(verdict.kind).toBe("published")
    expect(wakes).toHaveLength(2) // park #2 scheduled, its wake never needed
    expect(refReads).toBe(2)
  })
})

describe("P2.5 coordinator — drop-ack races through the controller", () => {
  it("a lost ref ack + foreign site edit freezes with the merge preview", async () => {
    const spec = await buildSpec(BASE_CONTENT)
    const harness = createHarness(spec, {
      chaos: { dropAcks: [{ method: "PATCH", pathPattern: /^\/git\/refs\/heads\// }] },
    })
    const inner = harness.fetch
    let droppedHandled = false
    const fetch: FetchLike = async (url, init) => {
      const method = (init?.method ?? "GET").toUpperCase()
      if (method === "PATCH" && String(url).includes("/git/refs/heads/") && !droppedHandled) {
        droppedHandled = true
        try {
          return await inner(url, init) // mutation lands; the chaos drop throws
        } catch (error) {
          // A foreign commit lands on top of ours before the recovery probe.
          await foreignPushOnHead(harness, spec.defaultBranch, [
            [SITE_PATH, '{\n  "title": "foreign title"\n}\n'],
          ])
          throw error
        }
      }
      return inner(url, init)
    }
    const drafts = memoryDrafts()
    const coordinator = createSaveCoordinator({
      backend: backendOf(harness, fetch),
      branch: spec.defaultBranch,
      drafts,
    })

    const verdict = await coordinator.save(siteRequest("site", spec.headSha, { title: "v2" }))

    expect(verdict.kind).toBe("conflict")
    if (verdict.kind !== "conflict") return
    expect(verdict.details.merge).toBeDefined()
    expect(verdict.details.merge?.frozenFieldPaths.length).toBe(1)
    expect(await drafts.get("site")).toBeDefined()
    expect(harness.server.commitCount()).toBe(3) // seed + ours (acked-mutated) + foreign
  })

  it("a lost ref ack + foreign RE-ADD of our deleted file re-applies the delete", async () => {
    const spec = await buildSpec(BASE_CONTENT)
    const harness = createHarness(spec, {
      chaos: { dropAcks: [{ method: "PATCH", pathPattern: /^\/git\/refs\/heads\// }] },
    })
    const inner = harness.fetch
    let droppedHandled = false
    const fetch: FetchLike = async (url, init) => {
      const method = (init?.method ?? "GET").toUpperCase()
      if (method === "PATCH" && String(url).includes("/git/refs/heads/") && !droppedHandled) {
        droppedHandled = true
        try {
          return await inner(url, init)
        } catch (error) {
          // Foreign restores the file we are deleting (identical bytes).
          await foreignPushOnHead(harness, spec.defaultBranch, [
            [IRIS_PATH, '{\n  "title": "iris"\n}\n'],
          ])
          throw error
        }
      }
      return inner(url, init)
    }
    const coordinator = createSaveCoordinator({
      backend: backendOf(harness, fetch),
      branch: spec.defaultBranch,
      drafts: memoryDrafts(),
    })

    const verdict = await coordinator.save({
      draftKey: "site",
      changes: { deletes: [IRIS_PATH] },
      baseSha: spec.headSha,
    })

    expect(verdict.kind).toBe("published")
    // The re-apply: our delete landed ON TOP of the foreign re-add — final
    // tree has no iris; site untouched.
    expect(harness.server.contents(spec.defaultBranch, IRIS_PATH)).toBeUndefined()
    expect(harness.server.commitCount()).toBe(4) // seed + ours + foreign re-add + ours-2
  })
})

function memoryDrafts(): DraftStore {
  const store = new Map<string, DraftRecord>()
  return {
    async get<T>(key: string): Promise<DraftRecord<T> | undefined> {
      return store.get(key) as DraftRecord<T> | undefined
    },
    async put<T>(record: DraftRecord<T>): Promise<void> {
      store.set(record.key, record as DraftRecord)
    },
    async delete(key: string): Promise<void> {
      store.delete(key)
    },
    async deletePrefix(prefix: string): Promise<void> {
      for (const k of store.keys()) {
        if (k.startsWith(prefix)) store.delete(k)
      }
    },
    async list(): Promise<readonly DraftRecord[]> {
      return [...store.values()]
    },
  }
}

function dummyBackend(): GitBackend {
  return {
    capabilities: { commitStatus: true, branches: true },
    getRef: async () => ({ ref: "refs/heads/main", object: { sha: "a", type: "commit" } }),
    readTree: async () => ({ kind: "tree", tree: { sha: "t", truncated: false, entries: [] } }),
    readFile: async () => ({
      kind: "file",
      file: { path: "p", sha: "s", bytes: new Uint8Array(), size: 0 },
    }),
    readBlob: async () => new Uint8Array(),
    listChangedFiles: async () => new Map(),
    commitChanges: async () => ({ commitSha: "c", treeSha: "t" }),
    readCheckRuns: async () => ({ kind: "ok", totalCount: 0, runs: [] }),
    readCommitStatuses: async () => ({ kind: "ok", statuses: [] }),
  }
}
