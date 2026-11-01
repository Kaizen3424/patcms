/// <reference types="node" />
import { describe, expect, it } from "vitest"
import { buildSpec, createHarness } from "../../__tests__/support/fake-github-fetch"
import { encodeUtf8 } from "../../safety/encoding"
import { composeCommitMessage, containsSkipToken } from "../commit-message"
import { runSave } from "../save-driver"

/**
 * INV-D02 — deploy-muting skip tokens (ADR-0008 §4). `[skip ci]|[ci skip]|
 * [no ci]|[skip actions]` in user-editable messages are REFUSED (never
 * stripped, never silent), with zero network traffic. Defaults are safe by
 * construction.
 */

describe("INV-D02 — skip-token refusal (L0 pure)", () => {
  it("composes the machine default when no user message is present", () => {
    expect(composeCommitMessage({ count: 3 })).toEqual({
      ok: true,
      message: "chore(cms): save 3 file(s)",
    })
    expect(composeCommitMessage({ count: 1, userMessage: "   " })).toEqual({
      ok: true,
      message: "chore(cms): save 1 file(s)",
    })
  })

  it("trims and passes through safe user messages", () => {
    expect(composeCommitMessage({ count: 2, userMessage: "  fix: products copy " })).toEqual({
      ok: true,
      message: "fix: products copy",
    })
  })

  it("rejects every documented token, case- and whitespace-insensitive", () => {
    for (const token of ["[skip ci]", "[ci skip]", "[no ci]", "[skip actions]"]) {
      expect(containsSkipToken(token)).toBe(true)
      expect(containsSkipToken(`save ${token.toUpperCase()} please`)).toBe(true)
      expect(containsSkipToken(`spaces ${token.replace("[", "[ ")} inside`)).toBe(true)
      expect(composeCommitMessage({ count: 1, userMessage: token })).toEqual({
        ok: false,
        code: "SKIP_TOKEN_REJECTED",
      })
    }
  })

  it("look-alikes that do not mute deploys stay allowed", () => {
    expect(containsSkipToken("fix: skip ciwrapper naming")).toBe(false)
    expect(containsSkipToken("docs: [ci skipn't]")).toBe(false)
  })
})

describe("INV-D02 — driver refuses BEFORE any network call (L1)", () => {
  it("skip-token message ⇒ typed FAILED and an untouched server", async () => {
    const spec = await buildSpec([["src/content/site.json", '{\n  "title": "site"\n}\n']])
    const harness = createHarness(spec)
    const verdict = await runSave({
      backend: harness.backend,
      branch: "fixture-branch",
      changes: {
        updates: [
          {
            path: "src/content/site.json",
            bytes: encodeUtf8('{\n  "title": "site — edited"\n}\n'),
          },
        ],
      },
      message: "release [skip ci]",
    })
    expect(verdict.kind).toBe("failed")
    if (verdict.kind !== "failed") return
    expect(verdict.error.code).toBe("VALIDATION")
    expect(verdict.error.message).toContain("skip token")
    expect(harness.server.log.length).toBe(0) // zero writes, zero reads — refused pre-network
  })

  it("safe messages pass through the driver untouched", async () => {
    const spec = await buildSpec([["src/content/site.json", '{\n  "title": "site"\n}\n']])
    const harness = createHarness(spec)
    const verdict = await runSave({
      backend: harness.backend,
      branch: "fixture-branch",
      changes: {
        updates: [
          {
            path: "src/content/site.json",
            bytes: encodeUtf8('{\n  "title": "site — edited"\n}\n'),
          },
        ],
      },
      message: "fix: shop copy",
    })
    expect(verdict.kind).toBe("published")
    if (verdict.kind !== "published") return
    expect(
      harness.server.log.some((event) => event.method === "PATCH" && event.status === 200),
    ).toBe(true)
  })
})
