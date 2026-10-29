import type { DeployStatusCause, DeployStatusKind } from "@mycms/core"
import { describe, expect, it } from "vitest"
import {
  STATUS_CAUSE_COPY,
  STATUS_COPY,
  STATUS_DISABLED_COPY,
  STATUS_SUPERSEDED_COPY,
} from "../../status/copy"
import {
  ADVISORY_COPY,
  allCopyStrings,
  FAILURE_CARD_COPY,
  FAILURE_COPY,
  FREEZE_COPY,
  fillLine,
  fillName,
  personalize,
  RATE_COPY,
  READ_ERROR_COPY,
  REAUTH_COPY,
  RECOVERY_COPY,
  SAVE_BAR_COPY,
  type SaveBarStatus,
} from "../copy"

/**
 * The copy deck is a HARD product boundary (01-spec §6, master-plan §7):
 * banned words are machine-checked, `{name}` comes from the host, and every
 * state has a line. These tests fail the build, not the founder.
 */

const BANNED = [
  "build",
  "commit",
  "deploy",
  "token",
  "slug",
  "repository",
  "draft",
  "someone",
  "conflict",
] as const

/**
 * Every founder-visible string, across both decks: the editor deck owns the
 * save/recovery surfaces, the status deck owns the deploy surfaces (P2.8).
 * One array so both are swept by the same assertions.
 */
function everyFounderString(): readonly string[] {
  return [
    ...allCopyStrings(),
    ...Object.values(STATUS_COPY),
    ...Object.values(STATUS_CAUSE_COPY),
    STATUS_SUPERSEDED_COPY,
    STATUS_DISABLED_COPY,
  ]
}

describe("founder copy deck", () => {
  it("never uses a banned word (whole-word, case-insensitive)", () => {
    const offenders: string[] = []
    for (const text of everyFounderString()) {
      for (const word of BANNED) {
        const pattern = new RegExp(`\\b${word}\\b`, "i")
        if (pattern.test(text)) offenders.push(`${word}: ${text}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it("names no credential word other than 'access key'", () => {
    const strings = everyFounderString().join("\n")
    expect(strings).toContain("access key")
    expect(strings.toLowerCase()).not.toContain("password")
    expect(strings.toLowerCase()).not.toContain("api key")
  })

  it("covers all 11 bar states with a title", () => {
    const statuses: readonly SaveBarStatus[] = [
      "clean",
      "dirty",
      "saving",
      "saved",
      "noop",
      "conflict",
      "busy",
      "paused",
      "authExpired",
      "failed",
      "leaseLost",
    ]
    for (const status of statuses) {
      expect(SAVE_BAR_COPY[status].title.length).toBeGreaterThan(0)
    }
    expect(Object.keys(SAVE_BAR_COPY)).toHaveLength(statuses.length)
  })

  it("substitutes the named human from support.name", () => {
    expect(fillName("Ask {name} to look.", "Ada")).toBe("Ask Ada to look.")
    const personalized = personalize(SAVE_BAR_COPY.conflict, "Ada")
    expect(personalized.detail).toContain("Ask Ada to look")
    expect(personalized.detail).not.toContain("{name}")
  })

  it("personalizes every line that carries the placeholder", () => {
    for (const status of Object.keys(SAVE_BAR_COPY) as SaveBarStatus[]) {
      const line = personalize(SAVE_BAR_COPY[status], "Ada")
      expect(line.title).not.toContain("{name}")
      expect(line.detail ?? "").not.toContain("{name}")
    }
  })

  it("ships the recovery surfaces", () => {
    expect(Object.keys(RECOVERY_COPY)).toEqual([
      "restoreFound",
      "startOver",
      "discardLocal",
      "retrySave",
      "recheck",
    ])
  })

  it("ships the freeze region lines (P2.9 — 'the other version', never a banned word)", () => {
    expect(Object.keys(FREEZE_COPY)).toEqual([
      "title",
      "detail",
      "otherEditsKept",
      "theirsHeader",
      "mineHeader",
      "keepTheirs",
      "keepMine",
      "startOver",
      "degradedTitle",
      "degradedDetail",
    ])
  })

  it("ships the advisory chip lines (P2.7 — 'saved', never a banned word)", () => {
    expect(Object.keys(ADVISORY_COPY)).toEqual([
      "pausedTitle",
      "chipDetail",
      "takeMeThere",
      "copyMessage",
      "copyBody",
      "copied",
      "dismiss",
      "unknownTitle",
      "unknownDetail",
    ])
  })

  it("ships the deploy-status deck for every kind and cause (P2.8)", () => {
    const kinds: readonly DeployStatusKind[] = [
      "awaiting",
      "building",
      "live",
      "failed",
      "unavailable",
    ]
    const causes: readonly DeployStatusCause[] = [
      "grace",
      "error",
      "incomplete",
      "unsupported",
      "watch-timeout",
    ]
    for (const kind of kinds) expect(STATUS_COPY[kind].length).toBeGreaterThan(0)
    for (const cause of causes) expect(STATUS_CAUSE_COPY[cause].length).toBeGreaterThan(0)
    expect(Object.keys(STATUS_COPY)).toHaveLength(kinds.length)
    expect(Object.keys(STATUS_CAUSE_COPY)).toHaveLength(causes.length)
    expect(STATUS_SUPERSEDED_COPY.length).toBeGreaterThan(0)
    expect(STATUS_DISABLED_COPY.length).toBeGreaterThan(0)
  })

  it("fills chip placeholders inertly ($ patterns stay literal)", () => {
    expect(fillLine("{title}: {detail}", { title: "A$&", detail: "b" })).toBe("A$&: b")
    expect(fillLine(ADVISORY_COPY.copyBody, { title: "t", detail: "d", path: "p" })).toBe(
      "t: d (p)",
    )
  })

  it("ships the failure copy decks for every classified error code (P2.10 — INV-A02)", () => {
    const codes = [
      "AUTH_EXPIRED",
      "SCOPE",
      "RATE_LIMIT",
      "NOT_FOUND",
      "VALIDATION",
      "NETWORK",
      "TREE_TRUNCATED",
      "UNKNOWN",
    ]
    for (const code of codes) {
      expect(FAILURE_COPY[code]?.title.length).toBeGreaterThan(0)
      expect(FAILURE_COPY[code]?.detail?.length).toBeGreaterThan(0)
      const line = personalize(FAILURE_COPY[code]!, "Milan")
      expect(line.title).not.toContain("{name}")
      expect(line.detail).not.toContain("{name}")
    }
    expect(Object.keys(FAILURE_COPY)).toHaveLength(codes.length)
  })

  it("ships the in-place re-auth copy deck (P2.10 — INV-A01)", () => {
    expect(REAUTH_COPY.title).toBe("Your access key needs checking")
    expect(REAUTH_COPY.inputLabel).toBe("Access key")
    expect(REAUTH_COPY.submit).toBe("Check key and save")
    expect(REAUTH_COPY.signOut).toBe("Sign out")
  })

  it("ships the rate limit countdown copy deck (P2.10 — INV-N01)", () => {
    expect(RATE_COPY.busyTitle).toBe("The site is busy right now.")
    expect(RATE_COPY.resumeNow).toBe("Try saving now")
    expect(fillLine(RATE_COPY.countdown, { seconds: "24" })).toBe("Resuming in 24 seconds...")
  })
})
