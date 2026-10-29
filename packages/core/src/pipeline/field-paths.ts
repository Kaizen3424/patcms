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

// --- value-domain path writers (ADR-0004 P2.9 appendix) ---------------------
//
// The ONLY mutation surface the admin's freeze UI uses to apply a per-field
// decision. Pure: the input tree is never mutated; a deep clone is spliced and
// returned. They generalize the splice internals `rebase()` already owns
// (parents auto-created, list-item deletion refused as a whole-list edit) so
// the no-second-serializer law holds outside rebase too.

export type FieldPathWriteResult =
  | { readonly ok: true; readonly tree: unknown }
  | { readonly ok: false; readonly issue: FieldPathWriteIssue }

export interface FieldPathWriteIssue {
  readonly code: "ROOT_PATH" | "SPLICE_GAP"
  readonly detail: string
}

/**
 * Writes `value` at `path` inside a deep clone of `tree`, creating intermediate
 * containers when genuinely new (a record key creates an object or a list
 * depending on whether the NEXT segment is an index). `path: []` is refused —
 * the root is not a field.
 */
export function writeAtFieldPath(
  tree: unknown,
  path: FieldPath,
  value: unknown,
): FieldPathWriteResult {
  if (path.length === 0) {
    return { ok: false, issue: { code: "ROOT_PATH", detail: "the document root is not a field" } }
  }
  const clone = cloneTree(tree)
  const outcome = assignAt(clone, path, value)
  return outcome.kind === "ok" ? { ok: true, tree: clone } : { ok: false, issue: outcome.issue }
}

/**
 * Removes the key at `path` from a deep clone of `tree`. Deleting an absent key
 * is already the target state — a no-op success. List-ITEM deletion is refused
 * (`SPLICE_GAP`): index shifts would silently reorder; a list removal is a
 * whole-list write decided at the list path. `path: []` is refused.
 */
export function deleteAtFieldPath(tree: unknown, path: FieldPath): FieldPathWriteResult {
  if (path.length === 0) {
    return { ok: false, issue: { code: "ROOT_PATH", detail: "the document root is not a field" } }
  }
  const clone = cloneTree(tree)
  const outcome = removeAt(clone, path)
  return outcome.kind === "ok" ? { ok: true, tree: clone } : { ok: false, issue: outcome.issue }
}

function cloneTree(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(cloneTree)
  if (isRecord(value)) {
    const copy: Record<string, unknown> = {}
    for (const key of Object.keys(value)) copy[key] = cloneTree(value[key])
    return copy
  }
  return value
}

function assignAt(
  cursorNode: unknown,
  path: FieldPath,
  value: unknown,
): { readonly kind: "ok" } | { readonly kind: "issue"; readonly issue: FieldPathWriteIssue } {
  let cursor: unknown = cursorNode
  for (let index = 0; index < path.length - 1; index += 1) {
    const segment = path[index] as string | number
    const nextIsIndex = typeof path[index + 1] === "number"
    if (isRecord(cursor)) {
      const key = String(segment)
      if (!Object.hasOwn(cursor, key)) cursor[key] = nextIsIndex ? [] : {}
      cursor = cursor[key]
      continue
    }
    if (Array.isArray(cursor) && typeof segment === "number") {
      if (cursor[segment] === undefined) cursor[segment] = nextIsIndex ? [] : {}
      cursor = cursor[segment]
      continue
    }
    return { kind: "issue", issue: spliceGap(path, "parent container vanished") }
  }

  const last = path[path.length - 1] as string | number
  if (isRecord(cursor)) {
    cursor[String(last)] = value
    return { kind: "ok" }
  }
  if (Array.isArray(cursor) && typeof last === "number") {
    if (last === cursor.length) cursor.push(value)
    else if (last < cursor.length) cursor[last] = value
    else return { kind: "issue", issue: spliceGap(path, `index ${last} beyond list end`) }
    return { kind: "ok" }
  }
  return { kind: "issue", issue: spliceGap(path, "parent container vanished") }
}

function removeAt(
  cursorNode: unknown,
  path: FieldPath,
): { readonly kind: "ok" } | { readonly kind: "issue"; readonly issue: FieldPathWriteIssue } {
  let cursor: unknown = cursorNode
  for (let index = 0; index < path.length - 1; index += 1) {
    const segment = path[index] as string | number
    const child =
      isRecord(cursor) && Object.hasOwn(cursor, String(segment))
        ? cursor[String(segment)]
        : Array.isArray(cursor) && typeof segment === "number"
          ? cursor[segment]
          : undefined
    if (child === undefined) {
      // Deleting an absent key is already the new base's state — no splice.
      return { kind: "ok" }
    }
    cursor = child
  }
  const last = path[path.length - 1] as string | number
  if (isRecord(cursor)) {
    delete cursor[String(last)]
    return { kind: "ok" }
  }
  if (Array.isArray(cursor) && typeof last === "number") {
    return { kind: "issue", issue: spliceGap(path, "list item deletion is a whole-list edit") }
  }
  return { kind: "issue", issue: spliceGap(path, "parent container vanished") }
}

function spliceGap(path: FieldPath, detail: string): FieldPathWriteIssue {
  return {
    code: "SPLICE_GAP",
    detail: `${detail} (at ${path.map(String).join(".")})`,
  }
}
