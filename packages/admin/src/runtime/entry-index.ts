/**
 * Read-side entry index — the P1 ServicesProvider stand-in (ADR-0009).
 *
 * One tree snapshot becomes a collection-grouped index. Each content document is
 * parsed leniently, relation values are checked against the whole index, and
 * unmodeled keys stay in `untouched` for display/preservation. No writes, no
 * defaults injected, no second serializer.
 */

import type {
  AdminConfig,
  FieldDescriptor,
  FilesCollectionDescriptor,
  FolderCollectionDescriptor,
  GitBackend,
  JsonValue,
  ParseIssue,
  TreeRead,
} from "patcms/advanced"
import {
  compareText,
  decodeUtf8,
  parseEntry,
  parseUntrustedJson,
  validateEntryForSave,
} from "patcms/advanced"

export interface IndexedEntry {
  readonly collectionName: string
  readonly collection: FolderCollectionDescriptor | FilesCollectionDescriptor
  readonly path: string
  readonly slug: string
  readonly title: string
  readonly fields: readonly FieldDescriptor[]
  readonly media: AdminConfig["media"]
  readonly raw: Readonly<Record<string, unknown>>
  readonly value: Readonly<Record<string, unknown>>
  readonly issues: readonly ParseIssue[]
  readonly untouched: Readonly<Record<string, JsonValue>>
  /** Decoded source bytes — the editor's `baseRaw` for rebase + compose (P2.6). */
  readonly rawText: string
  readonly blobSha: string
}

export interface EntryIndex {
  readonly entries: readonly IndexedEntry[]
  readonly byCollection: ReadonlyMap<string, readonly IndexedEntry[]>
  readonly byPath: ReadonlyMap<string, IndexedEntry>
  readonly bySlug: ReadonlyMap<string, ReadonlyMap<string, IndexedEntry>>
}

interface EntrySource {
  readonly collectionName: string
  readonly collection: FolderCollectionDescriptor | FilesCollectionDescriptor
  readonly path: string
  readonly slug: string
  readonly fallbackTitle: string
  readonly fields: readonly FieldDescriptor[]
  readonly identifier?: string
  readonly media: AdminConfig["media"]
  readonly blobSha: string
}

export interface LoadEntryIndexOptions {
  readonly config: AdminConfig
  readonly tree: TreeRead
  readonly backend: GitBackend
  readonly branch: string
}

export async function loadEntryIndex(options: LoadEntryIndexOptions): Promise<EntryIndex> {
  const sources = collectSources(options.config, options.tree)
  const preliminary = await Promise.all(sources.map((source) => loadSource(source, options)))

  const slugs = new Map<string, Map<string, IndexedEntry>>()
  for (const entry of preliminary) {
    let collection = slugs.get(entry.collectionName)
    if (collection === undefined) {
      collection = new Map()
      slugs.set(entry.collectionName, collection)
    }
    collection.set(entry.slug, entry)
  }

  const services = {
    hasEntry: (collection: string, value: string): boolean =>
      slugs.get(collection)?.has(value) === true,
  }

  const validated = await Promise.all(
    preliminary.map(async (entry) => {
      const validation = await validateEntryForSave({
        fields: entry.fields,
        raw: entry.raw,
        filePath: entry.path,
        media: entry.media,
        services,
      })
      const issues = validation.ok ? entry.issues : mergeIssues(entry.issues, validation.issues)
      return { ...entry, issues }
    }),
  )

  const byCollection = new Map<string, IndexedEntry[]>()
  const byPath = new Map<string, IndexedEntry>()
  const bySlug = new Map<string, Map<string, IndexedEntry>>()
  for (const entry of validated) {
    const list = byCollection.get(entry.collectionName) ?? []
    list.push(entry)
    byCollection.set(entry.collectionName, list)
    byPath.set(entry.path, entry)
    const collectionSlugs = bySlug.get(entry.collectionName) ?? new Map<string, IndexedEntry>()
    collectionSlugs.set(entry.slug, entry)
    bySlug.set(entry.collectionName, collectionSlugs)
  }
  for (const list of byCollection.values()) {
    list.sort((left, right) => compareText(left.title, right.title))
  }

  return {
    entries: validated,
    byCollection,
    byPath,
    bySlug,
  }
}

