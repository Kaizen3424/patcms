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
import type { CommitChangeSet, TreeEntryTuple, TreeRead } from "../backend/types"
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
import { collectRelationIssues, validateEntryForSave } from "../fields/validate"
import type { SearchableEntry } from "../media/references"
import type { SaveVerdict } from "../pipeline/save-driver"
import { compareText, compareValues } from "../safety/collator"
import { mapConcurrent } from "../safety/concurrency"
import { decodeUtf8, encodeUtf8 } from "../safety/encoding"
import { safePath } from "../safety/safe-path"
import { slugify } from "../safety/slug"
import type { JsonValue } from "../safety/untrusted-json"
import { parseUntrustedJson } from "../safety/untrusted-json"
import type { JsonDocument } from "../serialization/document"
import { parseJsonDocument } from "../serialization/document"
import { composeEntryDocument } from "../serialization/entry-document"
import type { CachedEntry, ClientCache } from "./cache"
import type { ContentStore, ContentStoreKey } from "./content-store"
import { contentStoreKey } from "./content-store"
import { CMSError, toCMSError } from "./errors"
import type { RepoReader } from "./repo"
import type {
  BulkConflict,
  CreateManyItem,
  CreateManyResult,
  CreateOptions,
  DeleteManyResult,
  DeleteOptions,
  DeleteResult,
  EntriesAPI,
  Entry,
  EntryStub,
  EntrySummary,
  EntryValue,
  HistoryOptions,
  ListOptions,
  RestoreOptions,
  RestoreResult,
  Revision,
  SaveManyItem,
  SaveManyResult,
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
  /** Parallel entry reads (GitHub secondary-limit posture; INV-N01). */
  readonly readConcurrency?: number
  /** On-device copy of entry text, keyed by path + blob SHA. Off by default. */
  readonly content?: ContentStore
  /** Called when GitHub rejects the token mid-write; the client signs out. */
  readonly onAuthExpired: () => void
}

/** Reads stay well under GitHub's burst thresholds. */
const DEFAULT_READ_CONCURRENCY = 5

/** History paging bounds (GitHub caps `per_page` at 100). */
const DEFAULT_HISTORY_LIMIT = 20
const MAX_HISTORY_LIMIT = 100

export class EntriesClient implements EntriesAPI {
  readonly #config: AdminConfig
  readonly #repo: RepoReader
  readonly #cache: ClientCache
  readonly #readConcurrency: number
  readonly #content: ContentStore | undefined
  readonly #onAuthExpired: () => void
  /** Tree sha whose reachable records were last offered to `prune`. */
  #prunedTreeSha: string | undefined

  constructor(options: EntriesClientOptions) {
    this.#config = options.config
    this.#repo = options.repo
    this.#cache = options.cache
    this.#readConcurrency = options.readConcurrency ?? DEFAULT_READ_CONCURRENCY
    this.#content = options.content
    this.#onAuthExpired = options.onAuthExpired
  }

