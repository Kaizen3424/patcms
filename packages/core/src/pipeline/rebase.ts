/**
 * `rebase()` — the FIELD-granular merge (ADR-0004 + appendix; INV-P05/P07/P08
 * downstream). Pure, Result-shaped, never throws.
 *
 * Laws (appendix is normative):
 * - dirty is decided in the VALUE domain (`diffPaths`/`fieldEquals`), the merge
 *   is performed in the RAW domain (splice into a copy of `parse(newBaseRaw)`,
 *   canonical print; verbatim bytes when nothing splices),
 * - overlap ⇒ CONFLICT at the minimal common node — never a silent win,
 * - unknowns come only from the new raw; old unknowns never resurrect,
 * - adopted foreign changes (incl. deletions, unknown loss) warn — "auto-merge
 *   with announcements",
 * - `oldBase` is verified against `parse(oldRaw)` (STALE_BASE guard).
 */

import type { JsonValue } from "../safety/untrusted-json"
import { parseUntrustedJson } from "../safety/untrusted-json"
import { canonicalJson } from "../serialization/document"
import { fieldEquals } from "./field-equals"
import {
  commonAncestorFieldPath,
  diffPaths,
  type FieldPath,
  fieldPathKey,
  isAncestorFieldPath,
  readAtFieldPath,
  relatedFieldPaths,
} from "./field-paths"

export type RebaseIssueCode =
  | "INVALID_JSON"
  | "TOO_LARGE"
  | "TOO_DEEP"
  | "TOO_MANY_ITEMS"
  | "STALE_BASE"
  | "ROOT_SHAPE"
  | "SPLICE_GAP"

export interface RebaseIssue {
  readonly code: RebaseIssueCode
  readonly path?: string
  readonly detail?: string
}

export interface RebaseSuccess {
  readonly ok: true
  readonly mergedRaw: string
  /** Frozen fields — user decides; remote bytes kept until then. */
  readonly conflicts: readonly FieldPath[]
  /** Silently adopted foreign changes (announcements), incl. deletions. */
  readonly warnings: readonly FieldPath[]
}

export type RebaseResult =
  | RebaseSuccess
  | { readonly ok: false; readonly issues: readonly RebaseIssue[] }

export interface RebaseInput {
  readonly formValue: JsonValue
  readonly dirtyPaths: ReadonlySet<FieldPath>
  /** Full parsed value of `oldRaw` (verified inside — STALE_BASE guard). */
  readonly oldBase: JsonValue
  readonly oldRaw: string
  readonly newBaseRaw: string
}

export function rebase(input: RebaseInput): RebaseResult {
  const oldParsed = parseUntrustedJson(input.oldRaw)
  if (!oldParsed.ok) return { ok: false, issues: mapIssues(oldParsed.issues) }
  const newParsed = parseUntrustedJson(input.newBaseRaw)
  if (!newParsed.ok) return { ok: false, issues: mapIssues(newParsed.issues) }

  const oldValue = oldParsed.value
  const newValue = newParsed.value
  if (!isRecordValue(oldValue) || !isRecordValue(newValue)) {
    return {
      ok: false,
      issues: [{ code: "ROOT_SHAPE", detail: "documents must be JSON objects at the root" }],
    }
  }
  if (!isRecordValue(input.formValue) || !isRecordValue(input.oldBase)) {
    return {
      ok: false,
      issues: [{ code: "ROOT_SHAPE", detail: "form and base must be JSON objects" }],
    }
  }
  if (!fieldEquals(input.oldBase, oldValue)) {
    return {
      ok: false,
      issues: [{ code: "STALE_BASE", detail: "oldBase is not the parsed value of oldRaw" }],
    }
  }

  const ours = normalizeDirtyPaths(input.dirtyPaths)
  if (ours.kind === "issue") return { ok: false, issues: [ours.issue] }

  const foreign = diffPaths(newValue, oldValue)
  const plan = adjudicate(ours.paths, foreign, input.formValue, newValue)

  if (plan.splices.length === 0) {
    // Nothing to splice — the no-op law: verbatim bytes, never a re-print.
    return {
      ok: true,
      mergedRaw: input.newBaseRaw,
      conflicts: plan.conflicts,
      warnings: plan.warnings,
    }
  }

  const merged = cloneTree(newValue)
  for (const path of plan.splices) {
    const formResolved = readAtFieldPath(input.formValue, path)
    const outcome = formResolved.found
      ? assignAt(merged, path, formResolved.value)
      : deleteAt(merged, path)
    if (outcome.kind === "issue") return { ok: false, issues: [outcome.issue] }
  }
  return {
    ok: true,
    mergedRaw: canonicalJson(merged as JsonValue),
    conflicts: plan.conflicts,
    warnings: plan.warnings,
  }
}

type Adjudication = {
  readonly splices: readonly FieldPath[]
  readonly conflicts: readonly FieldPath[]
  readonly warnings: readonly FieldPath[]
}

