/// <reference types="node" />
import { describe, expect, it } from "vitest"
import { GithubBackend } from "../../backends/github"
import type { FetchLike } from "../../composition"
import type { DraftRecord, DraftStore } from "../../drafts"
import { encodeUtf8 } from "../../safety/encoding"
import { createSaveCoordinator, type SaveRequest } from "../save-controller"
import { BASE_CONTENT, buildSpec, createHarness } from "./fake-github-fetch"

/**
 * INV-P11 — draft-before-network + parked transactions (ADR-0004 C.3 pins):
 *  - the draft EXISTS in the store BEFORE the save's first network call;
 *  - a draft-store write failure refuses the save with ZERO requests;
 *  - RATE_LIMIT with a window → paused(quota, countdown) + ONE scheduled wake
 *    (event-driven, INV-N01) — never a tight loop;
 *  - RATE_LIMIT without guidance → paused, MANUAL resume is the only way;
 *  - AUTH_EXPIRED freezes the drain; new saves refuse pre-network; drafts are
 *    retained (ADR-0002 orthogonality); resumeAuth() completes the drain;
 *  - the draft is deleted ONLY after the ref is observed carrying the commit
 *    (or a noop verdict); conflict/failed/paused retain it verbatim.
 */

const SITE_PATH = "src/content/site.json"

/** Draft store that records every operation into the shared sequence. */
function recordingDrafts(events: string[]): DraftStore {
  const store = new Map<string, DraftRecord>()
  return {
    async get<T>(key: string): Promise<DraftRecord<T> | undefined> {
      events.push(`draft:get:${key}`)
      return store.get(key) as DraftRecord<T> | undefined
    },
    async put<T>(record: DraftRecord<T>): Promise<void> {
      events.push(`draft:put:${record.key}`)
      store.set(record.key, record as DraftRecord)
    },
    async delete(key: string): Promise<void> {
      events.push(`draft:delete:${key}`)
      store.delete(key)
    },
    async list(): Promise<readonly DraftRecord[]> {
      return [...store.values()]
    },
  }
}

interface RecordedBackend {
  readonly backend: GithubBackend
  readonly server: ReturnType<typeof createHarness>["server"]
}

/** Harness whose fetch records `net:METHOD path` into the shared sequence. */
function recordedHarness(
  spec: Awaited<ReturnType<typeof buildSpec>>,
  events: string[],
): RecordedBackend {
  const harness = createHarness(spec)
  const inner = harness.fetch
  const fetch: FetchLike = async (url, init) => {
    const method = (init?.method ?? "GET").toUpperCase()
    const path = String(url).replace(/^https:\/\/unit\.test\/repos\/[^/]+\/[^/]+/, "")
    events.push(`net:${method} ${path}`)
    return inner(url, init)
  }
  const backend = new GithubBackend({
    owner: "fixture-owner",
    repo: "fixture-repo",
    token: "t",
    fetch,
    baseUrl: "https://unit.test",
  })
  return { backend, server: harness.server }
}

/** Backend whose FIRST branch-ref read answers the given status + headers. */
async function firstRefFaultBackend(
  spec: Awaited<ReturnType<typeof buildSpec>>,
  status: number,
  headers: Readonly<Record<string, string>>,
  events: string[] = [],
): Promise<{ readonly backend: GithubBackend; readonly server: RecordedBackend["server"] }> {
  const harness = createHarness(spec)
  const inner = harness.fetch
  let refReads = 0
  const fetch: FetchLike = async (url, init) => {
    const method = (init?.method ?? "GET").toUpperCase()
    if (method === "GET" && String(url).includes("/git/ref/heads/") && refReads === 0) {
      refReads += 1
      if (events.length >= 0) events.push(`net:${method} /git/ref/heads/${spec.defaultBranch}`)
      return {
        ok: false,
        status,
        statusText: "FAULT",
        headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
        json: async () => ({ message: "fixture fault" }),
        text: async () => '{"message":"fixture fault"}',
      }
    }
    if (events.length >= 0) {
      events.push(
        `net:${method} ${String(url).replace(/^https:\/\/unit\.test\/repos\/[^/]+\/[^/]+/, "")}`,
      )
    }
    return inner(url, init)
  }
  const backend = new GithubBackend({
    owner: "fixture-owner",
    repo: "fixture-repo",
    token: "t",
    fetch,
    baseUrl: "https://unit.test",
  })
  return { backend, server: harness.server }
}

