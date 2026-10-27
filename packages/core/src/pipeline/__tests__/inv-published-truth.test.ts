/// <reference types="node" />
import { describe, expect, it } from "vitest"
import { GithubBackend } from "../../backends/github"
import type { FetchLike } from "../../composition"
import { encodeUtf8 } from "../../safety/encoding"
import { runSave } from "../save-driver"
import {
  BASE_CONTENT,
  blobCreateShas,
  buildSpec,
  createHarness,
  successfulRefUpdates,
} from "./fake-github-fetch"

/**
 * INV-P10 — published-by-content + orphan-blob law (ADR-0005 P2/C.3):
 *  - a LOST ref ack (response dropped AFTER the ref advanced) is recovered by
 *    re-GETting the ref and confirming the head TREE sha against the
 *    client-computed expected tree sha — the commit is real; the save ends
 *    `published` with THE LOST COMMIT's sha, and NO rebuild happens;
 *  - when the head tree read itself fails, the diff-level fallback confirms
 *    (head's diff against our base equals exactly our writes);
 *  - blobs orphaned by a dead attempt are NEVER cleaned — the driver issues
 *    zero deletion requests, and the rebuild converges to identical shas
 *    (content addressing, INV-P03);
 *  - an unknown outcome is never guessed: unconfirmable heads resolve
 *    `conflict` (re-probed), never a silent publish.
 */

const SITE_PATH = "src/content/site.json"
const EDIT_SITE = {
  updates: [{ path: SITE_PATH, bytes: encodeUtf8('{\n  "title": "site — truth"\n}\n') }],
} as const

const DROP_REF_ACK = {
  dropAcks: [{ method: "PATCH", pathPattern: /^\/git\/refs\/heads\// }],
} as const

describe("INV-P10 — a lost ref ack resolves published BY CONTENT (no rebuild)", () => {
  it("tree-sha equality confirms the lost commit; exactly one ref update total", async () => {
    const spec = await buildSpec(BASE_CONTENT)
    const harness = createHarness(spec, { chaos: DROP_REF_ACK })

    const verdict = await runSave({
      backend: harness.backend,
      branch: spec.defaultBranch,
      changes: EDIT_SITE,
    })

    expect(verdict.kind).toBe("published")
    if (verdict.kind !== "published") return
    // The published sha IS the head the lost ack created (content-confirmed).
    expect(verdict.commitSha).toBe(harness.server.ref(spec.defaultBranch))
    // No rebuild: exactly ONE ref update, ONE parsed commit.
    expect(successfulRefUpdates(harness.server)).toBe(1)
    expect(harness.server.commitCount()).toBe(2)
    // The tree-sha confirm read: the recovery read the head tree (GET trees).
    expect(
      harness.server.log.some(
        (event) => event.method === "GET" && event.path.startsWith("/git/trees/"),
      ),
    ).toBe(true)
  })

  it("the diff-level fallback confirms when the recovery tree read fails", async () => {
    const spec = await buildSpec(BASE_CONTENT)
    const harness = createHarness(spec, { chaos: DROP_REF_ACK })
    // Fault exactly ONE GET /git/trees AFTER the drop: the recovery confirm
    // read. The diff fallback (listChangedFiles) then carries the proof.
    const inner = harness.fetch
    let treeGets = 0
    const fetch: FetchLike = async (url, init) => {
      const method = (init?.method ?? "GET").toUpperCase()
      const path = String(url)
      if (method === "GET" && path.includes("/git/trees/")) {
        treeGets += 1
        if (treeGets === 2) {
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
      return inner(url, init)
    }
    const backend = new GithubBackend({
      owner: "fixture-owner",
      repo: "fixture-repo",
      token: "t",
      fetch,
      baseUrl: "https://unit.test",
    })

    const verdict = await runSave({
      backend,
      branch: spec.defaultBranch,
      changes: EDIT_SITE,
    })

    expect(verdict.kind).toBe("published")
    if (verdict.kind !== "published") return
    expect(verdict.commitSha).toBe(harness.server.ref(spec.defaultBranch))
    expect(successfulRefUpdates(harness.server)).toBe(1)
    expect(treeGets).toBeGreaterThanOrEqual(3) // base + failed confirm + diff reads
  })
})

describe("INV-P10 — orphan blobs are never cleaned", () => {
  it("a dead attempt's blobs stay; the rebuild converges to identical shas; zero deletions", async () => {
    const spec = await buildSpec(BASE_CONTENT)
    // Blob creates succeed, then the tree create DIES (500) — the blobs of
    // attempt 0 are unreferenced (orphaned) at that instant.
    const harness = createHarness(spec, {
      chaos: { faults: [{ method: "POST", pathPattern: /^\/git\/trees$/, times: 1, status: 500 }] },
    })

    const verdict = await runSave({
      backend: harness.backend,
      branch: spec.defaultBranch,
      changes: EDIT_SITE,
    })

    expect(verdict.kind).toBe("published")
    expect(successfulRefUpdates(harness.server)).toBe(1)
    expect(harness.server.commitCount()).toBe(2)
    // INV-P03/P10: the rebuild did NOT invent new blobs — same content, same
    // shas. The "orphaned" attempt-0 blobs ARE the objects the commit uses.
    const createdShas = blobCreateShas(harness.server)
    expect(createdShas).toHaveLength(2)
    expect(createdShas[0]).toBe(createdShas[1])
    // THE LAW: no deletion/cleanup requests exist anywhere in the pipeline.
    expect(harness.server.log.some((event) => event.method === "DELETE")).toBe(false)
  })
})

describe("INV-P10 — unconfirmable outcomes never resolve published", () => {
  it("a head that moved to FOREIGN content resolves conflict (re-probe), not publish", async () => {
    const spec = await buildSpec(BASE_CONTENT)
    // Foreign commit ON TOP of our base, created INSIDE the same truthful
    // server (so its tree/commit records exist for the challenge reads).
    const foreignBytes = encodeUtf8('{\n  "title": "foreign edit"\n}\n')
    const harness = createHarness(spec)
    const foreign = await harness.backend.commitChanges(
      { updates: [{ path: SITE_PATH, bytes: foreignBytes }] },
      spec.headSha,
      spec.defaultBranch,
    )
    // Roll the branch back to the base: OUR save starts from the base.
    harness.server.setRef(spec.defaultBranch, spec.headSha)

    // Intercept the PATCH: a concurrent foreign push lands just before it —
    // the PATCH 422s (parent mismatch) and the driver adjudicates the FRESH
    // head as foreign content: conflict, never a silent publish.
    const inner = harness.fetch
    let intercepted = false
    const fetch: FetchLike = async (url, init) => {
      const method = (init?.method ?? "GET").toUpperCase()
      if (method === "PATCH" && String(url).includes("/git/refs/heads/") && !intercepted) {
        intercepted = true
        harness.server.setRef(spec.defaultBranch, foreign.commitSha)
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

    const verdict = await runSave({
      backend,
      branch: spec.defaultBranch,
      changes: EDIT_SITE,
    })

    expect(verdict.kind).toBe("conflict")
    if (verdict.kind !== "conflict") return
    expect(verdict.details.currentHeadSha).toBe(foreign.commitSha)
    expect(successfulRefUpdates(harness.server)).toBe(1) // only the foreign push
    // The foreign commit's content is visible as the changed file.
    expect(verdict.details.changed.has(SITE_PATH)).toBe(true)
  })
})
