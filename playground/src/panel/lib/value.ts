/**
 * Immutable value-tree helpers for the editor. Paths are element sequences:
 * a string steps into a record, a number into an array. Kept tiny on purpose —
 * this is example code a host copies, not a framework.
 */

export type ValuePath = readonly (string | number)[]

export function getPath(root: unknown, path: ValuePath): unknown {
  let current: unknown = root
  for (const key of path) {
    if (typeof key === "number") {
      if (!Array.isArray(current)) return undefined
      current = current[key]
      continue
    }
    if (typeof current !== "object" || current === null || Array.isArray(current)) return undefined
    current = (current as Record<string, unknown>)[key]
  }
  return current
}

export function setPath(root: unknown, path: ValuePath, next: unknown): unknown {
  if (path.length === 0) return next
  const key = path[0]
  if (key === undefined) return next
  const rest = path.slice(1)
  if (typeof key === "number") {
    const array = Array.isArray(root) ? [...root] : []
    array[key] = setPath(array[key], rest, next)
    return array
  }
  const record =
    typeof root === "object" && root !== null && !Array.isArray(root)
      ? { ...(root as Record<string, unknown>) }
      : {}
  record[key] = setPath(record[key], rest, next)
  return record
}

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
