/**
 * Human display for a conflict row: strings render raw, everything else as
 * canonical JSON so objects and lists stay comparable.
 */
export function formatValue(value: unknown): string {
  if (value === undefined) return "—"
  if (typeof value === "string") return value
  if (value === null) return "null"
  if (typeof value === "number" || typeof value === "boolean") return String(value)
  return JSON.stringify(value)
}
