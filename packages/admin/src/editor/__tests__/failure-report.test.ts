import { describe, expect, it } from "vitest"
import { composeFailureReport, copyToClipboard, PARTNER_GUIDANCE } from "../failure-report"

describe("failure-report (Structured Copy Composer, P2.10)", () => {
  it("formats the structured dual-audience payload accurately", () => {
    const report = composeFailureReport({
      entryTitle: "Iris No. 9",
      filePath: "src/content/products/iris.json",
      branch: "main",
      repo: "acme/shop",
      baseSha: "abc1234",
      changedFields: ["price", "description"],
      errorCode: "SCOPE",
      httpStatus: 403,
      timestamp: "2026-10-29T14:45:00Z",
      partnerName: "Milan",
    })

    expect(report).toContain("Hi Milan,")
    expect(report).toContain('I had trouble saving "Iris No. 9" on the site.')
    expect(report).toContain("Details for Milan:")
    expect(report).toContain("• Entry: Iris No. 9 (src/content/products/iris.json)")
    expect(report).toContain("• Address: acme/shop")
    expect(report).toContain("• Branch: main")
    expect(report).toContain("• Base revision: abc1234")
    expect(report).toContain("• Changed fields: price, description")
    expect(report).toContain("• Error: SCOPE (HTTP 403)")
    expect(report).toContain("• Time: 2026-10-29T14:45:00Z")
    expect(report).toContain(PARTNER_GUIDANCE.SCOPE)
  })

  it("handles read error context and missing changed fields", () => {
    const report = composeFailureReport({
      entryTitle: "Settings",
      filePath: "src/content/settings.json",
      branch: "fixture-branch",
      repo: "owner/repo",
      baseSha: "",
      errorCode: "NOT_FOUND",
      timestamp: "2026-10-29T14:45:00Z",
      partnerName: "Ada",
      kind: "read",
    })

    expect(report).toContain("Hi Ada,")
    expect(report).toContain('I had trouble opening "Settings" on the site.')
    expect(report).toContain("• Base revision: unknown")
    expect(report).toContain("• Changed fields: none")
    expect(report).toContain("• Error: NOT_FOUND")
    expect(report).toContain(PARTNER_GUIDANCE.NOT_FOUND)
  })

  it("handles advisory chip context with detail", () => {
    const report = composeFailureReport({
      entryTitle: "Chair",
      filePath: "src/content/chair.json",
      branch: "main",
      repo: "owner/repo",
      baseSha: "def5678",
      errorCode: "VALIDATION",
      timestamp: "2026-10-29T14:45:00Z",
      partnerName: "Ing",
      kind: "advisory",
      advisoryDetail: "Reference to missing collection item",
    })

    expect(report).toContain(
      'I had trouble saving "Chair" (an older problem paused site updates) on the site.',
    )
    expect(report).toContain("• Advisory note: Reference to missing collection item")
  })

  it("copyToClipboard handles fallback execution gracefully", async () => {
    const success = await copyToClipboard("test clipboard content")
    // In jsdom environment, navigator.clipboard or execCommand may return false/stub, but never throws
    expect(typeof success).toBe("boolean")
  })
})
