/**
 * Date formatting helpers for founder surfaces (P5.2).
 * Strictly non-ambiguous formatting per Master Plan §7:
 * dates "Tue 4 Feb", relative times "just now" / "10 minutes ago".
 */

export function parseDate(value: Date | string | number): Date {
  if (value instanceof Date) return value
  return new Date(value)
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const
const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const

/** Formats a date as "Tue 4 Feb" (or "Tue 4 Feb 2026" if not the current year). */
export function formatFriendlyDate(value: Date | string | number, now: Date = new Date()): string {
  const date = parseDate(value)
  if (Number.isNaN(date.getTime())) return "Unknown date"

  const dayName = DAYS[date.getDay()]
  const dayNum = date.getDate()
  const monthName = MONTHS[date.getMonth()]
  const sameYear = date.getFullYear() === now.getFullYear()

  return sameYear
    ? `${dayName} ${dayNum} ${monthName}`
    : `${dayName} ${dayNum} ${monthName} ${date.getFullYear()}`
}

/** Formats relative time ("just now", "10 minutes ago", "2 hours ago", "yesterday", or "Tue 4 Feb"). */
export function formatRelativeTime(value: Date | string | number, now: Date = new Date()): string {
  const date = parseDate(value)
  if (Number.isNaN(date.getTime())) return "recently"

  const diffMs = now.getTime() - date.getTime()
  if (diffMs < 0) return "just now"

  const diffSec = Math.floor(diffMs / 1000)
  if (diffSec < 45) return "just now"

  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) {
    return diffMin === 1 ? "1 minute ago" : `${diffMin} minutes ago`
  }

  const diffHours = Math.floor(diffMin / 60)
  if (diffHours < 24) {
    return diffHours === 1 ? "1 hour ago" : `${diffHours} hours ago`
  }

  const diffDays = Math.floor(diffHours / 24)
  if (diffDays === 1) return "yesterday"
  if (diffDays < 7) {
    return `${diffDays} days ago`
  }

  return formatFriendlyDate(date, now)
}
