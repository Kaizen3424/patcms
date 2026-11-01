import { mustacheLite, safePath, safeUrl } from "patcms/advanced"

/**
 * Image source guard for repository-provided paths. P1 renders only the
 * repository's own media folder (`/images/**`); remote image hosts are rejected
 * outright, so no forbidden raw-content host can ever become an `src` value.
 */
export function imageSource(value: unknown, publicFolder: string): string | undefined {
  if (typeof value !== "string" || value.length === 0) return undefined
  const checked = safeUrl(value, { allowRelative: true })
  if (!checked.ok || !checked.value.startsWith("/")) return undefined
  const path = safePath(checked.value, { absolute: true, prefix: publicFolder })
  return path.ok ? path.value : undefined
}

/** Safe absolute preview URL from a collection template + site origin. */
export function previewUrl(
  template: string | undefined,
  values: Readonly<Record<string, unknown>>,
  siteUrl: string | undefined,
): string | undefined {
  if (template === undefined || siteUrl === undefined) return undefined
  try {
    const url = new URL(mustacheLite(template, values), siteUrl).toString()
    const checked = safeUrl(url)
    return checked.ok ? checked.value : undefined
  } catch {
    return undefined
  }
}
