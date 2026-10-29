/**
 * Conflict freeze model (P2.9 — ADR-0004 P2.9 appendix).
 * Pure, no DOM, no React, no transport.
 *
 * Laws enforced here:
 *  - Frozen paths are MINIMAL COMMON NODES (a row may be a whole list or
 *    parent object, not a leaf).
 *  - Contested subtrees are rendered as plain text (ADR-0006 trust policy).
 *  - Decisions edit the form only; Save stays blocked until all rows are decided.
 *  - Path mutations use the value-domain writers (writeAtFieldPath/deleteAtFieldPath).
 *  - Late keystrokes typed while saving replay onto the reconciled tree
 *    (keystrokes-onto-chosen, never chosen-over-keystrokes).
 */
import type { FieldDescriptor, FieldPath } from "@mycms/core"
import {
  computeDirtyPaths,
  deleteAtFieldPath,
  fieldPathKey,
  parseUntrustedJson,
  writeAtFieldPath,
} from "@mycms/core"

export interface FreezeRow {
  readonly path: FieldPath
  readonly key: string
  readonly label: string
  readonly theirsRaw: string
  readonly mineRaw: string
  readonly theirsValue: unknown
  readonly mineValue: unknown
  readonly choice?: "theirs" | "mine"
}

export interface CreateFreezeRowsInput {
  readonly frozenFieldPaths: readonly FieldPath[]
  readonly remoteRaw: string
  readonly mineTree: Readonly<Record<string, unknown>>
  readonly fields?: readonly FieldDescriptor[]
  readonly initialChoices?: ReadonlyMap<string, "theirs" | "mine">
}

/**
 * Reads a subtree at `path` from `tree`. Returns `undefined` if the path
 * does not exist.
 */
export function readAtFieldPath(tree: unknown, path: FieldPath): unknown {
  let cursor: unknown = tree
  for (const segment of path) {
    if (cursor === null || typeof cursor !== "object") return undefined
    if (Array.isArray(cursor)) {
      if (typeof segment !== "number") return undefined
      cursor = cursor[segment]
    } else {
      const key = String(segment)
      if (!Object.hasOwn(cursor, key)) return undefined
      cursor = (cursor as Record<string, unknown>)[key]
    }
  }
  return cursor
}

/**
 * Serializes a subtree as plain text for safe rendering (plain text node law).
 */
export function formatSubtreeForDisplay(value: unknown): string {
  if (value === undefined) return "(empty)"
  if (value === null) return "null"
  if (typeof value === "string") return value
  if (typeof value === "number" || typeof value === "boolean") return String(value)
  return JSON.stringify(value, null, 2)
}

/**
 * Derives a human-friendly label for a field path. Modeled root fields use
 * their configured label; nested paths and lists reflect their path structure.
 */
export function formatFieldPathLabel(path: FieldPath, fields?: readonly FieldDescriptor[]): string {
  if (path.length === 0) return "entry"
  const first = path[0]
  const rootField =
    typeof first === "string"
      ? fields?.find((f) => f.type !== "divider" && f.name === first)
      : undefined
  const rootLabel =
    rootField !== undefined && "label" in rootField && typeof rootField.label === "string"
      ? rootField.label
      : String(first)
  if (path.length === 1) return rootLabel

  const rest = path
    .slice(1)
    .map((seg) => (typeof seg === "number" ? `[${seg}]` : `.${seg}`))
    .join("")
  return `${rootLabel}${rest}`
}

/**
 * Projects `frozenFieldPaths` into freeze rows comparing remote and local values.
 */
export function createFreezeRows(input: CreateFreezeRowsInput): readonly FreezeRow[] {
  const parsedRemote = parseUntrustedJson(input.remoteRaw)
  const remoteTree = parsedRemote.ok ? parsedRemote.value : undefined

  return input.frozenFieldPaths.map((path) => {
    const key = fieldPathKey(path)
    const label = formatFieldPathLabel(path, input.fields)
    const theirsValue = remoteTree === undefined ? undefined : readAtFieldPath(remoteTree, path)
    const mineValue = readAtFieldPath(input.mineTree, path)
    return {
      path,
      key,
      label,
      theirsRaw: formatSubtreeForDisplay(theirsValue),
      mineRaw: formatSubtreeForDisplay(mineValue),
      theirsValue,
      mineValue,
      choice: input.initialChoices?.get(key),
    }
  })
}

/**
 * Applies a single choice ("theirs" or "mine") onto a tree via the core
 * path writers.
 */
export function applyFreezeChoice(
  tree: Readonly<Record<string, unknown>>,
  row: FreezeRow,
  choice: "theirs" | "mine",
): Readonly<Record<string, unknown>> {
  const chosenValue = choice === "theirs" ? row.theirsValue : row.mineValue
  if (chosenValue === undefined) {
    const res = deleteAtFieldPath(tree, row.path)
    return res.ok && isRecord(res.tree) ? res.tree : tree
  }
  const res = writeAtFieldPath(tree, row.path, chosenValue)
  return res.ok && isRecord(res.tree) ? res.tree : tree
}

/**
 * Applies all decided rows onto the base tree.
 */
export function applyAllFreezeChoices(
  initialTree: Readonly<Record<string, unknown>>,
  rows: readonly FreezeRow[],
): Readonly<Record<string, unknown>> {
  let tree = initialTree
  for (const row of rows) {
    if (row.choice !== undefined) {
      tree = applyFreezeChoice(tree, row, row.choice)
    }
  }
  return tree
}

/**
 * True iff every frozen row has a decision ("theirs" or "mine").
 */
export function allFreezeRowsDecided(rows: readonly FreezeRow[]): boolean {
  return rows.length > 0 && rows.every((row) => row.choice !== undefined)
}

/**
 * Replays late edits typed into `liveFormTree` since `baseMineTree` onto
 * `reconciledTree`.
 *
 * ADR-0004 P2.9 law: "replay direction is always keystrokes-onto-chosen,
 * never chosen-over-keystrokes, so no keystroke is lost."
 */
export function replayLateKeystrokes(input: {
  readonly baseMineTree: Readonly<Record<string, unknown>>
  readonly liveFormTree: Readonly<Record<string, unknown>>
  readonly reconciledTree: Readonly<Record<string, unknown>>
}): Readonly<Record<string, unknown>> {
  const { baseMineTree, liveFormTree, reconciledTree } = input
  const lateDirtyPaths = computeDirtyPaths(liveFormTree, baseMineTree)
  if (lateDirtyPaths.length === 0) return reconciledTree

  let result = reconciledTree
  for (const path of lateDirtyPaths) {
    const lateVal = readAtFieldPath(liveFormTree, path)
    if (lateVal === undefined) {
      const deleted = deleteAtFieldPath(result, path)
      if (deleted.ok && isRecord(deleted.tree)) result = deleted.tree
    } else {
      const written = writeAtFieldPath(result, path, lateVal)
      if (written.ok && isRecord(written.tree)) result = written.tree
    }
  }
  return result
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
