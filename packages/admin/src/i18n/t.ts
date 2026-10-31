import { fillLine } from "../editor/copy"

/**
 * Type-safe string interpolation helper (P5.6).
 * Safely replaces {placeholder} tokens in templates using split/join.
 * Never uses regex, ensuring values with `$` characters (e.g. prices) are treated as literal text.
 */
export function t(template: string, values?: Readonly<Record<string, string | number>>): string {
  if (!values) return template
  const stringValues: Record<string, string> = {}
  for (const [key, value] of Object.entries(values)) {
    stringValues[key] = String(value)
  }
  return fillLine(template, stringValues)
}