function requestOf(draftKey: string, baseSha: string): SaveRequest {
  return {
    draftKey,
    changes: {
      updates: [{ path: SITE_PATH, bytes: encodeUtf8('{\n  "title": "site — parked-tx"\n}\n') }],
    },
    baseSha,
    draft: {
      filePath: SITE_PATH,
      baseSha,
      baseRaw: '{\n  "title": "site"\n}\n',
      formValue: { title: "site — parked-tx" },
    },
  }
}

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 10))

describe("INV-P11 — the draft exists before the save's first network call", () => {
  it("orders draft put → ref read, and deletes the draft only after publish", async () => {
    const spec = await buildSpec(BASE_CONTENT)
    const events: string[] = []
    const { backend } = recordedHarness(spec, events)
    const coordinator = createSaveCoordinator({
      backend,
      branch: spec.defaultBranch,
      drafts: recordingDrafts(events),
    })

    const verdict = await coordinator.save(requestOf("site", spec.headSha))
    expect(verdict.kind).toBe("published")

    const putAt = events.indexOf("draft:put:site")
    const firstNetwork = events.findIndex((event) => event.startsWith("net:"))
    expect(putAt).toBeGreaterThanOrEqual(0)
    expect(firstNetwork).toBeGreaterThan(putAt) // draft FIRST, network second
    expect(events).toContain("draft:delete:site")
    // Deletion is terminal-side: nothing network-side follows the delete.
    const deleteAt = events.indexOf("draft:delete:site")
    expect(events.slice(deleteAt + 1).every((event) => !event.startsWith("net:"))).toBe(true)
  })

  it("a draft-store write failure refuses the save with ZERO network requests", async () => {
    const spec = await buildSpec(BASE_CONTENT)
    const events: string[] = []
    const { backend } = recordedHarness(spec, events)
    const failing: DraftStore = {
      async get() {
        return undefined
      },
      async put() {
        events.push("draft:put:BOOM")
        throw new Error("quota exceeded (fake IDB failure)")
      },
      async delete() {
        events.push("draft:delete")
      },
      async list() {
        return []
      },
    }
    const coordinator = createSaveCoordinator({
      backend,
      branch: spec.defaultBranch,
      drafts: failing,
    })

    const verdict = await coordinator.save(requestOf("site", spec.headSha))
    expect(verdict.kind).toBe("failed")
    expect(events).toEqual(["draft:put:BOOM"]) // the refusal path, nothing else
  })
})

describe("INV-P11/N01 — rate parks are event-driven, never tight-looped", () => {
  it("parks with the parsed countdown, schedules ONE wake, then publishes", async () => {
    const spec = await buildSpec(BASE_CONTENT)
    const events: string[] = []
    const { backend } = await firstRefFaultBackend(
      spec,
      403,
      {
        "retry-after": "0.12",
        "x-ratelimit-remaining": "0",
      },
      events,
    )
    const drafts = recordingDrafts(events)
    const wakes: Array<{ waitMs: number; wake: () => void }> = []
    const coordinator = createSaveCoordinator({
      backend,
      branch: spec.defaultBranch,
      drafts,
      // Capture the scheduled wake instead of running a real timer.
      scheduleWake: (waitMs, wake) => wakes.push({ waitMs, wake }),
    })

    const pending = coordinator.save(requestOf("site", spec.headSha))
    await settle() // park is a microtask chain away
    expect(wakes).toHaveLength(1) // exactly ONE scheduled wake (INV-N01)
    expect(wakes[0]?.waitMs).toBe(120) // Retry-After parsed verbatim → countdown
    const state = coordinator.state("site")
    expect(state?.phase).toBe("paused")
    expect(state !== undefined && state.phase === "paused" && state.reason).toBe("quota")
    // The draft SURVIVES the park (retained verbatim for kill-tab resume).
    expect(await drafts.get("site")).toBeDefined()

    // The window elapsed → the scheduled wake fires → the drain completes.
    wakes[0]?.wake()
    const verdict = await pending
    expect(verdict.kind).toBe("published")
    expect(await drafts.get("site")).toBeUndefined() // deleted post-verify only
    // The park happened on the FIRST ref read; the retry re-read it.
    const refReads = events.filter((event) => event.startsWith("net:GET /git/ref/heads/"))
    expect(refReads.length).toBeGreaterThanOrEqual(2)
  })

  it("RATE_LIMIT without usable guidance parks for MANUAL resume (no timer, no tight loop)", async () => {
    const spec = await buildSpec(BASE_CONTENT)
    const { backend } = await firstRefFaultBackend(spec, 429, {})
    const wakes: Array<{ waitMs: number; wake: () => void }> = []
    const coordinator = createSaveCoordinator({
      backend,
      branch: spec.defaultBranch,
      drafts: recordingDrafts([]),
      scheduleWake: (waitMs, wake) => wakes.push({ waitMs, wake }),
    })

    const pending = coordinator.save(requestOf("site", spec.headSha))
    await settle()
    // No guidance ⇒ NO scheduled wake (a null countdown must never tight-loop).
    expect(wakes).toHaveLength(0)
    expect(coordinator.state("site")?.phase).toBe("paused")
    // Manual resume is the ONLY way forward.
    coordinator.resume("site")
    const verdict = await pending
    expect(verdict.kind).toBe("published")
  })
})

