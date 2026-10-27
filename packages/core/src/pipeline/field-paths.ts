/**
 * `fieldPath` + dirty-set machinery (ADR-0004 appendix).
 *
 * A fieldPath is an ordered segment list — object KEY or list INDEX per step.
 * The appendix defines the granularity both the dirty computation and the
 * rebase adjudication obey:
 * - records recuse (per-key paths),
 * - lists with equal length compare per index,
 * - lists with differing length are ONE whole-list unit,
 * - leaves compare via `fieldEquals`.
 *
 * `diffPaths(next, base)` is the single source of that granularity: the editor
 * derives our dirty set with it; the engine derives the foreign set with it.
 */

import { fieldEquals } from "./field-equals"

export type FieldPathSegment = string | number
export type FieldPath = readonly FieldPathSegment[]

/** Stable canonical key for a path (Set/Map plumbing). */
export function fieldPathKey(path: FieldPath): string {
  return JSON.stringify(path)
}

export function equalsFieldPath(left: FieldPath, right: FieldPath): boolean {
  return left.length === right.length && left.every((segment, index) => right[index] === segment)
}

/** True iff `ancestor` is strictly above `path` on the same branch. */
export function isAncestorFieldPath(ancestor: FieldPath, path: FieldPath): boolean {
  return (
    ancestor.length < path.length && ancestor.every((segment, index) => path[index] === segment)
  )
}

/** Same node, ancestor, or descendant — the overlap rule's relation. */
export function relatedFieldPaths(left: FieldPath, right: FieldPath): boolean {
  return (
    equalsFieldPath(left, right) ||
    isAncestorFieldPath(left, right) ||
    isAncestorFieldPath(right, left)
  )
}

/** Minimal common node of two related paths (conflict reporting granularity). */
export function commonAncestorFieldPath(left: FieldPath, right: FieldPath): FieldPath {
  const shared: FieldPathSegment[] = []
  const depth = Math.min(left.length, right.length)
  for (let index = 0; index < depth; index += 1) {
    if (left[index] !== right[index]) break
    shared.push(left[index] as FieldPathSegment)
  }
  return shared
}

export interface ResolvedFieldValue {
  readonly found: boolean
  readonly value: unknown
}

/** Reads `path` inside a parsed JSON-ish tree; `found:false` means absent. */
export function readAtFieldPath(root: unknown, path: FieldPath): ResolvedFieldValue {
  let cursor: unknown = root
  for (const segment of path) {
    const next =
      typeof segment === "number"
        ? Array.isArray(cursor)
          ? cursor[segment]
          : undefined
        : isRecord(cursor) && Object.hasOwn(cursor, segment)
          ? cursor[segment]
          : undefined
    if (next === undefined) return { found: false, value: undefined }
    cursor = next
  }
  return { found: true, value: cursor }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/**
 * Dirty-field paths between a NEXT value tree and its BASE — the ADR
 * granularity (objects recuse; equal-length lists per index; length-differing
 * lists whole-list; leaves via `fieldEquals`; added/removed keys emitted as
 * their own paths). Non-record roots fall through to a leaf comparison.
 */
export function diffPaths(next: unknown, base: unknown, path?: FieldPath): FieldPath[] {
  const root: FieldPath = path ?? []
  if (Array.isArray(next) && Array.isArray(base)) {
    return diffPair(next, base, root)
  }
  if (!isRecord(next) || !isRecord(base)) {
    return leafDiff(next, base, root)
  }
  const dirty: FieldPath[] = []
  const keys = new Set([...Object.keys(base), ...Object.keys(next)])
  for (const key of keys) {
    const childPath: FieldPath = [...root, key]
    if (!Object.hasOwn(next, key) || !Object.hasOwn(base, key)) {
      dirty.push(childPath) // added OR deleted key — a user decision either way
      continue
    }
    dirty.push(...diffPair(next[key], base[key], childPath))
  }
  return dirty
}

function diffPair(next: unknown, base: unknown, path: FieldPath): FieldPath[] {
  if (fieldEquals(next, base)) return []
  if (Array.isArray(next) && Array.isArray(base)) {
    if (next.length !== base.length) return [path] // whole-list unit (order + membership)
    const dirty: FieldPath[] = []
    for (const index of next.keys()) {
      dirty.push(...diffPair(next[index], base[index], [...path, index]))
    }
    return dirty
  }
  if (isRecord(next) && isRecord(base)) return diffPaths(next, base, path)
  return leafDiff(next, base, path)
}

function leafDiff(next: unknown, base: unknown, path: FieldPath): FieldPath[] {
  return fieldEquals(next, base) ? [] : [path]
}

/** Convenience for the editor + property tests: dirty = diffPaths(form, base). */
export function computeDirtyPaths(formValue: unknown, oldBase: unknown): FieldPath[] {
  return diffPaths(formValue, oldBase)
}
