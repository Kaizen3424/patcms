import { describe, expect, it } from "vitest"
import {
  ADVISORY_COPY,
  allCopyStrings,
  fillLine,
  fillName,
  personalize,
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

describe("founder copy deck", () => {
  it("never uses a banned word (whole-word, case-insensitive)", () => {
    const offenders: string[] = []
    for (const text of allCopyStrings()) {
      for (const word of BANNED) {
        const pattern = new RegExp(`\\b${word}\\b`, "i")
        if (pattern.test(text)) offenders.push(`${word}: ${text}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it("names no credential word other than 'access key'", () => {
    const strings = allCopyStrings().join("\n")
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

  it("fills chip placeholders inertly ($ patterns stay literal)", () => {
    expect(fillLine("{title}: {detail}", { title: "A$&", detail: "b" })).toBe("A$&: b")
    expect(fillLine(ADVISORY_COPY.copyBody, { title: "t", detail: "d", path: "p" })).toBe(
      "t: d (p)",
    )
  })
})