function adjudicate(
  ours: readonly FieldPath[],
  foreign: readonly FieldPath[],
  formValue: JsonValue,
  newValue: JsonValue,
): Adjudication {
  const conflicts: FieldPath[] = []
  const silenced: FieldPath[] = []
  const candidateSplices: FieldPath[] = []

  for (const dirty of ours) {
    const related = foreign.filter((candidate) => relatedFieldPaths(dirty, candidate))
    if (related.length === 0) {
      candidateSplices.push(dirty)
      continue
    }
    // Shallowest minimal common node — the widest contested region wins.
    let node = commonAncestorFieldPath(dirty, related[0] as FieldPath)
    for (const candidate of related.slice(1)) {
      const next = commonAncestorFieldPath(dirty, candidate)
      if (next.length < node.length) node = next
    }
    const formSide = readAtFieldPath(formValue, node)
    const remoteSide = readAtFieldPath(newValue, node)
    const convergent =
      formSide.found === remoteSide.found &&
      (!formSide.found || fieldEquals(formSide.value, remoteSide.value))
    if (convergent) {
      silenced.push(node) // both sides arrived at the same value — silent agreement
    } else {
      conflicts.push(node)
    }
  }

  // A splice must not write inside a contested region.
  const splices = candidateSplices.filter(
    (path) =>
      !conflicts.some(
        (node) => fieldPathKey(node) === fieldPathKey(path) || isAncestorFieldPath(node, path),
      ),
  )

  const warnings = foreign.filter(
    (candidate) =>
      !conflicts.some((node) => relatedFieldPaths(node, candidate)) &&
      !silenced.some((node) => relatedFieldPaths(node, candidate)),
  )

  return {
    splices,
    conflicts: sortPaths(dedupePaths(conflicts)),
    warnings: sortPaths(dedupePaths(warnings)),
  }
}

/** Drops nested dirty paths (an ancestor subsumes its descendants) and empty paths. */
function normalizeDirtyPaths(
  dirtyPaths: ReadonlySet<FieldPath>,
): { kind: "ok"; paths: FieldPath[] } | { kind: "issue"; issue: RebaseIssue } {
  const unique = new Map<string, FieldPath>()
  for (const path of dirtyPaths) {
    if (path.length === 0) {
      return {
        kind: "issue",
        issue: { code: "ROOT_SHAPE", detail: "the document root is not a field path" },
      }
    }
    unique.set(fieldPathKey(path), path)
  }
  const ordered = [...unique.values()].sort(
    (left, right) =>
      left.length - right.length || (fieldPathKey(left) < fieldPathKey(right) ? -1 : 1),
  )
  const accepted: FieldPath[] = []
  for (const path of ordered) {
    if (!accepted.some((ancestor) => isAncestorFieldPath(ancestor, path))) accepted.push(path)
  }
  return { kind: "ok", paths: accepted }
}

function dedupePaths(paths: readonly FieldPath[]): FieldPath[] {
  const byKey = new Map<string, FieldPath>()
  for (const path of paths) byKey.set(fieldPathKey(path), path)
  return [...byKey.values()]
}

function sortPaths(paths: readonly FieldPath[]): FieldPath[] {
  return [...paths].sort((left, right) => (fieldPathKey(left) < fieldPathKey(right) ? -1 : 1))
}

// --- structural splice (in place over an owned deep clone) -----------------

function cloneTree(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(cloneTree)
  if (isRecordValue(value)) {
    const copy: Record<string, unknown> = {}
    for (const key of Object.keys(value)) copy[key] = cloneTree(value[key])
    return copy
  }
  return value
}

type SpliceOutcome =
  | { readonly kind: "ok" }
  | { readonly kind: "issue"; readonly issue: RebaseIssue }

function assignAt(tree: unknown, path: FieldPath, value: unknown): SpliceOutcome {
  let cursor: unknown = tree
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
    const key = String(last)
    cursor[key] = value
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

function deleteAt(tree: unknown, path: FieldPath): SpliceOutcome {
  let cursor: unknown = tree
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
    // Item removal is a whole-list edit upstream (length granularity); a
    // delete at item depth would silently shift indices — defended, not
    // reachable through the adjudication rules.
    return { kind: "issue", issue: spliceGap(path, "list item deletion is a whole-list edit") }
  }
  return { kind: "issue", issue: spliceGap(path, "parent container vanished") }
}

function spliceGap(path: FieldPath, detail: string): RebaseIssue {
  return { code: "SPLICE_GAP", path: displayPath(path), detail }
}

function displayPath(path: FieldPath): string {
  return path
    .map((segment, index) =>
      typeof segment === "number"
        ? `[${segment}]`
        : index === 0
          ? String(segment)
          : `.${String(segment)}`,
    )
    .join("")
}

function isRecord(node: unknown): node is Record<string, unknown> {
  return typeof node === "object" && node !== null && !Array.isArray(node)
}

function isRecordValue(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function mapIssues(
  issues: readonly { code: string; path?: string; detail?: string }[],
): RebaseIssue[] {
  return issues.map((issue) => ({
    code: issue.code as RebaseIssueCode,
    ...(issue.path === undefined ? {} : { path: issue.path }),
    ...(issue.detail === undefined ? {} : { detail: issue.detail }),
  }))
}
