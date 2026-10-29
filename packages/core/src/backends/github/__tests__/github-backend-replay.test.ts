import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { CORE_CONTRACT_SUITE, runContractSuite } from "../../../backend/contract-suite"
import { GithubBackend } from ".."
import type { RecordedTape } from "../recorded-replay"
import { createReplayFetch } from "../recorded-replay"

function loadGoldenTape(): RecordedTape {
  const url = new URL("./fixtures/recorded-contract-tape.json", import.meta.url)
  const raw = readFileSync(url, "utf8")
  return JSON.parse(raw) as RecordedTape
}

describe("GithubBackend recorded-fixture replay (ADR-0005 P2.11)", () => {
  it("passes the full CORE_CONTRACT_SUITE when driven by recorded HTTP replay", async () => {
    const tape = loadGoldenTape()
    expect(tape.schemaVersion).toBe(1)
    expect(tape.interactions.length).toBeGreaterThan(0)

    const replayFetch = await createReplayFetch(tape)
    const backend = new GithubBackend({
      owner: tape.meta.owner,
      repo: tape.meta.repo,
      token: "replay-token-placeholder",
      fetch: replayFetch,
    })

    const report = await runContractSuite(backend, CORE_CONTRACT_SUITE, {
      branch: tape.meta.branch,
      expectedPaths: ["src/content/site.json"],
    })

    expect(report.failures).toEqual([])
    expect(report.ok).toBe(true)
    expect(report.passed).toBe(CORE_CONTRACT_SUITE.checks.length)

    // Verify all recorded interactions on the golden tape were matched and consumed
    expect(replayFetch.isDrained()).toBe(true)
    expect(replayFetch.remainingCount()).toBe(0)
    expect(replayFetch.pendingKeys()).toEqual([])
  })

  it("supports replaying against parameterized owner and repo identifiers", async () => {
    const tape = loadGoldenTape()
    const customOwner = "partner-org"
    const customRepo = "partner-sandbox"

    const replayFetch = await createReplayFetch(tape, {
      owner: customOwner,
      repo: customRepo,
    })

    const backend = new GithubBackend({
      owner: customOwner,
      repo: customRepo,
      token: "replay-token-placeholder",
      fetch: replayFetch,
    })

    // Validate that getRef matches despite custom owner and repo in URL
    const ref = await backend.getRef(tape.meta.branch)
    expect(ref.ref).toBe(`refs/heads/${tape.meta.branch}`)
    expect(/^[0-9a-f]{40}$/.test(ref.object.sha)).toBe(true)
  })

  it("supports resetting replay fetch to re-run interactions from the beginning", async () => {
    const tape = loadGoldenTape()
    const replayFetch = await createReplayFetch(tape)
    const initialCount = replayFetch.remainingCount()

    const backend = new GithubBackend({
      owner: tape.meta.owner,
      repo: tape.meta.repo,
      token: "replay-token-placeholder",
      fetch: replayFetch,
    })

    // Consume one interaction
    const ref1 = await backend.getRef(tape.meta.branch)
    expect(ref1.ref).toBe(`refs/heads/${tape.meta.branch}`)
    expect(replayFetch.remainingCount()).toBe(initialCount - 1)

    // Reset queues
    replayFetch.reset()
    expect(replayFetch.remainingCount()).toBe(initialCount)

    // Replay again from the beginning
    const ref2 = await backend.getRef(tape.meta.branch)
    expect(ref2.object.sha).toBe(ref1.object.sha)
  })
})