function collectSources(config: AdminConfig, tree: TreeRead): EntrySource[] {
  const treeByPath = new Map(tree.entries.map((entry) => [entry.path, entry]))
  const sources: EntrySource[] = []
  const seen = new Set<string>()

  for (const collection of config.collections) {
    if (collection.kind === "divider") continue
    if (collection.kind === "folder") {
      const prefix = `${collection.folder.replace(/\/+$/, "")}/`
      for (const entry of tree.entries) {
        if (!entry.path.startsWith(prefix) || !entry.path.endsWith(".json")) continue
        const remainder = entry.path.slice(prefix.length)
        if (remainder.length === 0 || remainder.includes("/")) continue
        if (seen.has(entry.path)) continue
        seen.add(entry.path)
        sources.push({
          collectionName: collection.name,
          collection,
          path: entry.path,
          slug: fileSlug(entry.path),
          fallbackTitle: fileSlug(entry.path),
          fields: collection.fields,
          ...(collection.identifierField === undefined
            ? {}
            : { identifier: collection.identifierField }),
          media: collection.media ?? config.media,
          blobSha: entry.sha,
        })
      }
      continue
    }

    for (const file of collection.files) {
      const treeEntry = treeByPath.get(file.file)
      if (treeEntry === undefined || seen.has(file.file)) continue
      seen.add(file.file)
      sources.push({
        collectionName: collection.name,
        collection,
        path: file.file,
        slug: file.name,
        fallbackTitle: file.label,
        fields: file.fields,
        identifier: undefined,
        media: collection.media ?? config.media,
        blobSha: treeEntry.sha,
      })
    }
  }

  return sources
}

async function loadSource(
  source: EntrySource,
  options: LoadEntryIndexOptions,
): Promise<IndexedEntry> {
  const result = await options.backend.readFile(options.branch, source.path, source.blobSha)
  if (result.kind !== "file") {
    throw new Error(`could not read ${source.path}`)
  }
  const text = decodeUtf8(result.file.bytes)
  const parsed = parseUntrustedJson(text)
  let raw: Record<string, unknown> = {}
  const preIssues: ParseIssue[] = []

  if (!parsed.ok) {
    preIssues.push({
      path: "",
      code: "TYPE_MISMATCH",
      message: `File is not valid JSON: ${parsed.issues[0]?.detail ?? "unknown parse error"}`,
      severity: "error",
    })
  } else if (
    parsed.value === null ||
    typeof parsed.value !== "object" ||
    Array.isArray(parsed.value)
  ) {
    preIssues.push({
      path: "",
      code: "TYPE_MISMATCH",
      message: "Entry must be a JSON object",
      severity: "error",
    })
  } else {
    raw = parsed.value as Record<string, unknown>
  }

  const parsedEntry = parseEntry({
    fields: source.fields,
    raw,
    filePath: source.path,
    media: source.media,
  })
  const titleValue =
    source.identifier === undefined ? undefined : parsedEntry.value[source.identifier]
  const title =
    typeof titleValue === "string" && titleValue.length > 0 ? titleValue : source.fallbackTitle

  return {
    collectionName: source.collectionName,
    collection: source.collection,
    path: source.path,
    slug: source.slug,
    title,
    fields: source.fields,
    media: source.media,
    raw,
    value: parsedEntry.value,
    issues: [...preIssues, ...parsedEntry.issues],
    untouched: parsedEntry.untouched,
    rawText: text,
    blobSha: source.blobSha,
  }
}

function fileSlug(path: string): string {
  const file = path.slice(path.lastIndexOf("/") + 1)
  return file.endsWith(".json") ? file.slice(0, -5) : file
}

function mergeIssues(left: readonly ParseIssue[], right: readonly ParseIssue[]): ParseIssue[] {
  const merged = [...left]
  const seen = new Set(
    left.map((issue) => `${issue.path}\u0000${issue.code}\u0000${issue.message}`),
  )
  for (const issue of right) {
    const key = `${issue.path}\u0000${issue.code}\u0000${issue.message}`
    if (seen.has(key)) continue
    seen.add(key)
    merged.push(issue)
  }
  return merged
}

/** Counts used by the library drift chip and entry banner. */
export function issueCounts(entry: IndexedEntry): { errors: number; warnings: number } {
  let errors = 0
  let warnings = 0
  for (const issue of entry.issues) {
    if (issue.severity === "error") errors += 1
    else warnings += 1
  }
  return { errors, warnings }
}

/** Relation display lookup: valueField is the slug in the yve corpus. */
export function findRelationEntry(
  index: EntryIndex | undefined,
  collection: string,
  value: string,
): IndexedEntry | undefined {
  return index?.bySlug.get(collection)?.get(value)
}
