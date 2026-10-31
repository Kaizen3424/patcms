/** Drafts seam — 01-spec §5 (ADR-0002: draft lifecycle is ORTHOGONAL to token lifecycle). */

/**
 * Key law (verbatim): entry drafts are keyed `${repo}/${collection}/${slug}`;
 * staged media tiles are stored alongside per-entry
 * (`${repo}/${collection}/${slug}/media/${n}`); settings documents are keyed
 * by file path.
 */
export type DraftKey = string

export interface DraftRecord<T = unknown> {
  readonly key: DraftKey
  readonly value: T
  readonly savedAt: string
}

/** Node-safe seam — the IDB implementation lives in `core/web` (browser-only). */
export interface DraftStore {
  get<T>(key: DraftKey): Promise<DraftRecord<T> | undefined>
  put<T>(record: DraftRecord<T>): Promise<void>
  delete(key: DraftKey): Promise<void>
  list(prefix?: string): Promise<readonly DraftRecord[]>
  /** Deletes all records whose key starts with `prefix` (ADR-0007 §1 child tile cleanup). */
  deletePrefix(prefix: string): Promise<void>
}

/**
 * The persisted save-draft payload (ADR-0004 C.3 pins). `baseRaw` is the
 * UTF-8-decoded raw bytes the form was loaded from (`oldRaw` of `rebase()`);
 * `formValue` is the JSON-safe edited value tree; `baseSha` is the commit sha
 * the form was loaded against. `oldBase` and `dirtyPaths` are NEVER persisted —
 * they derive at boot (`parse(baseRaw)` / `diffPaths(formValue, parse(baseRaw))`),
 * so a stored record can never disagree with the granularity law.
 */
export interface SaveDraftPayload {
  readonly filePath: string
  readonly baseSha: string
  readonly baseRaw: string
  readonly formValue: unknown
}
