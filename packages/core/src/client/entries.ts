/**
 * Entries — the read model plus create/save/delete/validate.
 *
 * The read model is ported from the reference admin's `entry-index.ts`, minus
 * the UI caches: one tree snapshot is grouped by collection, every document is
 * parsed leniently, and unmodeled keys stay in `untouched` so a save can
 * preserve them byte-for-byte.
 *
 * Write law: a save is optimistic at the FILE level first (the tree sha the
 * editor loaded must still be the head's sha), then transactional at the repo
 * level (`runSave` CAS). A conflict is a value, never an exception.
 */
import { gitBlobSha } from "../backend/git-sha"
import type { TreeEntryTuple, TreeRead } from "../backend/types"
import type { BackendWriteError } from "../backend/write-errors"
import type {
  AdminConfig,
  FilesCollectionDescriptor,
  FolderCollectionDescriptor,
  MediaFolders,
} from "../config/types"
import type { ParseIssue } from "../fields/parse"
import { parseEntry } from "../fields/parse"
import type { FieldDescriptor } from "../fields/types"
import type { RelationServices } from "../fields/validate"
import { validateEntryForSave } from "../fields/validate"
import type { SearchableEntry } from "../media/references"
import type { SaveVerdict } from "../pipeline/save-driver"
import { compareText, compareValues } from "../safety/collator"
import { decodeUtf8, encodeUtf8 } from "../safety/encoding"
import { safePath } from "../safety/safe-path"
import { slugify } from "../safety/slug"
import type { JsonValue } from "../safety/untrusted-json"
import { parseUntrustedJson } from "../safety/untrusted-json"
import type { JsonDocument } from "../serialization/document"
import { parseJsonDocument } from "../serialization/document"
import { composeEntryDocument } from "../serialization/entry-document"
import type { ClientCache } from "./cache"
import { CMSError, toCMSError } from "./errors"
import type { RepoReader } from "./repo"
import type {
  CreateOptions,
  DeleteOptions,
  DeleteResult,
  EntriesAPI,
  Entry,
  EntryStub,
  EntrySummary,
  EntryValue,
  ListOptions,
  SaveOptions,
  SaveResult,
  ValidationResult,
} from "./types"

type CollectionDescriptor = FolderCollectionDescriptor | FilesCollectionDescriptor

interface EntrySource {
  readonly collectionName: string
  readonly collection: CollectionDescriptor
  readonly path: string
  readonly slug: string
  readonly fallbackTitle: string
  readonly fields: readonly FieldDescriptor[]
  readonly identifier?: string
  readonly media: MediaFolders
  readonly blobSha: string
}

export interface EntriesClientOptions {
  readonly config: AdminConfig
  readonly repo: RepoReader
  readonly cache: ClientCache
  /** Called when GitHub rejects the token mid-write; the client signs out. */
  readonly onAuthExpired: () => void
}

export class EntriesClient implements EntriesAPI {
  readonly #config: AdminConfig
  readonly #repo: RepoReader
  readonly #cache: ClientCache
  readonly #onAuthExpired: () => void

  constructor(options: EntriesClientOptions) {
    this.#config = options.config
    this.#repo = options.repo
    this.#cache = options.cache
    this.#onAuthExpired = options.onAuthExpired
  }

