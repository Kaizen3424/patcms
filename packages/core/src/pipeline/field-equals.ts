/**
 * `fieldEquals` — VALUE-domain equality (ADR-0004 appendix).
 *
 * Dirty decisions are made against VALUES, never bytes:
 * - strings are codepoint-exact (`é` vs `e\u0301` differ),
 * - records ignore author key ORDER (reformatting is not an edit),
 * - arrays are order-significant and compared per index ("lists per item").
 */

export function fieldEquals(left: unknown, right: unknown): boolean {
  if (left === right) return true
  if (typeof left !== typeof right) return false
  if (left === null || right === null) return false
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false
    return left.every((item, index) => fieldEquals(item, right[index]))
  }
  if (isRecord(left) && isRecord(right)) {
    const rightKeys = derivedKeys(right)
    if (derivedKeys(left).length !== rightKeys.length) return false
    for (const key of derivedKeys(left)) {
      if (!Object.hasOwn(right, key)) return false
      if (!fieldEquals(left[key], right[key])) return false
    }
    return true
  }
  return false
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function derivedKeys(record: Record<string, unknown>): string[] {
  return Object.keys(record)
}
