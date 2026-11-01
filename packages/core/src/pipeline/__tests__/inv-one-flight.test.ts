/// <reference types="node" />
import { describe, expect, it } from "vitest"
import {
  BASE_CONTENT,
  buildSpec,
  createHarness,
  successfulRefUpdates,
} from "../../__tests__/support/fake-github-fetch"
import type { DraftRecord, DraftStore } from "../../drafts"
import { encodeUtf8 } from "../../safety/encoding"
import { createSaveCoordinator, type SaveRequest } from "../save-controller"

/**
 * INV-P04 — one-flight queue (ADR-0004 C.3 pins): overlapping saves for a
 * repo+branch drain FIFO; each drained save funnels through exactly ONE
 * `updateRef`; the NEXT save's fresh `getRef` (inside runSave) re-bases it on
 * its predecessor's commit, so a queued save NEVER false-conflicts against
 * the save that preceded it (the 422 non-FF from a stale parent is the
 * observable failure this invariant forbids).
 */

const EDIT_TITLE = {
  updates: [
    {
      path: "src/content/site.json",
      bytes: encodeUtf8('{\n  "title": "site — v2"\n}\n'),
    },
  ],
} as const

const EDIT_TITLE_AGAIN = {
  updates: [
    {
      path: "src/content/site.json",
      bytes: encodeUtf8('{\n  "title": "site — v3"\n}\n'),
    },
  ],
} as const

function requestOf(draftKey: string, changes: unknown, baseSha: string): SaveRequest {
  return {
    draftKey,
    changes: changes as SaveRequest["changes"],
    baseSha,
  }
}

describe("INV-P04 — overlapping saves drain one at a time, each re-based on its predecessor", () => {
  it("two concurrent saves publish BOTH commits with two 200 ref updates and no 422", async () => {
    const spec = await buildSpec(BASE_CONTENT)
    const harness = createHarness(spec)
    const coordinator = createSaveCoordinator({
      backend: harness.backend,
      branch: spec.defaultBranch,
      drafts: memoryDrafts(),
    })

    const first = coordinator.save(requestOf("site", EDIT_TITLE, spec.headSha))
    const second = coordinator.save(requestOf("site-2", EDIT_TITLE_AGAIN, spec.headSha))
    const [verdictOne, verdictTwo] = await Promise.all([first, second])

    expect(verdictOne.kind).toBe("published")
    expect(verdictTwo.kind).toBe("published")
    // Exactly one ref update per save, both fast-forwards (a stale parent
    // would have 422'd): the queued save re-based on its predecessor.
    expect(successfulRefUpdates(harness.server)).toBe(2)
    expect(harness.server.log.some((event) => event.status === 422)).toBe(false)
    // FIFO content: the branch ends on the SECOND save's value.
    const head = harness.server.contents(spec.defaultBranch, "src/content/site.json")
    expect(head && new TextDecoder().decode(head.bytes)).toBe('{\n  "title": "site — v3"\n}\n')
  })

  it("the second save observes the first's commit as its base (fresh getRef after drain)", async () => {
    const spec = await buildSpec(BASE_CONTENT)
    const harness = createHarness(spec)
    const coordinator = createSaveCoordinator({
      backend: harness.backend,
      branch: spec.defaultBranch,
      drafts: memoryDrafts(),
    })

    const [verdictOne, verdictTwo] = await Promise.all([
      coordinator.save(requestOf("a", EDIT_TITLE, spec.headSha)),
      coordinator.save(requestOf("b", EDIT_TITLE_AGAIN, spec.headSha)),
    ])

    // Distinct commits: each save parsed exactly one commit (no CAS-retry
    // commits — a save that false-conflicted against its own predecessor
    // would surface a conflict verdict, not a published one).
    expect(verdictOne.kind).toBe("published")
    expect(verdictTwo.kind).toBe("published")
    if (verdictOne.kind !== "published" || verdictTwo.kind !== "published") return
    expect(verdictTwo.commitSha).not.toBe(verdictOne.commitSha)
    expect(harness.server.commitCount()).toBe(3) // seed + 2 saves
    expect(successfulRefUpdates(harness.server)).toBe(2)
    expect(harness.server.log.some((event) => event.status === 422)).toBe(false)
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
      for (const key of store.keys()) {
        if (key.startsWith(prefix)) store.delete(key)
      }
    },
    async list(): Promise<readonly DraftRecord[]> {
      return [...store.values()]
    },
  }
}
