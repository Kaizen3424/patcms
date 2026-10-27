/**
 * e2e harness (T5.1) — a deliberately tiny, test-only bridge from Playwright
 * into the MSW FakeGithub. It exists because the fake repo lives in the page:
 * a reload rebuilds it from fixtures, so the ONLY honest place to observe what
 * a save wrote is the live `FakeGithubServer` in the current page.
 *
 * Production hosts never install this; `main.ts` does, and only for the
 * playground build. It exposes state, never a credential.
 */
import type { FakeGithubServer, FakeRequestLogEvent } from "@mycms/core"

export interface MycmsHarness {
  /** The live reference server (refs, trees, blobs, request log). */
  readonly server: FakeGithubServer
  /** Everything the fake has served this page life, in order. */
  readonly requestLog: readonly FakeRequestLogEvent[]
  /** Branch the fixtures live on. */
  readonly defaultBranch: string
  /** Decoded bytes of `path` at the branch head, or null when absent. */
  readFile(path: string): string | null
  /** Parsed commit count since boot — a save must add exactly one (INV-P02). */
  commitCount(): number
  /** Current head sha for the fixtures branch. */
  head(): string | undefined
}

declare global {
  interface Window {
    __mycmsHarness?: MycmsHarness
  }
}

export function installHarness(input: {
  readonly server: FakeGithubServer
  readonly defaultBranch: string
}): void {
  const { server, defaultBranch } = input
  window.__mycmsHarness = {
    server,
    requestLog: server.log,
    defaultBranch,
    readFile(path) {
      const file = server.contents(defaultBranch, path)
      return file === undefined ? null : new TextDecoder().decode(file.bytes)
    },
    commitCount: () => server.commitCount(),
    head: () => server.ref(defaultBranch),
  }
}
