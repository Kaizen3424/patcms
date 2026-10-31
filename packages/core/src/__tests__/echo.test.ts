import { describe, expect, it } from "vitest"
import { FixtureBackend } from "../backends/reference-fixture-backend"
import type { DraftStore } from "../drafts"
import { createMyCMS, type Logger } from "../index"
import { SAVE_PHASE_ORDER } from "../pipeline"
import { createLogger } from "../safety/logger"

/** Deterministic, law-shape stub of the composition-root deps (ADR-0001). */
function stubDeps() {
  const backend = new FixtureBackend({
    headSha: "1a".repeat(20),
    capabilities: { commitStatus: false },
  })
  const storage: DraftStore = {
    get: async () => undefined,
    put: async () => {},
    delete: async () => {},
    deletePrefix: async () => {},
    list: async () => [],
  }
  const clock = () => new Date("2026-10-27T00:00:00Z")
  const fetch = async (
    _input: string,
    _init?: { method?: string; headers?: Record<string, string> },
  ) => {
    throw new Error("network disabled in this test")
  }
  const logger: Logger = createLogger()
  return { backend, storage, clock, fetch, logger }
}

describe("echo: public module graph executes", () => {
  it("exposes the composition root + law constants (named exports only)", () => {
    expect(typeof createMyCMS).toBe("function")
    expect(typeof createLogger).toBe("function")
    expect([...SAVE_PHASE_ORDER]).toHaveLength(8)
  })

  it("save-phase table holds the eight ADR-0004 states in order", () => {
    expect([...SAVE_PHASE_ORDER]).toEqual([
      "editing",
      "dirty",
      "queued",
      "committing",
      "published",
      "conflict",
      "failed",
      "paused",
    ])
  })

  it("createMyCMS stores injected deps read-only (single wiring point, ADR-0001)", () => {
    const deps = stubDeps()
    const instance = createMyCMS(deps)
    expect(instance.backend).toBe(deps.backend)
    expect(instance.clock).toBe(deps.clock)
    expect(() => {
      ;(instance as unknown as Record<string, unknown>).backend = null
    }).toThrow(TypeError)
    expect(instance.backend.capabilities).toEqual({ commitStatus: false, branches: true })
  })
})
