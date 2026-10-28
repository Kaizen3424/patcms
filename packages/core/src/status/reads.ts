/** Binds the branch ONCE at composition time (INV-P14: branch stays data). */

import type { GitBackend } from "../backend/types"
import type { StatusReads } from "./types"

export function createStatusReads(backend: GitBackend, branch: string): StatusReads {
  if (branch.length === 0) throw new Error("status reads need a branch")
  return {
    readHead: async () => (await backend.getRef(branch)).object.sha,
    readCheckRuns: (sha) => backend.readCheckRuns(branch, sha),
    readCommitStatuses: (sha) => backend.readCommitStatuses(branch, sha),
  }
}
