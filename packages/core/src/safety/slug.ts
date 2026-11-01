/**
 * Slug is VIRTUAL: derived from the entry filename, never stored in JSON.
 * `src/content/products/iris-no-7.json` → `iris-no-7`.
 */

export function deriveSlug(filePath: string): string | null {
  const normalized = filePath.replace(/\\/g, "/")
  const segment = normalized.slice(normalized.lastIndexOf("/") + 1)
  if (!segment.toLowerCase().endsWith(".json")) return null
  const slug = segment.slice(0, -".json".length)
  if (slug.length === 0 || slug === "." || slug === "..") return null
  if (slug.includes("/") || slug.includes("\\")) return null
  return slug
}

/**
 * Proposes a filename-safe slug from arbitrary text (usually the identifier
 * field). ASCII-folded and lowercased so the result is always a valid repo
 * path segment; non-Latin text that folds to nothing becomes `"entry"`, which
 * the caller can override with an explicit slug.
 */
export function slugify(input: string): string {
  const folded = input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
  return folded.length > 0 ? folded : "entry"
}
