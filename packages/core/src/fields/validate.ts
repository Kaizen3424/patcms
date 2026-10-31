/**
 * Strict-save validator (P1 read-side surface) + safe untouched composition.
 * Parse stays lenient; save refuses any entry with error-level issues and
 * preserves unmodeled keys verbatim through JSON-Pointer composition.
 */
import type { JsonValue } from "../safety/untrusted-json"
import type { ParseEntryOptions, ParseIssue } from "./parse"
import { parseEntry } from "./parse"
import type { FieldDescriptor } from "./types"

export interface RelationServices {
  readonly hasEntry?: (collection: string, value: string) => boolean | Promise<boolean>
}

export interface EntryValidationOptions extends ParseEntryOptions {
  readonly services?: RelationServices
}

export type EntryValidationResult =
  | {
      readonly ok: true
      readonly value: Readonly<Record<string, unknown>>
      readonly untouched: Readonly<Record<string, JsonValue>>
    }
  | { readonly ok: false; readonly issues: readonly ParseIssue[] }

export async function validateEntryForSave(
  options: EntryValidationOptions,
): Promise<EntryValidationResult> {
  const parsed = parseEntry(options)
  const issues = [...parsed.issues]

  // Repair-on-save: missing hidden fields with default values are backfilled (ADR-0003 P3 addendum)
  const value = backfillHiddenDefaults(options.fields, parsed.value)

  if (options.services?.hasEntry !== undefined) {
    await checkRelations(options.fields, value, options.services, issues, "")
  }

  if (issues.some((issue) => issue.severity === "error")) {
    return { ok: false, issues }
  }
  return { ok: true, value, untouched: parsed.untouched }
}

function backfillHiddenDefaults(
  fields: readonly FieldDescriptor[],
  value: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...value }
  for (const field of fields) {
    if (field.type === "divider" || field.type === "slug") continue

    if (field.type === "hidden") {
      if (!Object.hasOwn(result, field.name) && field.defaultValue !== undefined) {
        result[field.name] = cloneJson(field.defaultValue)
      }
      continue
    }

    if (field.type === "object") {
      const child = result[field.name]
      if (isRecord(child)) {
        result[field.name] = backfillHiddenDefaults(field.fields, child)
      }
      continue
    }

    if (field.type === "list" && field.itemMode === "object") {
      const list = result[field.name]
      if (Array.isArray(list)) {
        result[field.name] = list.map((item) =>
          isRecord(item) ? backfillHiddenDefaults(field.fields, item) : item,
        )
      }
    }
  }
  return result
}

async function checkRelations(
  fields: readonly FieldDescriptor[],
  value: Readonly<Record<string, unknown>>,
  services: RelationServices,
  issues: ParseIssue[],
  basePath: string,
): Promise<void> {
  const hasEntry = services.hasEntry
  if (hasEntry === undefined) return

  for (const field of fields) {
    if (field.type === "divider") continue
    const path = basePath.length === 0 ? field.name : `${basePath}.${field.name}`
    if (!Object.hasOwn(value, field.name)) continue
    const raw = value[field.name]

    if (field.type === "relation") {
      const values = field.multiple === true ? (Array.isArray(raw) ? raw : []) : [raw]
      for (const [index, item] of values.entries()) {
        if (typeof item !== "string") continue
        try {
          if (!(await hasEntry(field.collection, item))) {
            issues.push({
              path: field.multiple === true ? `${path}[${index}]` : path,
              code: "RELATION_UNKNOWN",
              message: `${field.label} references a missing entry "${item}"`,
              severity: "error",
            })
          }
        } catch {
          issues.push({
            path: field.multiple === true ? `${path}[${index}]` : path,
            code: "RELATION_CHECK_FAILED",
            message: `${field.label} could not be checked`,
            severity: "error",
          })
        }
      }
    }

    if (field.type === "object" && isRecord(raw)) {
      await checkRelations(field.fields, raw, services, issues, path)
    }
    if (field.type === "list" && Array.isArray(raw)) {
      if (field.itemMode === "scalar") {
        const child = field.fields[0]
        if (child !== undefined && child.type === "relation") {
          for (const [index, item] of raw.entries()) {
            if (typeof item !== "string") continue
            try {
              if (!(await hasEntry(child.collection, item))) {
                issues.push({
                  path: `${path}[${index}]`,
                  code: "RELATION_UNKNOWN",
                  message: `${child.label} references a missing entry "${item}"`,
                  severity: "error",
                })
              }
            } catch {
              issues.push({
                path: `${path}[${index}]`,
                code: "RELATION_CHECK_FAILED",
                message: `${child.label} could not be checked`,
                severity: "error",
              })
            }
          }
        }
      } else {
        for (const [index, item] of raw.entries()) {
          if (isRecord(item)) {
            await checkRelations(field.fields, item, services, issues, `${path}[${index}]`)
          }
        }
      }
    }
  }
}

