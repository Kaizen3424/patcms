import { describe, expect, it } from "vitest"
import { formatFriendlyDate, formatRelativeTime } from "../dates"

describe("formatFriendlyDate", () => {
  const baseNow = new Date("2026-10-31T12:00:00Z")

  it("formats date in current year without year suffix", () => {
    const date = new Date("2026-02-04T15:05:00Z")
    expect(formatFriendlyDate(date, baseNow)).toBe("Wed 4 Feb")
  })

  it("formats date in different year with full year", () => {
    const date = new Date("2025-02-04T15:05:00Z")
    expect(formatFriendlyDate(date, baseNow)).toBe("Tue 4 Feb 2025")
  })

  it("handles invalid date gracefully", () => {
    expect(formatFriendlyDate("invalid-date", baseNow)).toBe("Unknown date")
  })
})

describe("formatRelativeTime", () => {
  const now = new Date("2026-10-31T12:00:00Z")

  it("returns 'just now' for seconds ago or future date", () => {
    expect(formatRelativeTime(new Date("2026-10-31T11:59:30Z"), now)).toBe("just now")
    expect(formatRelativeTime(new Date("2026-10-31T12:05:00Z"), now)).toBe("just now")
  })

  it("returns 'X minutes ago'", () => {
    expect(formatRelativeTime(new Date("2026-10-31T11:50:00Z"), now)).toBe("10 minutes ago")
    expect(formatRelativeTime(new Date("2026-10-31T11:59:00Z"), now)).toBe("1 minute ago")
  })

  it("returns 'X hours ago'", () => {
    expect(formatRelativeTime(new Date("2026-10-31T10:00:00Z"), now)).toBe("2 hours ago")
    expect(formatRelativeTime(new Date("2026-10-31T11:00:00Z"), now)).toBe("1 hour ago")
  })

  it("returns 'yesterday'", () => {
    expect(formatRelativeTime(new Date("2026-10-30T11:00:00Z"), now)).toBe("yesterday")
  })

  it("returns 'X days ago' within 7 days", () => {
    expect(formatRelativeTime(new Date("2026-10-27T12:00:00Z"), now)).toBe("4 days ago")
  })

  it("returns friendly date after 7 days", () => {
    expect(formatRelativeTime(new Date("2026-10-10T12:00:00Z"), now)).toBe("Sat 10 Oct")
  })
})