  async list(collection: string, options: ListOptions = {}): Promise<EntrySummary[]> {
    const { sources, services } = await this.#snapshot(collection)
    const entries = await Promise.all(sources.map((source) => this.#read(source, services)))
    const direction = options.direction ?? "asc"
    const sortField = options.sort
    entries.sort((left, right) =>
      sortField === undefined
        ? compareValues(left.title, right.title, direction)
        : compareValues(left.value[sortField], right.value[sortField], direction),
    )
    return entries
  }

  async listPaths(collection: string): Promise<EntryStub[]> {
    const { sources } = await this.#snapshot(collection)
    return sources
      .map((source) => ({
        collection: source.collectionName,
        slug: source.slug,
        path: source.path,
        sha: source.blobSha,
        title: source.fallbackTitle,
      }))
      .sort((left, right) => compareText(left.title, right.title))
  }

  async get(collection: string, slug: string): Promise<Entry> {
    const { source, services } = await this.#findSource(collection, slug)
    const cached = this.#cache.getEntry(source.path, source.blobSha)
    if (cached !== undefined) return cached
    const entry = await this.#read(source, services)
    this.#cache.putEntry(entry)
    return entry
  }

  async create(
    collection: string,
    value: EntryValue,
    options: CreateOptions = {},
  ): Promise<SaveResult> {
    const descriptor = this.#folderCollection(collection)
    if (descriptor.create === false) {
      throw new CMSError("UNSUPPORTED", `collection "${collection}" does not allow new entries`)
    }

    const slug = normalizeSlug(options.slug ?? this.slugFromValue(collection, value))
    const path = assertInsideFolder(`${descriptor.folder}/${slug}.json`, descriptor.folder)
    const { tree, services } = await this.#snapshot(collection)

    const existing = findTreeEntry(tree, path)
    if (existing !== undefined) {
      const source = this.#sourceFor(descriptor, path, slug, slug, existing)
      return {
        status: "conflict",
        current: await this.#read(source, services),
        local: value,
      }
    }

    const validation = await validateEntryForSave({
      fields: descriptor.fields,
      raw: value,
      filePath: path,
      media: descriptor.media ?? this.#config.media,
      services,
    })
    if (!validation.ok) {
      throw new CMSError("VALIDATION", "new entry has validation errors", {
        issues: validation.issues,
      })
    }

    const composed = composeEntryDocument({
      fields: descriptor.fields,
      value: validation.value,
      untouched: {},
      document: emptyDocument(),
    })
    const bytes = encodeUtf8(composed.raw)
    const blobSha = await gitBlobSha(bytes)
    const verdict = await this.#repo.save(
      { adds: [{ path, bytes }] },
      options.message,
      this.#afterWriteFailure,
    )

    if (verdict.kind === "conflict") {
      const current = await this.#currentEntry(descriptor, path, slug, slug)
      return { status: "conflict", current, local: value }
    }
    if (verdict.kind === "published") {
      this.#cache.dropEntry(path)
      const source = this.#sourceFor(descriptor, path, slug, slug, {
        path,
        sha: blobSha,
        mode: "100644",
        type: "blob",
      })
      const saved = await this.#readFresh(source, composed.raw, blobSha)
      this.#cache.putEntry(saved)
      return { status: "saved", commitSha: verdict.commitSha, entry: saved }
    }
    if (verdict.kind === "noop") {
      const source = this.#sourceFor(descriptor, path, slug, slug, {
        path,
        sha: blobSha,
        mode: "100644",
        type: "blob",
      })
      return { status: "noop", entry: await this.#readFresh(source, composed.raw, blobSha) }
    }
    throw this.#verdictError(verdict)
  }

  async save(entry: Entry, value: EntryValue, options: SaveOptions = {}): Promise<SaveResult> {
    const source = this.#sourceOf(entry)
    let base = entry
    let retried = false

    while (true) {
      const { tree, services } = await this.#snapshot(entry.collection)
      const current = findTreeEntry(tree, base.path)
      if (current === undefined) {
        throw new CMSError("CONFLICT", `"${base.path}" was deleted by someone else`)
      }
      if (current.sha !== base.sha) {
        const fresh = await this.#read({ ...source, blobSha: current.sha }, services)
        return { status: "conflict", current: fresh, local: value }
      }

      const validation = await validateEntryForSave({
        fields: base.fields,
        raw: value,
        filePath: base.path,
        media: base.media,
        services,
      })
      if (!validation.ok) {
        throw new CMSError("VALIDATION", "entry has validation errors", {
          issues: validation.issues,
        })
      }

      const composed = this.#compose(base, validation.value, base.untouched)
      if (composed.raw === base.raw) return { status: "noop", entry: base }

      const bytes = encodeUtf8(composed.raw)
      const blobSha = await gitBlobSha(bytes)
      const verdict = await this.#repo.save(
        { updates: [{ path: base.path, bytes }] },
        options.message,
        this.#afterWriteFailure,
      )

      if (verdict.kind === "published") {
        this.#cache.dropEntry(base.path)
        const raw = verdict.reconciliation?.reconciledRaw ?? composed.raw
        const sha =
          verdict.reconciliation === undefined
            ? blobSha
            : await gitBlobSha(encodeUtf8(verdict.reconciliation.reconciledRaw))
        const saved = await this.#readFresh({ ...source, blobSha: sha }, raw, sha)
        this.#cache.putEntry(saved)
        return { status: "saved", commitSha: verdict.commitSha, entry: saved }
      }

      if (verdict.kind === "noop") {
        const raw = verdict.reconciliation?.reconciledRaw ?? composed.raw
        const sha =
          verdict.reconciliation === undefined
            ? blobSha
            : await gitBlobSha(encodeUtf8(verdict.reconciliation.reconciledRaw))
        const saved = await this.#readFresh({ ...source, blobSha: sha }, raw, sha)
        this.#cache.putEntry(saved)
        return { status: "noop", entry: saved }
      }

      if (verdict.kind === "conflict") {
        // An unrelated remote change (another entry) is retried once against
        // the fresh base; a change to OUR file is a real conflict.
        if (!retried && !verdict.details.changed.has(base.path)) {
          retried = true
          const freshTree = await this.#repo.tree()
          const freshEntry = findTreeEntry(freshTree, base.path)
          if (freshEntry === undefined) {
            throw new CMSError("CONFLICT", `"${base.path}" was deleted by someone else`)
          }
          base = await this.#read({ ...source, blobSha: freshEntry.sha }, this.#services(freshTree))
          continue
        }
        const currentEntry = await this.#currentEntry(
          source.collection,
          base.path,
          source.slug,
          source.fallbackTitle,
        )
        return { status: "conflict", current: currentEntry, local: value }
      }

      throw this.#verdictError(verdict)
    }
  }

  async delete(entry: Entry, options: DeleteOptions = {}): Promise<DeleteResult> {
    const descriptor = this.#collectionFor(entry.collection)
    if (descriptor.kind === "folder" && descriptor.delete === false) {
      throw new CMSError("UNSUPPORTED", `collection "${entry.collection}" does not allow deletes`)
    }

    const tree = await this.#repo.tree()
    const current = findTreeEntry(tree, entry.path)
    if (current === undefined) return { status: "noop" }
    if (current.sha !== entry.sha) {
      const fresh = await this.#currentEntry(descriptor, entry.path, entry.slug, entry.slug)
      return { status: "conflict", current: fresh }
    }

    const verdict = await this.#repo.save(
      { deletes: [entry.path] },
      options.message,
      this.#afterWriteFailure,
    )
    if (verdict.kind === "published") {
      this.#cache.dropEntry(entry.path)
      return { status: "deleted", commitSha: verdict.commitSha }
    }
    if (verdict.kind === "noop") return { status: "noop" }
    if (verdict.kind === "conflict") {
      const fresh = await this.#currentEntry(descriptor, entry.path, entry.slug, entry.slug)
      return { status: "conflict", current: fresh }
    }
    throw this.#verdictError(verdict)
  }

  async validate(entry: Entry, value: EntryValue): Promise<ValidationResult> {
    const { services } = await this.#snapshot(entry.collection)
    const validation = await validateEntryForSave({
      fields: entry.fields,
      raw: value,
      filePath: entry.path,
      media: entry.media,
      services,
    })
    return validation.ok ? { ok: true } : { ok: false, issues: validation.issues }
  }

  /**
   * Every entry value in the repository, for referential-integrity scans.
   * Internal to the client (media delete/restore); not part of `EntriesAPI`.
   */
  async searchable(): Promise<readonly SearchableEntry[]> {
    const tree = await this.#repo.tree()
    const services = this.#services(tree)
    const entries = await Promise.all(
      collectSources(this.#config, tree).map((source) => this.#read(source, services)),
    )
    return entries.map((entry) => ({
      collection: entry.collection,
      slug: entry.slug,
      title: entry.title,
      value: entry.value,
    }))
  }

  path(collection: string, slug: string): string {
    const descriptor = this.#collectionFor(collection)
    if (descriptor.kind === "files") {
      const file = descriptor.files.find((candidate) => candidate.name === slug)
      if (file === undefined) {
        throw new CMSError("NOT_FOUND", `collection "${collection}" has no document "${slug}"`)
      }
      return file.file
    }
    return assertInsideFolder(`${descriptor.folder}/${normalizeSlug(slug)}.json`, descriptor.folder)
  }

  slugFromValue(collection: string, value: EntryValue): string {
    const descriptor = this.#collectionFor(collection)
    if (descriptor.kind === "files") {
      throw new CMSError("UNSUPPORTED", `collection "${collection}" stores single documents`)
    }
    const identifier = descriptor.identifierField
    if (identifier === undefined) return "entry"
    const raw = value[identifier]
    if (typeof raw !== "string" || raw.trim().length === 0) return "entry"
    return slugify(raw)
  }

  // ---- reads -------------------------------------------------------------

  async #snapshot(collection: string): Promise<{
    readonly tree: TreeRead
    readonly sources: readonly EntrySource[]
    readonly services: RelationServices
  }> {
    this.#collectionFor(collection)
    const tree = await this.#repo.tree()
    const sources = collectSources(this.#config, tree).filter(
      (source) => source.collectionName === collection,
    )
    return { tree, sources, services: this.#services(tree) }
  }

  async #findSource(
    collection: string,
    slug: string,
  ): Promise<{
    readonly source: EntrySource
    readonly services: RelationServices
  }> {
    const { sources, services } = await this.#snapshot(collection)
    const source = sources.find((candidate) => candidate.slug === slug)
    if (source === undefined) {
      throw new CMSError("NOT_FOUND", `no entry "${slug}" in collection "${collection}"`)
    }
    return { source, services }
  }

  #sourceOf(entry: Entry): EntrySource {
    const descriptor = this.#collectionFor(entry.collection)
    const tuple: TreeEntryTuple = {
      path: entry.path,
      sha: entry.sha,
      mode: "100644",
      type: "blob",
    }
    return descriptor.kind === "folder"
      ? this.#sourceFor(descriptor, entry.path, entry.slug, entry.title, tuple)
      : this.#filesSourceFor(descriptor, entry.path, entry.slug, entry.title, tuple)
  }

  async #read(source: EntrySource, services: RelationServices): Promise<Entry> {
    let bytes: Uint8Array
    try {
      bytes = await this.#repo.readFile(source.path, source.blobSha)
    } catch (error) {
      throw toCMSError(error)
    }
    return this.#build(source, decodeUtf8(bytes), source.blobSha, services)
  }

  /** Reads bytes that were just written (no tree lookup, no stale sha). */
  async #readFresh(source: EntrySource, rawText: string, sha: string): Promise<Entry> {
    const tree = await this.#repo.tree()
    return this.#build(source, rawText, sha, this.#services(tree))
  }

  async #currentEntry(
    descriptor: CollectionDescriptor,
    path: string,
    slug: string,
    fallbackTitle: string,
  ): Promise<Entry> {
    const tree = await this.#repo.tree()
    const tuple = findTreeEntry(tree, path)
    if (tuple === undefined) {
      throw new CMSError("CONFLICT", `"${path}" no longer exists`)
    }
    const source =
      descriptor.kind === "folder"
        ? this.#sourceFor(descriptor, path, slug, fallbackTitle, tuple)
        : this.#filesSourceFor(descriptor, path, slug, fallbackTitle, tuple)
    return this.#read(source, this.#services(tree))
  }

  async #build(
    source: EntrySource,
    rawText: string,
    sha: string,
    services: RelationServices,
  ): Promise<Entry> {
    const parsed = parseUntrustedJson(rawText)
    let raw: Record<string, unknown> = {}
    const preIssues: ParseIssue[] = []

    if (!parsed.ok) {
      preIssues.push({
        path: "",
        code: "TYPE_MISMATCH",
        message: `File is not valid JSON: ${parsed.issues[0]?.detail ?? "unknown parse error"}`,
        severity: "error",
      })
    } else if (!isRecord(parsed.value)) {
      preIssues.push({
        path: "",
        code: "TYPE_MISMATCH",
        message: "Entry must be a JSON object",
        severity: "error",
      })
    } else {
      raw = parsed.value
    }

    const parsedEntry = parseEntry({
      fields: source.fields,
      raw,
      filePath: source.path,
      media: source.media,
    })

    let issues: readonly ParseIssue[] = [...preIssues, ...parsedEntry.issues]
    if (preIssues.length === 0) {
      const validation = await validateEntryForSave({
        fields: source.fields,
        raw,
        filePath: source.path,
        media: source.media,
        services,
      })
      if (!validation.ok) issues = mergeIssues(issues, validation.issues)
    }

    const titleValue =
      source.identifier === undefined ? undefined : parsedEntry.value[source.identifier]
    const title =
      typeof titleValue === "string" && titleValue.length > 0 ? titleValue : source.fallbackTitle

    return {
      collection: source.collectionName,
      slug: source.slug,
      path: source.path,
      sha,
      title,
      value: parsedEntry.value,
      issues,
      raw: rawText,
      untouched: parsedEntry.untouched,
      fields: source.fields,
      media: source.media,
    }
  }

  // ---- helpers -----------------------------------------------------------

  #services(tree: TreeRead): RelationServices {
    const slugs = new Map<string, Set<string>>()
    for (const source of collectSources(this.#config, tree)) {
      let set = slugs.get(source.collectionName)
      if (set === undefined) {
        set = new Set()
        slugs.set(source.collectionName, set)
      }
      set.add(source.slug)
    }
    return {
      hasEntry: (collection: string, value: string): boolean =>
        slugs.get(collection)?.has(value) === true,
    }
  }

  #compose(
    entry: Entry,
    value: Readonly<Record<string, unknown>>,
    untouched: Readonly<Record<string, JsonValue>>,
  ): { readonly raw: string } {
    const document = parseJsonDocument(entry.raw)
    if (!document.ok) {
      throw new CMSError("VALIDATION", `"${entry.path}" is not valid JSON; refusing to reprint it`)
    }
    return composeEntryDocument({
      fields: entry.fields,
      value,
      untouched,
      document: document.document,
    })
  }

  #collectionFor(name: string): CollectionDescriptor {
    const collection = this.#config.collections.find(
      (candidate) => candidate.kind !== "divider" && candidate.name === name,
    )
    if (collection === undefined || collection.kind === "divider") {
      throw new CMSError("NOT_FOUND", `unknown collection "${name}"`)
    }
    return collection
  }

  #folderCollection(name: string): FolderCollectionDescriptor {
    const collection = this.#collectionFor(name)
    if (collection.kind !== "folder") {
      throw new CMSError("UNSUPPORTED", `collection "${name}" stores single documents`)
    }
    return collection
  }

  #sourceFor(
    collection: FolderCollectionDescriptor,
    path: string,
    slug: string,
    fallbackTitle: string,
    tuple: TreeEntryTuple,
  ): EntrySource {
    return {
      collectionName: collection.name,
      collection,
      path,
      slug,
      fallbackTitle,
      fields: collection.fields,
      ...(collection.identifierField === undefined
        ? {}
        : { identifier: collection.identifierField }),
      media: collection.media ?? this.#config.media,
      blobSha: tuple.sha,
    }
  }

  #filesSourceFor(
    collection: FilesCollectionDescriptor,
    path: string,
    slug: string,
    fallbackTitle: string,
    tuple: TreeEntryTuple,
  ): EntrySource {
    const file = collection.files.find((candidate) => candidate.file === path)
    return {
      collectionName: collection.name,
      collection,
      path,
      slug,
      fallbackTitle,
      fields: file?.fields ?? [],
      media: collection.media ?? this.#config.media,
      blobSha: tuple.sha,
    }
  }

  #afterWriteFailure = (error: BackendWriteError): void => {
    if (error.code === "AUTH_EXPIRED") this.#onAuthExpired()
  }

  #verdictError(verdict: SaveVerdict): CMSError {
    switch (verdict.kind) {
      case "parked":
        return new CMSError("RATE_LIMIT", "GitHub rate limit reached; retry later", {
          ...(verdict.error.resetAt === undefined ? {} : { retryAt: verdict.error.resetAt }),
          cause: verdict.error,
        })
      case "failed":
        return toCMSError(verdict.error)
      case "cancelled":
        return new CMSError("UNKNOWN", "save was cancelled")
      default:
        return new CMSError("UNKNOWN", `unexpected save verdict "${verdict.kind}"`)
    }
  }
}

