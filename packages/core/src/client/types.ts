/**
 * The public vocabulary of the high-level client. Everything a host needs to
 * render its own admin lives here; nothing in this file touches the DOM.
 */

import type { SignInOptions } from "../auth/pat-provider"
import type { CapabilityProbeResult, RateLimitSnapshot } from "../auth/types"
import type { AdminConfig, MediaFolders } from "../config/types"

export type { SignInOptions }

import type { ParseIssue } from "../fields/parse"
import type { FieldDescriptor } from "../fields/types"
import type { ReferenceLocation } from "../media/types"
import type { JsonValue } from "../safety/untrusted-json"
import type { CMSError } from "./errors"

export interface RepositoryTarget {
  readonly owner: string
  readonly repo: string
  readonly branch: string
  /** API origin override (tests, proxies). Defaults to https://api.github.com. */
  readonly baseUrl?: string
}

/** The modeled entry value: declared fields only, `slug` included as virtual. */
export type EntryValue = Readonly<Record<string, unknown>>

export interface EntryStub {
  readonly collection: string
  readonly slug: string
  readonly path: string
  readonly sha: string
  readonly title: string
}

export interface EntrySummary extends EntryStub {
  readonly value: EntryValue
  readonly issues: readonly ParseIssue[]
}

export interface Entry extends EntrySummary {
  /** Decoded source bytes — the base for the next byte-preserving save. */
  readonly raw: string
  /** Unmodeled keys, JSON-Pointer keyed; preserved verbatim on save. */
  readonly untouched: Readonly<Record<string, JsonValue>>
  readonly fields: readonly FieldDescriptor[]
  readonly media: MediaFolders
}

export type SaveResult =
  | { readonly status: "saved"; readonly commitSha: string; readonly entry: Entry }
  | { readonly status: "noop"; readonly entry: Entry }
  | {
      readonly status: "conflict"
      readonly current: Entry
      readonly local: EntryValue
    }

export type DeleteResult =
  | { readonly status: "deleted"; readonly commitSha: string }
  | { readonly status: "noop" }
  | { readonly status: "conflict"; readonly current: Entry }

export type ValidationResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly issues: readonly ParseIssue[] }

export type AuthStatus = "signedOut" | "checking" | "signedIn"

export interface Session {
  readonly repository: RepositoryTarget
  readonly capabilities: CapabilityProbeResult
  readonly rateLimit: RateLimitSnapshot | null
}

export interface AuthAPI {
  readonly status: AuthStatus
  /** Absent for a pre-set `token` until `verify()` probes capabilities. */
  readonly session: Session | undefined
  signIn(token: string, options?: SignInOptions): Promise<Session>
  /** Restores a persisted token and re-probes. Returns undefined when none. */
  restore(): Promise<Session | undefined>
  /** Re-probes the current token; throws `CMSError` on failure. */
  verify(): Promise<Session>
  signOut(): Promise<void>
  onChange(listener: (status: AuthStatus) => void): () => void
}

export interface ListOptions {
  /** Top-level field name to sort by. Defaults to the entry title. */
  readonly sort?: string
  readonly direction?: "asc" | "desc"
}

export interface SaveOptions {
  /** Commit message body. A `chore(cms):` prefix is applied by the pipeline. */
  readonly message?: string
}

export interface CreateOptions extends SaveOptions {
  /** Explicit filename slug. Defaults to the identifier field, slugified. */
  readonly slug?: string
}

export type DeleteOptions = SaveOptions

export interface EntriesAPI {
  list(collection: string, options?: ListOptions): Promise<EntrySummary[]>
  /** Tree-only listing: no blob reads. Titles fall back to the slug. */
  listPaths(collection: string): Promise<EntryStub[]>
  get(collection: string, slug: string): Promise<Entry>
  create(collection: string, value: EntryValue, options?: CreateOptions): Promise<SaveResult>
  save(entry: Entry, value: EntryValue, options?: SaveOptions): Promise<SaveResult>
  delete(entry: Entry, options?: DeleteOptions): Promise<DeleteResult>
  validate(entry: Entry, value: EntryValue): Promise<ValidationResult>
  /** Repo path for an entry, without a network call. */
  path(collection: string, slug: string): string
  /** Slug proposed from the collection's identifier field. */
  slugFromValue(collection: string, value: EntryValue): string
}

