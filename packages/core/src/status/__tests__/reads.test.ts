import { describe, expect, it } from "vitest"
import type { GitBackend } from "../../backend/types"
import { createStatusReads } from "../reads"

/** INV-P14: the branch is bound once at composition time and stays data. */

const HEAD = "a".repeat(40)
const WATCHED = "b".repeat(40)

describe("createStatusReads", () => {
  it("threads the configured branch and the requested sha into every read", async () => {
    const calls: string[][] = []
    const backend = {
      getRef: async (branch: string) => {
        calls.push(["getRef", branch])
        return { ref: `refs/heads/${branch}`, object: { sha: HEAD, type: "commit" } }
      },
      readCheckRuns: async (branch: string, sha: string) => {
        calls.push(["readCheckRuns", branch, sha])
        return { kind: "ok", totalCount: 0, runs: [] }
      },
      readCommitStatuses: async (branch: string, sha: string) => {
        calls.push(["readCommitStatuses", branch, sha])
        return { kind: "ok", statuses: [] }
      },
    } as unknown as GitBackend

    const reads = createStatusReads(backend, "release/train")
    expect(await reads.readHead()).toBe(HEAD)
    expect(await reads.readCheckRuns(WATCHED)).toEqual({ kind: "ok", totalCount: 0, runs: [] })
    expect(await reads.readCommitStatuses(WATCHED)).toEqual({ kind: "ok", statuses: [] })
    expect(calls).toEqual([
      ["getRef", "release/train"],
      ["readCheckRuns", "release/train", WATCHED],
      ["readCommitStatuses", "release/train", WATCHED],
    ])
  })

  it("refuses an empty branch at composition time", () => {
    expect(() => createStatusReads({} as GitBackend, "")).toThrow(/branch/)
  })
})
