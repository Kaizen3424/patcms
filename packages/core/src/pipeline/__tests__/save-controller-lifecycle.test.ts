import { describe, expect, it } from "vitest"
import { GithubBackend } from "../../backends/github"
import type { FetchLike } from "../../composition"
import type { DraftRecord, DraftStore } from "../../drafts"
import { decodeUtf8, encodeUtf8 } from "../../safety/encoding"
import type { JsonValue } from "../../safety/untrusted-json"
import { canonicalJson } from "../../serialization/document"
import { createSaveCoordinator, SaveInFlightError, type SaveRequest } from "../save-controller"
import { BASE_CONTENT, buildSpec, createHarness, type FakeGithubHarness } from "./fake-github-fetch"

/**
 * P2.6 — coordinator lifecycle the editor depends on (ADR-0004 appendix):
 *  - `reset` is the ONLY way back to `editing`; without it a second save would
 *    submit from `published` (a no-op) and the bar would stick on "Saved";
 *  - a duplicate `save()` for a live draftKey REJECTS instead of overwriting
 *    the job registration (permanent-deadlock class);
 *  - `cancel` settles an abandoned non-committing job honestly, keeps the
 *    draft, and leaves the entry saveable;
 *  - `reset` never lies about an in-flight write (`committing` is protected).
 */

const SITE_PATH = "src/content/site.json"
const SITE_BASE_RAW = '{\n  "title": "site"\n}\n'
const KEY = "site"
const OWNER = "fixture-owner"
const REPO = "fixture-repo"
const BASE_URL = "https://unit.test"

function request(baseSha: string, formValue: Record<string, unknown>): SaveRequest {
  return {
    draftKey: KEY,
    changes: {
      updates: [{ path: SITE_PATH, bytes: encodeUtf8(canonicalJson(formValue as JsonValue)) }],
    },
    baseSha,
    draft: { filePath: SITE_PATH, baseSha, baseRaw: SITE_BASE_RAW, formValue },
  }
}

function memoryDrafts(): DraftStore & { readonly size: () => number } {
  const store = new Map<string, DraftRecord>()
  return {
    size: () => store.size,
    async get<T>(key: string): Promise<DraftRecord<T> | undefined> {
      return store.get(key) as DraftRecord<T> | undefined
    },
    async put<T>(record: DraftRecord<T>): Promise<void> {
      store.set(record.key, record as DraftRecord)
    },
    async delete(key: string): Promise<void> {
      store.delete(key)
    },
    async list(): Promise<readonly DraftRecord[]> {
      return [...store.values()]
    },
  }
}

function backendOf(fetch: FetchLike): GithubBackend {
  return new GithubBackend({ owner: OWNER, repo: REPO, token: "t", fetch, baseUrl: BASE_URL })
}

/** First ref GET answers 429 + Retry-After, then the real transport. */
function rateLimitedFirstRef(harness: FakeGithubHarness): FetchLike {
  let faulted = false
  return async (url, init) => {
    const method = (init?.method ?? "GET").toUpperCase()
    if (!faulted && method === "GET" && String(url).includes("/git/ref/heads/")) {
      faulted = true
      return {
        ok: false,
        status: 429,
        statusText: "TOO MANY REQUESTS",
        headers: { get: (name: string) => (name.toLowerCase() === "retry-after" ? "60" : null) },
        json: async () => ({}),
        text: async () => "{}",
      }
    }
    return harness.fetch(url, init)
  }
}

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 15))