export interface MediaFile {
  readonly path: string
  readonly publicPath: string
  readonly name: string
  readonly sha: string
  readonly size: number
}

export interface MediaBlob {
  readonly bytes: Uint8Array
  /** Best-effort MIME type from the file extension; undefined when unknown. */
  readonly type: string | undefined
}

export interface MediaUploadInput {
  readonly name: string
  readonly bytes: Uint8Array
}

export interface MediaListOptions {
  readonly collection?: string
  /**
   * List `_trash/` tombstones instead of live files. Defaults to false.
   * `path` is the tombstone repo path (pass it to `media.restore()`);
   * `publicPath` is where the file restores to.
   */
  readonly includeTrash?: boolean
}

export interface UploadOptions {
  readonly collection?: string
  /** Replace an existing file. Defaults to false (CONFLICT instead). */
  readonly overwrite?: boolean
  /** SVG is refused by default: it is executable in a browser context. */
  readonly allowSvg?: boolean
  readonly message?: string
}

export interface MediaDeleteOptions {
  readonly collection?: string
  /** Refuse when an entry references the file. Defaults to true. */
  readonly checkReferences?: boolean
  readonly message?: string
}

export type MediaDeleteResult =
  | { readonly status: "deleted"; readonly commitSha: string }
  | { readonly status: "referenced"; readonly references: readonly ReferenceLocation[] }

export interface MediaAPI {
  list(options?: MediaListOptions): Promise<MediaFile[]>
  get(publicPath: string, options?: MediaListOptions): Promise<MediaBlob>
  upload(input: MediaUploadInput, options?: UploadOptions): Promise<MediaFile>
  delete(publicPath: string, options?: MediaDeleteOptions): Promise<MediaDeleteResult>
  restore(trashPath: string, options?: { message?: string }): Promise<MediaFile>
  references(publicPath: string, options?: MediaListOptions): Promise<readonly ReferenceLocation[]>
  publicPath(repoPath: string, options?: MediaListOptions): string
  repoPath(publicPath: string, options?: MediaListOptions): string
}

export interface Draft {
  readonly collection: string
  readonly slug: string
  readonly path: string
  readonly savedAt: string
  readonly baseSha: string
  readonly baseRaw: string
  readonly value: EntryValue
}

export interface DraftsAPI {
  save(entry: Entry, value: EntryValue): Promise<void>
  get(entry: Pick<Entry, "collection" | "slug">): Promise<Draft | undefined>
  list(collection?: string): Promise<readonly Draft[]>
  delete(entry: Pick<Entry, "collection" | "slug">): Promise<void>
}

export interface CMSEventMap {
  "auth:change": { readonly status: AuthStatus }
  "save:start": { readonly entry: Entry }
  "save:success": { readonly entry: Entry; readonly result: SaveResult }
  "save:conflict": { readonly entry: Entry; readonly current: Entry }
  "save:error": { readonly entry: Entry; readonly error: CMSError }
  "media:upload": { readonly file: MediaFile }
  "media:delete": { readonly path: string }
}

export interface EventsAPI {
  on<K extends keyof CMSEventMap>(event: K, handler: (payload: CMSEventMap[K]) => void): () => void
}

export interface CMS {
  readonly config: AdminConfig
  readonly repository: RepositoryTarget
  readonly auth: AuthAPI
  readonly entries: EntriesAPI
  readonly media: MediaAPI
  readonly drafts: DraftsAPI
  readonly events: EventsAPI
  /** Re-reads the ref and tree; drafts survive. */
  refresh(): Promise<void>
  clearCache(): void
  /** Drops cache and listeners. Does not sign out. */
  destroy(): void
}