  async list(collection: string, options: ListOptions = {}): Promise<EntrySummary[]> {
    const { tree, sources, services } = await this.#snapshot(collection)
    this.#pruneContent(tree)
    const prefetched = await this.#prefetch(sources)
    const entries = await mapConcurrent(sources, this.#readConcurrency, (source) =>
      this.#read(source, services, prefetched),
    )
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
    return this.#read(source, services)
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
    const { tree, services } = await this.#snapshot(collection, { recheck: true })

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
      const source = this.#sourceFor(descriptor, path, slug, slug, {
        path,
        sha: blobSha,
        mode: "100644",
        type: "blob",
      })
      const saved = await this.#readFresh(source, composed.raw, blobSha)
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
      const { tree, services } = await this.#snapshot(entry.collection, { recheck: true })
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
        const raw = verdict.reconciliation?.reconciledRaw ?? composed.raw
        const sha =
          verdict.reconciliation === undefined
            ? blobSha
            : await gitBlobSha(encodeUtf8(verdict.reconciliation.reconciledRaw))
        const saved = await this.#readFresh({ ...source, blobSha: sha }, raw, sha)
        return { status: "saved", commitSha: verdict.commitSha, entry: saved }
      }

      if (verdict.kind === "noop") {
        const raw = verdict.reconciliation?.reconciledRaw ?? composed.raw
        const sha =
          verdict.reconciliation === undefined
            ? blobSha
            : await gitBlobSha(encodeUtf8(verdict.reconciliation.reconciledRaw))
        const saved = await this.#readFresh({ ...source, blobSha: sha }, raw, sha)
        return { status: "noop", entry: saved }
      }

      if (verdict.kind === "conflict") {
        // An unrelated remote change (another entry) is retried once against
        // the fresh base; a change to OUR file is a real conflict.
        if (!retried && !verdict.details.changed.has(base.path)) {
          retried = true
          const freshTree = await this.#repo.tree({ recheck: true })
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

    const tree = await this.#repo.tree({ recheck: true })
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

  // ---- history ------------------------------------------------------------

  /**
   * Commits that touched this entry, newest first. A `listPaths` stub is
   * enough — the path is all GitHub's path filter needs, so a deleted entry's
   * history stays reachable.
   */
  async history(entry: Entry | EntryStub, options: HistoryOptions = {}): Promise<Revision[]> {
    const source = this.#sourceOf(entry)
    const limit = historyLimit(options.limit)
    const before = options.before
    const commits = await this.#repo.listCommits({
      path: source.path,
      limit: before === undefined ? limit : Math.min(limit + 1, MAX_HISTORY_LIMIT),
      ...(before === undefined ? {} : { before }),
    })
    // GitHub's `sha` parameter is inclusive: drop the cursor row so paging
    // never repeats a revision.
    const rows =
      before === undefined ? commits : commits.filter((commit) => commit.commitSha !== before)
    return rows.slice(0, limit).map((commit) => ({
      commitSha: commit.commitSha,
      message: commit.message,
      ...(commit.authoredAt === undefined ? {} : { authoredAt: commit.authoredAt }),
      ...(commit.authorName === undefined ? {} : { authorName: commit.authorName }),
    }))
  }

  /** The entry as it was at `commitSha`. Nothing is written or cached as head. */
  async atRevision(entry: Entry | EntryStub, commitSha: string): Promise<Entry> {
    const source = this.#sourceOf(entry)
    const revision = await this.#revision(source, commitSha)
    return this.#read({ ...source, blobSha: revision.tuple.sha }, this.#services(revision.tree))
  }

  /**
   * Writes a historical version's exact bytes as a NEW commit. The file is
   * optimistic at the entry's sha first (a changed file is a conflict), and a
   * deleted file is re-created. The historical value must validate now.
   */
  async restore(
    entry: Entry | EntryStub,
    commitSha: string,
    options: RestoreOptions = {},
  ): Promise<RestoreResult> {
    const source = this.#sourceOf(entry)
    const revision = await this.#revision(source, commitSha)
    let retried = false

    while (true) {
      const tree = await this.#repo.tree({ recheck: true })
      const services = this.#services(tree)
      const current = findTreeEntry(tree, source.path)

      if (current !== undefined && current.sha === revision.tuple.sha) {
        return {
          status: "noop",
          entry: await this.#read({ ...source, blobSha: current.sha }, services),
        }
      }
      if (current !== undefined && current.sha !== entry.sha) {
        return {
          status: "conflict",
          current: await this.#read({ ...source, blobSha: current.sha }, services),
        }
      }

      // The historical value must still pass today's gate; `atRevision` plus a
      // manual save is the escape hatch when config changed since the commit.
      const historical = await this.#build(
        { ...source, blobSha: revision.tuple.sha },
        revision.raw,
        revision.tuple.sha,
        services,
      )
      const validation = await validateEntryForSave({
        fields: source.fields,
        raw: historical.entry.value,
        filePath: source.path,
        media: source.media,
        services,
      })
      if (!validation.ok) {
        throw new CMSError(
          "VALIDATION",
          `revision ${commitSha.slice(0, 7)} of "${source.path}" no longer passes validation`,
          { issues: validation.issues },
        )
      }

      const changes: CommitChangeSet =
        current === undefined
          ? { adds: [{ path: source.path, bytes: revision.bytes }] }
          : { updates: [{ path: source.path, bytes: revision.bytes }] }
      const verdict = await this.#repo.save(changes, options.message, this.#afterWriteFailure)

      if (verdict.kind === "published" || verdict.kind === "noop") {
        const saved = await this.#readFresh(
          { ...source, blobSha: revision.tuple.sha },
          revision.raw,
          revision.tuple.sha,
        )
        return verdict.kind === "published"
          ? { status: "restored", commitSha: verdict.commitSha, entry: saved }
          : { status: "noop", entry: saved }
      }

      if (verdict.kind === "conflict") {
        const freshTree = await this.#repo.tree({ recheck: true })
        const fresh = findTreeEntry(freshTree, source.path)
        if (fresh !== undefined && fresh.sha === revision.tuple.sha) {
          return {
            status: "noop",
            entry: await this.#read({ ...source, blobSha: fresh.sha }, this.#services(freshTree)),
          }
        }
        if (fresh !== undefined && fresh.sha !== entry.sha) {
          return {
            status: "conflict",
            current: await this.#read({ ...source, blobSha: fresh.sha }, this.#services(freshTree)),
          }
        }
        // Either the file was deleted (a restore re-creates it) or the branch
        // moved somewhere else. Both are retried once; never forced.
        if (!retried) {
          retried = true
          continue
        }
        throw new CMSError("CONFLICT", `"${source.path}" kept moving; retry the restore`)
      }

      throw this.#verdictError(verdict)
    }
  }

  /**
   * Bulk save — ONE commit for the whole batch, all-or-nothing.
   *
   * The batch binds to a fresh head before anything else: every row's base sha
   * must still be the branch's sha. If one row is stale (or gone), nothing is
   * written and every stale row returns as a conflict with its current state.
   * A CAS loss caused only by unrelated paths is retried once, exactly like a
   * single save.
   */
  async saveMany(
    items: readonly SaveManyItem[],
    options: SaveOptions = {},
  ): Promise<SaveManyResult> {
    if (items.length === 0) return { status: "noop", entries: [] }
    assertUniquePaths(items.map((item) => item.entry.path))

    let retried = false
    while (true) {
      const tree = await this.#repo.tree({ recheck: true })
      const services = this.#services(tree)

      const stale = items.filter((item) => {
        const tuple = findTreeEntry(tree, item.entry.path)
        return tuple === undefined || tuple.sha !== item.entry.sha
      })
      if (stale.length > 0) {
        return {
          status: "conflict",
          conflicts: await this.#conflictStates(this.#saveConflictRows(stale), tree, services),
        }
      }

      // A list stub is hydrated here (content-addressed, so a body the listing
      // already cached costs nothing); a full `get()` entry is used as is.
      const rows = await mapConcurrent(items, this.#readConcurrency, async (item) => {
        const source = this.#sourceOf(item.entry)
        const base = isFullEntry(item.entry) ? item.entry : await this.#read(source, services)
        return { item, value: item.value, source, base }
      })
      const prepared = await this.#validateRows(rows, services)

      const known = new Map<string, { readonly raw: string; readonly sha: string }>()
      const writes: Array<{ readonly path: string; readonly bytes: Uint8Array }> = []
      for (const row of prepared) {
        const composed = this.#compose(row.base, row.validated, row.base.untouched)
        const bytes = encodeUtf8(composed.raw)
        known.set(row.item.entry.path, { raw: composed.raw, sha: await gitBlobSha(bytes) })
        if (composed.raw !== row.base.raw) {
          writes.push({ path: row.item.entry.path, bytes })
        }
      }
      if (writes.length === 0) {
        return { status: "noop", entries: prepared.map((row) => row.base) }
      }

      const verdict = await this.#repo.save(
        { updates: writes },
        options.message,
        this.#afterWriteFailure,
      )

      if (verdict.kind === "published" || verdict.kind === "noop") {
        const entries = await this.#settleMany(
          prepared.map((row) => ({ source: row.source })),
          known,
        )
        return verdict.kind === "published"
          ? { status: "saved", commitSha: verdict.commitSha, entries }
          : { status: "noop", entries }
      }

      if (verdict.kind === "conflict") {
        const moved = items.filter((item) => verdict.details.changed.has(item.entry.path))
        if (moved.length === 0 && !retried) {
          retried = true
          continue
        }
        const fresh = await this.#repo.tree()
        return {
          status: "conflict",
          conflicts: await this.#conflictStates(
            this.#saveConflictRows(moved.length > 0 ? moved : items),
            fresh,
            this.#services(fresh),
          ),
        }
      }

      throw this.#verdictError(verdict)
    }
  }

  /**
   * Bulk create (import) — ONE commit, all-or-nothing. A slug that already
   * exists is a conflict carrying the current entry; duplicate slugs inside the
   * batch are a validation error.
   */
  async createMany(
    items: readonly CreateManyItem[],
    options: SaveOptions = {},
  ): Promise<CreateManyResult> {
    if (items.length === 0) return { status: "noop", entries: [] }

    const plans = items.map((item) => {
      const descriptor = this.#folderCollection(item.collection)
      if (descriptor.create === false) {
        throw new CMSError(
          "UNSUPPORTED",
          `collection "${item.collection}" does not allow new entries`,
        )
      }
      const slug = normalizeSlug(item.slug ?? this.slugFromValue(item.collection, item.value))
      const path = assertInsideFolder(`${descriptor.folder}/${slug}.json`, descriptor.folder)
      return {
        item,
        descriptor,
        value: item.value,
        local: item.value,
        collection: descriptor.name,
        slug,
        path,
        source: this.#sourceFor(descriptor, path, slug, slug, {
          path,
          sha: "",
          mode: "100644",
          type: "blob",
        }),
      }
    })
    assertUniquePaths(plans.map((plan) => plan.path))

    let retried = false
    while (true) {
      const tree = await this.#repo.tree({ recheck: true })
      const services = this.#services(tree)

      const taken = plans.filter((plan) => findTreeEntry(tree, plan.path) !== undefined)
      if (taken.length > 0) {
        return { status: "conflict", conflicts: await this.#conflictStates(taken, tree, services) }
      }

      const prepared = await this.#validateRows(plans, services)
      const known = new Map<string, { readonly raw: string; readonly sha: string }>()
      const writes: Array<{ readonly path: string; readonly bytes: Uint8Array }> = []
      for (const row of prepared) {
        const composed = composeEntryDocument({
          fields: row.descriptor.fields,
          value: row.validated,
          untouched: {},
          document: emptyDocument(),
        })
        const bytes = encodeUtf8(composed.raw)
        known.set(row.path, { raw: composed.raw, sha: await gitBlobSha(bytes) })
        writes.push({ path: row.path, bytes })
      }

      const verdict = await this.#repo.save(
        { adds: writes },
        options.message,
        this.#afterWriteFailure,
      )

      if (verdict.kind === "published" || verdict.kind === "noop") {
        const entries = await this.#settleMany(
          prepared.map((row) => ({ source: row.source })),
          known,
        )
        return verdict.kind === "published"
          ? { status: "saved", commitSha: verdict.commitSha, entries }
          : { status: "noop", entries }
      }

      if (verdict.kind === "conflict") {
        const moved = plans.filter((plan) => verdict.details.changed.has(plan.path))
        if (moved.length === 0 && !retried) {
          retried = true
          continue
        }
        const fresh = await this.#repo.tree()
        return {
          status: "conflict",
          conflicts: await this.#conflictStates(
            moved.length > 0 ? moved : plans,
            fresh,
            this.#services(fresh),
          ),
        }
      }

      throw this.#verdictError(verdict)
    }
  }

  /**
   * Bulk delete — ONE commit, all-or-nothing. A file that changed since it was
   * loaded blocks the batch; a file already deleted by someone else is simply
   * left out (the goal for that row is already true).
   */
  async deleteMany(
    entries: readonly EntryStub[],
    options: DeleteOptions = {},
  ): Promise<DeleteManyResult> {
    if (entries.length === 0) return { status: "noop" }
    assertUniquePaths(entries.map((entry) => entry.path))
    for (const entry of entries) {
      const descriptor = this.#collectionFor(entry.collection)
      if (descriptor.kind === "folder" && descriptor.delete === false) {
        throw new CMSError("UNSUPPORTED", `collection "${entry.collection}" does not allow deletes`)
      }
    }

    let retried = false
    while (true) {
      const tree = await this.#repo.tree({ recheck: true })
      const services = this.#services(tree)

      const stale = entries.filter((entry) => {
        const tuple = findTreeEntry(tree, entry.path)
        return tuple !== undefined && tuple.sha !== entry.sha
      })
      if (stale.length > 0) {
        return {
          status: "conflict",
          conflicts: await this.#conflictStates(this.#deleteConflictRows(stale), tree, services),
        }
      }

      const present = entries.filter((entry) => findTreeEntry(tree, entry.path) !== undefined)
      if (present.length === 0) return { status: "noop" }

      const verdict = await this.#repo.save(
        { deletes: present.map((entry) => entry.path) },
        options.message,
        this.#afterWriteFailure,
      )
      if (verdict.kind === "published") {
        for (const entry of present) this.#cache.dropEntry(entry.path)
        return { status: "deleted", commitSha: verdict.commitSha }
      }
      if (verdict.kind === "noop") {
        for (const entry of present) this.#cache.dropEntry(entry.path)
        return { status: "noop" }
      }
      if (verdict.kind === "conflict") {
        // Re-checking every row is cheaper than guessing: a file already
        // deleted by someone else drops out of the batch on the second pass.
        if (!retried) {
          retried = true
          continue
        }
        const fresh = await this.#repo.tree()
        return {
          status: "conflict",
          conflicts: await this.#conflictStates(
            this.#deleteConflictRows(entries),
            fresh,
            this.#services(fresh),
          ),
        }
      }
      throw this.#verdictError(verdict)
    }
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
    const tree = await this.#repo.tree({ recheck: true })
    this.#pruneContent(tree)
    const services = this.#services(tree)
    const sources = collectSources(this.#config, tree)
    const prefetched = await this.#prefetch(sources)
    const entries = await mapConcurrent(sources, this.#readConcurrency, (source) =>
      this.#read(source, services, prefetched),
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

  /** Bytes and tree of one file at one commit — exact bytes, never reprinted. */
  async #revision(
    source: EntrySource,
    commitSha: string,
  ): Promise<{
    readonly tree: TreeRead
    readonly tuple: TreeEntryTuple
    readonly bytes: Uint8Array
    readonly raw: string
  }> {
    const tree = await this.#repo.treeAt(commitSha)
    const tuple = findTreeEntry(tree, source.path)
    if (tuple === undefined || tuple.type !== "blob") {
      throw new CMSError("NOT_FOUND", `"${source.path}" does not exist at revision ${commitSha}`)
    }
    const bytes = await this.#repo.readBlob(tuple.sha)
    return { tree, tuple, bytes, raw: decodeUtf8(bytes) }
  }

  async #snapshot(
    collection: string,
    options: { recheck?: boolean } = {},
  ): Promise<{
    readonly tree: TreeRead
    readonly sources: readonly EntrySource[]
    readonly services: RelationServices
  }> {
    this.#collectionFor(collection)
    const tree = await this.#repo.tree({ recheck: options.recheck === true })
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

  #sourceOf(entry: Entry | EntryStub): EntrySource {
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

  async #read(
    source: EntrySource,
    services: RelationServices,
    prefetched?: ReadonlyMap<string, string>,
  ): Promise<Entry> {
    const cached = this.#cache.getEntry(source.path, source.blobSha)
    if (cached !== undefined) return this.#revalidate(cached, services)

    const key: ContentStoreKey = { path: source.path, sha: source.blobSha }
    const stored = prefetched?.get(contentStoreKey(key)) ?? (await this.#readStored(key))
    if (stored !== undefined) {
      const built = await this.#build(source, stored, source.blobSha, services)
      this.#cache.putEntry(built)
      return built.entry
    }

    let bytes: Uint8Array
    try {
      bytes = await this.#repo.readFile(source.path, source.blobSha)
    } catch (error) {
      throw toCMSError(error)
    }
    const text = decodeUtf8(bytes)
    const built = await this.#build(source, text, source.blobSha, services)
    this.#cache.putEntry(built)
    await this.#remember(key, text)
    return built.entry
  }

  /** A device-store miss and a broken device store are the same thing here. */
  async #readStored(key: ContentStoreKey): Promise<string | undefined> {
    if (this.#content === undefined) return undefined
    try {
      return await this.#content.get(key)
    } catch {
      return undefined
    }
  }

  /** One bulk read for the paths a listing is about to parse. */
  async #prefetch(
    sources: readonly EntrySource[],
  ): Promise<ReadonlyMap<string, string> | undefined> {
    const store = this.#content
    if (store?.getMany === undefined) return undefined
    const missing: ContentStoreKey[] = []
    for (const source of sources) {
      if (this.#cache.getEntry(source.path, source.blobSha) === undefined) {
        missing.push({ path: source.path, sha: source.blobSha })
      }
    }
    if (missing.length === 0) return undefined
    try {
      return await store.getMany(missing)
    } catch {
      return undefined
    }
  }

  /** Best-effort: a blocked or full device store must never break a read. */
  async #remember(key: ContentStoreKey, text: string): Promise<void> {
    if (this.#content === undefined) return
    try {
      await this.#content.put(key, text)
    } catch {
      // Ignored on purpose: the network read already succeeded.
    }
  }

  /**
   * Offers the current tree's reachable records to the store. Runs once per
   * tree sha, so a listing does not re-walk the device store on every call.
   */
  #pruneContent(tree: TreeRead): void {
    if (this.#content === undefined || tree.sha === this.#prunedTreeSha) return
    this.#prunedTreeSha = tree.sha
    const live = collectSources(this.#config, tree).map((source) => ({
      path: source.path,
      sha: source.blobSha,
    }))
    void this.#content.prune(live).catch(() => undefined)
  }

  /**
   * Relation issues depend on every other entry, so a cache hit recomputes
   * them (cheap: no bytes, no parse) while keeping the parsed value.
   */
  async #revalidate(cached: CachedEntry, services: RelationServices): Promise<Entry> {
    const relationIssues = await collectRelationIssues({
      fields: cached.entry.fields,
      value: cached.entry.value,
      services,
    })
    if (relationIssues.length === 0) return cached.entry
    return { ...cached.entry, issues: mergeIssues(cached.localIssues, relationIssues) }
  }

  /** Reads bytes that were just written (no tree lookup, no stale sha). */
  async #readFresh(source: EntrySource, rawText: string, sha: string): Promise<Entry> {
    const tree = await this.#repo.tree()
    const built = await this.#build(source, rawText, sha, this.#services(tree))
    this.#cache.putEntry(built)
    await this.#remember({ path: source.path, sha }, rawText)
    return built.entry
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

  /**
   * Validates every row against the SAME tree before any byte is composed. A
   * failure names every offending file and writes nothing.
   */
  async #validateRows<T extends { readonly source: EntrySource; readonly value: EntryValue }>(
    rows: readonly T[],
    services: RelationServices,
  ): Promise<Array<T & { readonly validated: Readonly<Record<string, unknown>> }>> {
    const validated: Array<T & { readonly validated: Readonly<Record<string, unknown>> }> = []
    const invalid: string[] = []
    const issues: ParseIssue[] = []
    for (const row of rows) {
      const result = await validateEntryForSave({
        fields: row.source.fields,
        raw: row.value,
        filePath: row.source.path,
        media: row.source.media,
        services,
      })
      if (result.ok) {
        validated.push({ ...row, validated: result.value })
        continue
      }
      invalid.push(row.source.path)
      issues.push(...result.issues)
    }
    if (invalid.length > 0) throw validationFailure(invalid, rows.length, issues)
    return validated
  }

  /** Current branch state for each row — the value half of a conflict result. */
  async #conflictStates(
    rows: readonly {
      readonly path: string
      readonly collection: string
      readonly slug: string
      readonly source: EntrySource
      readonly local?: EntryValue
    }[],
    tree: TreeRead,
    services: RelationServices,
  ): Promise<BulkConflict[]> {
    return mapConcurrent(rows, this.#readConcurrency, async (row) => {
      const common = {
        path: row.path,
        collection: row.collection,
        slug: row.slug,
        ...(row.local === undefined ? {} : { local: row.local }),
      }
      const tuple = findTreeEntry(tree, row.path)
      if (tuple === undefined) return common
      const current = await this.#read({ ...row.source, blobSha: tuple.sha }, services)
      return { ...common, current }
    })
  }

  /**
   * Post-write state from ONE fresh tree read: rows we wrote are built from the
   * bytes we sent (no download), while a row someone re-edited in the meantime
   * is read fresh so no stale sha reaches the host's next save.
   */
  async #settleMany(
    rows: readonly { readonly source: EntrySource }[],
    known: ReadonlyMap<string, { readonly raw: string; readonly sha: string }>,
  ): Promise<Entry[]> {
    const tree = await this.#repo.tree()
    const services = this.#services(tree)
    const settled: Entry[] = []
    for (const row of rows) {
      const path = row.source.path
      const mine = known.get(path)
      const tuple = findTreeEntry(tree, path)
      if (mine !== undefined && (tuple === undefined || tuple.sha === mine.sha)) {
        const built = await this.#build(
          { ...row.source, blobSha: mine.sha },
          mine.raw,
          mine.sha,
          services,
        )
        this.#cache.putEntry(built)
        await this.#remember({ path, sha: mine.sha }, mine.raw)
        settled.push(built.entry)
        continue
      }
      if (tuple !== undefined) {
        settled.push(await this.#read({ ...row.source, blobSha: tuple.sha }, services))
        continue
      }
      throw new CMSError("UNKNOWN", `"${path}" vanished after the commit`)
    }
    return settled
  }

  #saveConflictRows(items: readonly SaveManyItem[]): Array<{
    readonly path: string
    readonly collection: string
    readonly slug: string
    readonly source: EntrySource
    readonly local: EntryValue
  }> {
    return items.map((item) => ({
      path: item.entry.path,
      collection: item.entry.collection,
      slug: item.entry.slug,
      source: this.#sourceOf(item.entry),
      local: item.value,
    }))
  }

  #deleteConflictRows(entries: readonly EntryStub[]): Array<{
    readonly path: string
    readonly collection: string
    readonly slug: string
    readonly source: EntrySource
  }> {
    return entries.map((entry) => ({
      path: entry.path,
      collection: entry.collection,
      slug: entry.slug,
      source: this.#sourceOf(entry),
    }))
  }

  async #build(
    source: EntrySource,
    rawText: string,
    sha: string,
    services: RelationServices,
  ): Promise<CachedEntry> {
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

    // One parse, two issue layers: local issues are cacheable with the bytes,
    // relation issues are recomputed against whatever tree the caller holds.
    const localIssues: readonly ParseIssue[] = [...preIssues, ...parsedEntry.issues]
    let issues = localIssues
    if (preIssues.length === 0) {
      const relationIssues = await collectRelationIssues({
        fields: source.fields,
        value: parsedEntry.value,
        services,
      })
      if (relationIssues.length > 0) issues = mergeIssues(localIssues, relationIssues)
    }

    const titleValue =
      source.identifier === undefined ? undefined : parsedEntry.value[source.identifier]
    const title =
      typeof titleValue === "string" && titleValue.length > 0 ? titleValue : source.fallbackTitle

    return {
      localIssues,
      entry: {
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
      },
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

function historyLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return DEFAULT_HISTORY_LIMIT
  return Math.min(Math.max(Math.trunc(limit), 1), MAX_HISTORY_LIMIT)
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

function assertUniquePaths(paths: readonly string[]): void {
  const seen = new Set<string>()
  const duplicates = new Set<string>()
  for (const path of paths) {
    if (seen.has(path)) duplicates.add(path)
    seen.add(path)
  }
  if (duplicates.size === 0) return
  throw new CMSError(
    "VALIDATION",
    `the batch names the same file twice: ${[...duplicates].join(", ")}`,
  )
}

/** One failure for the whole batch, naming every offending file. */
function validationFailure(
  paths: readonly string[],
  total: number,
  issues: readonly ParseIssue[],
): CMSError {
  const shown = paths.slice(0, 5)
  const more = paths.length > shown.length ? ` (+${paths.length - shown.length} more)` : ""
  return new CMSError(
    "VALIDATION",
    `${paths.length} of ${total} entries have validation errors: ${shown.join(", ")}${more}`,
    { issues },
  )
}

/** `get()` returns this; `list()` returns a summary without raw/fields. */
function isFullEntry(entry: Entry | EntryStub): entry is Entry {
  return "raw" in entry && "untouched" in entry && "fields" in entry
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