describe("P2.6 coordinator lifecycle — the save cycle can repeat", () => {
  it("published → reset → dirty → a SECOND save publishes", async () => {
    const spec = await buildSpec(BASE_CONTENT)
    const harness = createHarness(spec)
    const coordinator = createSaveCoordinator({
      backend: harness.backend,
      branch: spec.defaultBranch,
      drafts: memoryDrafts(),
    })

    coordinator.reset(KEY, spec.headSha)
    expect(coordinator.state(KEY)).toEqual({ phase: "editing", baseSha: spec.headSha })

    const first = await coordinator.save(request(spec.headSha, { title: "v2" }))
    expect(first.kind).toBe("published")
    expect(coordinator.state(KEY)?.phase).toBe("published")
    const firstSha = first.kind === "published" ? first.commitSha : ""

    coordinator.reset(KEY, firstSha)
    coordinator.markDirty(KEY, firstSha)
    expect(coordinator.state(KEY)?.phase).toBe("dirty")

    const second = await coordinator.save(request(firstSha, { title: "v3" }))
    expect(second.kind).toBe("published")
    expect(harness.server.commitCount()).toBe(3) // seed + v2 + v3
    const saved = harness.server.contents(spec.defaultBranch, SITE_PATH)
    expect(saved === undefined ? "" : decodeUtf8(saved.bytes)).toBe(
      canonicalJson({ title: "v3" } as JsonValue),
    )
  })

  it("rejects a duplicate save for the same draftKey instead of stranding the first", async () => {
    const spec = await buildSpec(BASE_CONTENT)
    const harness = createHarness(spec)
    const coordinator = createSaveCoordinator({
      backend: backendOf(rateLimitedFirstRef(harness)),
      branch: spec.defaultBranch,
      drafts: memoryDrafts(),
      // Never wakes on its own: the job stays parked until resume().
      scheduleWake: () => undefined,
    })

    const first = coordinator.save(request(spec.headSha, { title: "v2" }))
    await settle()
    expect(coordinator.state(KEY)?.phase).toBe("paused")

    await expect(coordinator.save(request(spec.headSha, { title: "v2" }))).rejects.toBeInstanceOf(
      SaveInFlightError,
    )

    coordinator.resume(KEY)
    const verdict = await first
    expect(verdict.kind).toBe("published")
    expect(coordinator.state(KEY)?.phase).toBe("published")
  })

  it("cancel settles an abandoned parked save, keeps the draft, and re-enables saving", async () => {
    const spec = await buildSpec(BASE_CONTENT)
    const harness = createHarness(spec)
    const drafts = memoryDrafts()
    const coordinator = createSaveCoordinator({
      backend: backendOf(rateLimitedFirstRef(harness)),
      branch: spec.defaultBranch,
      drafts,
      scheduleWake: () => undefined,
    })

    const pending = coordinator.save(request(spec.headSha, { title: "v2" }))
    await settle()
    expect(coordinator.state(KEY)?.phase).toBe("paused")

    coordinator.cancel(KEY)
    await expect(pending).resolves.toEqual({ kind: "cancelled" })
    expect(coordinator.state(KEY)).toEqual({ phase: "editing", baseSha: spec.headSha })
    expect(drafts.size()).toBe(1) // the crash-safety record survives

    coordinator.markDirty(KEY, spec.headSha)
    const retry = await coordinator.save(request(spec.headSha, { title: "v2" }))
    expect(retry.kind).toBe("published")
    expect(drafts.size()).toBe(0) // deleted only after the ref carries it
  })

  it("reset is a no-op while a write is genuinely committing", async () => {
    const spec = await buildSpec(BASE_CONTENT)
    const harness = createHarness(spec)
    let release: (() => void) | undefined
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    let firstRef = true
    const fetch: FetchLike = async (url, init) => {
      const method = (init?.method ?? "GET").toUpperCase()
      if (firstRef && method === "GET" && String(url).includes("/git/ref/heads/")) {
        firstRef = false
        await held
      }
      return harness.fetch(url, init)
    }
    const coordinator = createSaveCoordinator({
      backend: backendOf(fetch),
      branch: spec.defaultBranch,
      drafts: memoryDrafts(),
    })

    const pending = coordinator.save(request(spec.headSha, { title: "v2" }))
    await settle()
    expect(coordinator.state(KEY)?.phase).toBe("committing")

    coordinator.reset(KEY, "f".repeat(40))
    expect(coordinator.state(KEY)?.phase).toBe("committing")

    release?.()
    const verdict = await pending
    expect(verdict.kind).toBe("published")
  })
})
