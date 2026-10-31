import type { AdminConfig } from "@mycms/core"
import type { IndexedEntry } from "../runtime/entry-index"

export interface TextPart {
  readonly text: string
  readonly isMatch: boolean
}

export interface SearchResult {
  readonly id: string
  readonly collectionName: string
  readonly collectionLabel: string
  readonly slug: string
  readonly title: string
  readonly matchedField: string
  readonly snippetParts?: readonly TextPart[]
  readonly rawSnippet?: string
}

export interface SearchGroup {
  readonly collectionName: string
  readonly collectionLabel: string
  readonly results: readonly SearchResult[]
}

/**
 * Splits plain text into matching and non-matching segments for safe rendering.
 * Pure React elements only — zero dangerouslySetInnerHTML (01-spec §2.2).
 */
export function splitByMatch(text: string, query: string): readonly TextPart[] {
  const trimmed = query.trim()
  if (!trimmed || !text) {
    return [{ text, isMatch: false }]
  }

  const parts: TextPart[] = []
  const lowerText = text.toLowerCase()
  const lowerQuery = trimmed.toLowerCase()

  let lastIndex = 0
  let matchIndex = lowerText.indexOf(lowerQuery, lastIndex)

  while (matchIndex !== -1) {
    if (matchIndex > lastIndex) {
      parts.push({
        text: text.slice(lastIndex, matchIndex),
        isMatch: false,
      })
    }
    parts.push({
      text: text.slice(matchIndex, matchIndex + trimmed.length),
      isMatch: true,
    })
    lastIndex = matchIndex + trimmed.length
    matchIndex = lowerText.indexOf(lowerQuery, lastIndex)
  }

  if (lastIndex < text.length) {
    parts.push({
      text: text.slice(lastIndex),
      isMatch: false,
    })
  }

  return parts
}

/**
 * Creates a bounded snippet around the first occurrence of query.
 */
function extractSnippet(text: string, query: string, maxLength = 80): string {
  const lowerText = text.toLowerCase()
  const lowerQuery = query.toLowerCase()
  const matchIndex = lowerText.indexOf(lowerQuery)
  if (matchIndex === -1) {
    return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text
  }

  const start = Math.max(0, matchIndex - 25)
  const end = Math.min(text.length, matchIndex + query.length + 45)
  let snippet = text.slice(start, end)
  if (start > 0) snippet = `...${snippet}`
  if (end < text.length) snippet = `${snippet}...`
  return snippet
}

interface MatchCandidate {
  readonly fieldLabel: string
  readonly text: string
  readonly score: number
}

function collectCandidates(
  value: unknown,
  keyPrefix = "",
  candidates: MatchCandidate[] = [],
): MatchCandidate[] {
  if (value === null || value === undefined) return candidates

  if (typeof value === "string") {
    const text = value.trim()
    if (text.length > 0) {
      const lowerKey = keyPrefix.toLowerCase()
      let score = 1
      let fieldLabel = keyPrefix || "content"

      if (lowerKey.includes("title")) {
        score = 10
        fieldLabel = "Title"
      } else if (lowerKey.includes("price")) {
        score = 8
        fieldLabel = "Price"
      } else if (lowerKey.includes("material")) {
        score = 7
        fieldLabel = "Material"
      } else if (lowerKey.includes("alt")) {
        score = 6
        fieldLabel = "Photo description"
      } else if (lowerKey.includes("description") || lowerKey.includes("summary")) {
        score = 5
        fieldLabel = "Description"
      }

      candidates.push({ fieldLabel, text, score })
    }
    return candidates
  }

  if (typeof value === "number" || typeof value === "boolean") {
    const text = String(value)
    const lowerKey = keyPrefix.toLowerCase()
    const score = lowerKey.includes("price") ? 8 : 4
    const fieldLabel = lowerKey.includes("price") ? "Price" : keyPrefix || "Number"
    candidates.push({ fieldLabel, text, score })
    return candidates
  }

  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      collectCandidates(value[i], keyPrefix, candidates)
    }
    return candidates
  }

  if (typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      const nextKey = keyPrefix ? `${keyPrefix}.${key}` : key
      collectCandidates(child, nextKey, candidates)
    }
  }

  return candidates
}

/**
 * Searches all loaded entries in EntryIndex across collections.
 * Case-insensitive token-based matching over titles, prices/numbers,
 * materials, image alt descriptions, and text fields.
 */
export function searchIndex(
  query: string,
  entries: readonly IndexedEntry[],
  config: AdminConfig,
): readonly SearchGroup[] {
  const trimmed = query.trim()
  if (!trimmed) return []

  const tokens = trimmed.toLowerCase().split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return []

  const collectionLabels = new Map<string, string>()
  for (const col of config.collections) {
    if (col.kind !== "divider") {
      collectionLabels.set(col.name, col.label)
    }
  }

  const results: SearchResult[] = []

  for (const entry of entries) {
    const candidates = collectCandidates(entry.value)
    // Always include entry.title as high-priority candidate
    if (!candidates.some((c) => c.fieldLabel === "Title" && c.text === entry.title)) {
      candidates.unshift({ fieldLabel: "Title", text: entry.title, score: 10 })
    }

    // Check if entry matches all query tokens across any of its candidates
    const matchesAllTokens = tokens.every((token) =>
      candidates.some((candidate) => candidate.text.toLowerCase().includes(token)),
    )

    if (matchesAllTokens) {
      // Find the best matching candidate to feature as the snippet
      let bestCandidate: MatchCandidate | undefined
      for (const candidate of candidates) {
        const containsFullQuery = candidate.text.toLowerCase().includes(trimmed.toLowerCase())
        if (containsFullQuery) {
          if (!bestCandidate || candidate.score > bestCandidate.score) {
            bestCandidate = candidate
          }
        }
      }

      if (!bestCandidate) {
        // Fallback to highest-scoring candidate matching the first token
        const firstToken = tokens[0]
        if (firstToken) {
          for (const candidate of candidates) {
            if (candidate.text.toLowerCase().includes(firstToken)) {
              if (!bestCandidate || candidate.score > bestCandidate.score) {
                bestCandidate = candidate
              }
            }
          }
        }
      }

      const matchedField = bestCandidate ? bestCandidate.fieldLabel : "Content"
      const snippetText = bestCandidate ? extractSnippet(bestCandidate.text, trimmed) : undefined
      const snippetParts = snippetText ? splitByMatch(snippetText, trimmed) : undefined

      const collectionLabel =
        collectionLabels.get(entry.collectionName) || entry.collection.label || entry.collectionName

      results.push({
        id: `${entry.collectionName}:${entry.slug}`,
        collectionName: entry.collectionName,
        collectionLabel,
        slug: entry.slug,
        title: entry.title,
        matchedField,
        snippetParts,
        rawSnippet: snippetText,
      })
    }
  }

  // Group results by collection in order of appearance in config
  const grouped = new Map<string, SearchResult[]>()
  for (const result of results) {
    let group = grouped.get(result.collectionName)
    if (!group) {
      group = []
      grouped.set(result.collectionName, group)
    }
    group.push(result)
  }

  const output: SearchGroup[] = []
  for (const col of config.collections) {
    if (col.kind !== "divider") {
      const groupResults = grouped.get(col.name)
      if (groupResults && groupResults.length > 0) {
        output.push({
          collectionName: col.name,
          collectionLabel: col.label,
          results: groupResults,
        })
      }
    }
  }

  return output
}