/**
 * Clones the parsed value and re-attaches untouched raw keys at their exact
 * JSON-Pointer paths. No Object.assign / recursive merge; every key is copied
 * explicitly and dangerous keys are refused.
 */
export function mergeUntouched(
  value: Readonly<Record<string, unknown>>,
  untouched: Readonly<Record<string, JsonValue>>,
): Record<string, unknown> {
  const root = cloneJson(value)
  if (!isRecord(root)) return {}
  for (const [pointer, raw] of Object.entries(untouched)) {
    if (!pointer.startsWith("/")) continue
    setPointer(root, pointer, cloneJson(raw))
  }
  return root
}

function setPointer(root: Record<string, unknown>, pointer: string, raw: unknown): void {
  const tokens = pointer
    .slice(1)
    .split("/")
    .map((token) => token.replace(/~1/g, "/").replace(/~0/g, "~"))
  if (tokens.length === 0) return
  let current: unknown = root

  for (let index = 0; index < tokens.length - 1; index += 1) {
    const token = tokens[index]
    const next = tokens[index + 1]
    if (token === undefined || next === undefined || isDangerousKey(token)) return

    if (Array.isArray(current)) {
      const arrayIndex = toIndex(token)
      if (arrayIndex === null) return
      const child = current[arrayIndex]
      if (!isRecord(child) && !Array.isArray(child)) {
        current[arrayIndex] = isIndex(next) ? [] : {}
      }
      current = current[arrayIndex]
      continue
    }

    if (!isRecord(current)) return
    if (
      !Object.hasOwn(current, token) ||
      (!isRecord(current[token]) && !Array.isArray(current[token]))
    ) {
      current[token] = isIndex(next) ? [] : {}
    }
    current = current[token]
  }

  const last = tokens[tokens.length - 1]
  if (last === undefined || isDangerousKey(last)) return
  if (Array.isArray(current)) {
    const arrayIndex = toIndex(last)
    if (arrayIndex !== null) current[arrayIndex] = raw
    return
  }
  if (!isRecord(current)) return
  Object.defineProperty(current, last, {
    value: raw,
    enumerable: true,
    configurable: true,
    writable: true,
  })
}

function cloneJson(value: unknown): unknown {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value
  }
  if (Array.isArray(value)) return value.map((item) => cloneJson(item))
  if (isRecord(value)) {
    const target: Record<string, unknown> = {}
    for (const key of Object.keys(value)) {
      if (isDangerousKey(key)) continue
      Object.defineProperty(target, key, {
        value: cloneJson(value[key]),
        enumerable: true,
        configurable: true,
        writable: true,
      })
    }
    return target
  }
  return undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isIndex(value: string): boolean {
  return /^\d+$/.test(value)
}

function toIndex(value: string): number | null {
  return isIndex(value) ? Number(value) : null
}

function isDangerousKey(key: string): boolean {
  return key === "__proto__" || key === "constructor" || key === "prototype"
}