describe("INV-A01/A03 — the auth pause freezes the drain; drafts retained", () => {
  it("401 parks (auth), new saves refuse pre-network, resumeAuth completes the drain", async () => {
    const spec = await buildSpec(BASE_CONTENT)
    const { backend, server } = await firstRefFaultBackend(spec, 401, {})
    const drafts = recordingDrafts([])
    const coordinator = createSaveCoordinator({
      backend,
      branch: spec.defaultBranch,
      drafts,
    })

    const pending = coordinator.save(requestOf("site", spec.headSha))
    await settle()
    expect(coordinator.authPaused).toBe(true)
    expect(coordinator.state("site")?.phase).toBe("paused")
    // The draft is RETAINED through the pause (founder's words survive).
    expect(await drafts.get("site")).toBeDefined()

    // A NEW save inside the pause refuses BEFORE any network — the request
    // count does not move.
    const requestsAtPause = server.log.length
    const refused = await coordinator.save(requestOf("site-2", spec.headSha))
    expect(refused.kind).toBe("failed")
    expect(refused.kind === "failed" && refused.error.code).toBe("AUTH_EXPIRED")
    expect(server.log.length).toBe(requestsAtPause)

    // The admin re-probes (token valid again — the fault fired once) and
    // clears the pause; the frozen drain completes and the draft dies.
    coordinator.resumeAuth()
    const verdict = await pending
    expect(verdict.kind).toBe("published")
    expect(coordinator.authPaused).toBe(false)
    expect(await drafts.get("site")).toBeUndefined()
  })
})

describe("draft retention across terminal non-publish verdicts", () => {
  it("a failed save retains the draft (kill-tab can resume it)", async () => {
    const spec = await buildSpec(BASE_CONTENT)
    const harness = createHarness(spec, {
      chaos: {
        faults: [{ method: "POST", pathPattern: /^\/git\/blobs$/, times: 99, status: 422 }],
      },
    })
    const drafts = recordingDrafts([])
    const coordinator = createSaveCoordinator({
      backend: harness.backend,
      branch: spec.defaultBranch,
      drafts,
      retryDelaysMs: [1, 1],
    })

    const verdict = await coordinator.save(requestOf("site", spec.headSha))
    expect(verdict.kind).toBe("failed")
    expect(await drafts.get("site")).toBeDefined()
    expect(harness.server.log.some((event) => event.method === "PATCH")).toBe(false)
  })

  it("a noop save deletes the draft (content already live — nothing to resume)", async () => {
    const spec = await buildSpec(BASE_CONTENT)
    const harness = createHarness(spec)
    const drafts = recordingDrafts([])
    const coordinator = createSaveCoordinator({
      backend: harness.backend,
      branch: spec.defaultBranch,
      drafts,
    })
    // Writing the UNCHANGED bytes → zero-diff gate → noop verdict.
    const noopRequest: SaveRequest = {
      draftKey: "site",
      changes: {
        updates: [{ path: SITE_PATH, bytes: encodeUtf8('{\n  "title": "site"\n}\n') }],
      },
      baseSha: spec.headSha,
      draft: {
        filePath: SITE_PATH,
        baseSha: spec.headSha,
        baseRaw: '{\n  "title": "site"\n}\n',
        formValue: { title: "site" },
      },
    }
    const verdict = await coordinator.save(noopRequest)
    expect(verdict.kind).toBe("noop")
    expect(await drafts.get("site")).toBeUndefined()
    expect(harness.server.log.some((event) => event.method === "PATCH")).toBe(false)
  })
})
