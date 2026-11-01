/**
 * Drafts — optional local persistence for unsaved edits.
 *
 * The default store is in-memory; `patcms/web` exports an IndexedDB store for
 * hosts that want drafts to survive a reload. Keys follow the draft-key law
 * `${owner}/${repo}/${collection}/${slug}`, so staged media tiles stored by a
 * host under the same prefix never collide with entry drafts.
 */
import type { DraftStore, SaveDraftPayload } from "../drafts"
import type { Draft, DraftsAPI, Entry, EntryValue } from "./types"

export interface DraftsClientOptions {
  readonly store: DraftStore
  /** `${owner}/${repo}` — the namespace every key is scoped to. */
  readonly namespace: string
}

export class DraftsClient implements DraftsAPI {
  readonly #store: DraftStore
  readonly #namespace: string

  constructor(options: DraftsClientOptions) {
    this.#store = options.store
    this.#namespace = options.namespace
  }

  async save(entry: Entry, value: EntryValue): Promise<void> {
    const payload: SaveDraftPayload = {
      filePath: entry.path,
      baseSha: entry.sha,
      baseRaw: entry.raw,
      formValue: value,
    }
    await this.#store.put({
      key: this.#key(entry.collection, entry.slug),
      value: payload,
      savedAt: new Date().toISOString(),
    })
  }

  async get(entry: Pick<Entry, "collection" | "slug">): Promise<Draft | undefined> {
    const record = await this.#store.get<SaveDraftPayload>(this.#key(entry.collection, entry.slug))
    if (record === undefined || !isPayload(record.value)) return undefined
    return toDraft(record.key, record.savedAt, record.value)
  }

  async list(collection?: string): Promise<readonly Draft[]> {
    const prefix =
      collection === undefined ? `${this.#namespace}/` : `${this.#namespace}/${collection}/`
    const records = await this.#store.list(prefix)
    const drafts: Draft[] = []
    for (const record of records) {
      if (!isPayload(record.value)) continue
      const parsed = parseKey(this.#namespace, record.key)
      if (parsed === undefined) continue
      if (collection !== undefined && parsed.collection !== collection) continue
      drafts.push(toDraft(record.key, record.savedAt, record.value))
    }
    drafts.sort((left, right) => right.savedAt.localeCompare(left.savedAt))
    return drafts
  }

  async delete(entry: Pick<Entry, "collection" | "slug">): Promise<void> {
    await this.#store.delete(this.#key(entry.collection, entry.slug))
  }

  #key(collection: string, slug: string): string {
    return `${this.#namespace}/${collection}/${slug}`
  }
}

function parseKey(
  namespace: string,
  key: string,
): { readonly collection: string; readonly slug: string } | undefined {
  const prefix = `${namespace}/`
  if (!key.startsWith(prefix)) return undefined
  const segments = key.slice(prefix.length).split("/")
  if (segments.length !== 2) return undefined
  const [collection, slug] = segments
  if (collection === undefined || slug === undefined) return undefined
  return { collection, slug }
}

function isPayload(value: unknown): value is SaveDraftPayload {
  if (typeof value !== "object" || value === null) return false
  const candidate = value as Partial<SaveDraftPayload>
  return (
    typeof candidate.filePath === "string" &&
    typeof candidate.baseSha === "string" &&
    typeof candidate.baseRaw === "string" &&
    "formValue" in candidate
  )
}

function toDraft(key: string, savedAt: string, payload: SaveDraftPayload): Draft {
  const segments = key.split("/")
  const slug = segments.pop() ?? ""
  const collection = segments.pop() ?? ""
  return {
    collection,
    slug,
    path: payload.filePath,
    savedAt,
    baseSha: payload.baseSha,
    baseRaw: payload.baseRaw,
    value: isRecord(payload.formValue) ? payload.formValue : {},
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