// ---- tree → sources ------------------------------------------------------

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
        const slug = remainder.slice(0, -".json".length)
        sources.push({
          collectionName: collection.name,
          collection,
          path: entry.path,
          slug,
          fallbackTitle: slug,
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
        media: collection.media ?? config.media,
        blobSha: treeEntry.sha,
      })
    }
  }

  return sources
}

function findTreeEntry(tree: TreeRead, path: string): TreeEntryTuple | undefined {
  return tree.entries.find((entry) => entry.path === path)
}

function normalizeSlug(slug: string): string {
  const trimmed = slug.trim().replace(/\.json$/i, "")
  if (trimmed.length === 0 || trimmed === "." || trimmed === "..") {
    throw new CMSError("VALIDATION", "slug is empty")
  }
  if (trimmed.includes("/") || trimmed.includes("\\")) {
    throw new CMSError("VALIDATION", "slug must be a single path segment")
  }
  return trimmed
}

function assertInsideFolder(path: string, folder: string): string {
  const result = safePath(path, { prefix: folder })
  if (!result.ok) {
    throw new CMSError(
      "VALIDATION",
      `invalid entry path "${path}": ${result.detail ?? result.code}`,
    )
  }
  return result.value
}

function emptyDocument(): JsonDocument {
  const parsed = parseJsonDocument("{}")
  if (!parsed.ok) throw new CMSError("UNKNOWN", "could not build an empty document")
  return parsed.document
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
