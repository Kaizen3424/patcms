# patcms API reference

Signatures and result shapes for the published surface. Everything here is from the three entries:
`patcms`, `patcms/advanced`, `patcms/web`.

## `createCMS(options): CMS`

| Option | Type | Default | Notes |
|---|---|---|---|
| `config` | `ConfigDefinition \| AdminConfig` (required) | — | `defineConfig()` output, or an already-projected descriptor set (auto-detected) |
| `repository` | `{ owner, repo, branch, baseUrl? }` (required) | — | `baseUrl` defaults to `https://api.github.com` |
| `token` | `string` | — | Seeds without probing; no network until an operation or `auth.verify()` |
| `tokenStore` | `TokenStore` | memory-only | `read()` / `write(token)` / `clear()`, all async |
| `drafts` | `DraftStore` | memory-only | `get` / `put` / `delete` / `list` / `deletePrefix` |
| `fetch` | `FetchLike` | bound `globalThis.fetch` | Test/proxy seam; throws `INVALID_CONFIG` when no global fetch exists |
| `onAuthExpired` | `() => void` | — | Called after a 401 write wiped the session |

Construction is offline. The `CMS` object: `config`, `repository`, `auth`, `entries`, `media`,
`drafts`, `events`, plus `refresh()` (clear cache, re-read head+tree; drafts survive),
`clearCache()`, `destroy()` (drops cache and listeners; does **not** sign out).

## `cms.auth`

| Member | Signature / shape |
|---|---|
| `status` | `"signedOut" \| "checking" \| "signedIn"` |
| `session` | `{ repository, capabilities, rateLimit } \| undefined` — absent for a seeded token until `verify()` |
| `signIn(token, options?)` | `Promise<Session>`; `options: { remember?: boolean }`; probes capabilities first, throws `CMSError` when the token cannot write |
| `restore()` | `Promise<Session \| undefined>` — restores a persisted token and re-probes |
| `verify()` | `Promise<Session>` — re-probes; throws on failure |
| `signOut()` | Clears session **and** persisted token |
| `onChange(listener)` | `(status) => void`; returns unsubscribe |

`capabilities`: `{ repo, protectionAdmin, checksRead, rateLimit, quotaBlockedUntil? }` where each
status is `"ok" | "missing" | "forbidden" | "error"`. `rateLimit`: `{ limit, remaining, resetAt }`.

## `cms.entries`

| Method | Signature | Notes |
|---|---|---|
| `list` | `(collection, options?: { sort?, direction? }) => Promise<EntrySummary[]>` | Lenient parse, never throws on bad data; default sort by title, `nl-NL` collation, empty values last |
| `listPaths` | `(collection) => Promise<EntryStub[]>` | Tree-only, no blob reads |
| `get` | `(collection, slug) => Promise<Entry>` | Throws `NOT_FOUND` |
| `create` | `(collection, value, options?: { slug?, message? }) => Promise<SaveResult>` | Folder collections only (`UNSUPPORTED` otherwise or when `create: false`) |
| `save` | `(entry, value, options?: { message? }) => Promise<SaveResult>` | One commit, fast-forward-only; auto-retries once when a foreign commit touched only other files |
| `delete` | `(entry, options?: { message? }) => Promise<DeleteResult>` | Honours `delete: false` |
| `validate` | `(entry, value) => Promise<ValidationResult>` | `{ ok: true } \| { ok: false, issues }` |
| `path` | `(collection, slug) => string` | Pure; normalizes slug, `safePath`-checked |
| `slugFromValue` | `(collection, value) => string` | identifierField → `slugify`, fallback `"entry"`; `UNSUPPORTED` on files collections |

Key types:

```ts
import type { DeleteResult, Entry, EntryStub, EntrySummary, SaveResult, ValidationResult } from "patcms"

// EntryStub:  { collection, slug, path, sha, title }
// EntrySummary: EntryStub + { value: EntryValue, issues: ParseIssue[] }
// Entry:      EntrySummary + { raw, untouched, fields, media }
//   raw       — decoded source bytes; the base for the next byte-preserving save
//   untouched — unmodeled keys by JSON Pointer; preserved verbatim on save

// SaveResult:
//   { status: "saved";    commitSha: string; entry: Entry }
//   { status: "noop";     entry: Entry }                      // zero-diff: no commit
//   { status: "conflict"; current: Entry; local: EntryValue } // a VALUE, never an exception

// DeleteResult:
//   { status: "deleted"; commitSha: string } | { status: "noop" } | { status: "conflict"; current: Entry }
```

## `cms.media`

| Method | Signature | Notes |
|---|---|---|
| `list` | `(options?: { collection?, includeTrash? }) => Promise<MediaFile[]>` | Trash listing: `path` = tombstone repo path (for `restore`), `publicPath` = restore target |
| `get` | `(publicPath, options?) => Promise<{ bytes: Uint8Array, type?: string }>` | Git blob API — never `raw.githubusercontent.com` |
| `upload` | `({ name, bytes }, options?: { collection?, overwrite?, allowSvg?, message? }) => Promise<MediaFile>` | Guards before network: empty → `VALIDATION`, > 90 MiB → `VALIDATION`, `.svg` → `VALIDATION` unless `allowSvg`, existing path → `CONFLICT` unless `overwrite` |
| `delete` | `(publicPath, options?: { collection?, checkReferences?, message? }) => Promise<MediaDeleteResult>` | `{ status: "deleted", commitSha }` or `{ status: "referenced", references }` — soft-deletes to `_trash/` |
| `restore` | `(trashPath, options?: { message? }) => Promise<MediaFile>` | Occupied destination → `CONFLICT` |
| `references` | `(publicPath, options?) => Promise<ReferenceLocation[]>` | `{ collection, slug, fieldPath, title?, altText? }` |
| `publicPath(repoPath)` / `repoPath(publicPath)` | pure conversions | `VALIDATION` outside the configured folders |

Filenames are sanitised before upload (NFKC, control chars stripped, `<>:"|?*` and whitespace →
`-`, ≤ 120 chars, extension/case preserved). No raster processing in the SDK — transform host-side.

## `cms.drafts`

| Method | Signature |
|---|---|
| `save` | `(entry, value) => Promise<void>` — persists `{ filePath, baseSha, baseRaw, formValue }` |
| `get` | `(entry: Pick<Entry, "collection" \| "slug">) => Promise<Draft \| undefined>` |
| `list` | `(collection?) => Promise<readonly Draft[]>` — newest first |
| `delete` | `(entry: Pick<Entry, "collection" \| "slug">) => Promise<void>` |

`Draft`: `{ collection, slug, path, savedAt, baseSha, baseRaw, value }`. Staleness check:
`draft.baseSha !== entry.sha` means the branch moved. After a successful save the client deletes
the draft for you.

## `cms.events`

`events.on(event, handler): () => void` with:

| Event | Payload |
|---|---|
| `auth:change` | `{ status }` |
| `save:start` | `{ entry }` — `save` only, not `create` |
| `save:success` | `{ entry, result }` — saved **or** noop |
| `save:conflict` | `{ entry, current }` |
| `save:error` | `{ entry, error: CMSError }` |
| `media:upload` | `{ file }` |
| `media:delete` | `{ path }` — only on actual deletion, not `referenced` |

## Errors

`isCMSError(value): value is CMSError`; `CMSError` carries `code`, `status?`, `retryAt?`
(RATE_LIMIT), `issues?` (VALIDATION from save/create), `cause` (original backend error — logs only,
never UI text).

| Code | Meaning |
|---|---|
| `AUTH_REQUIRED` | No token / signed out |
| `AUTH_EXPIRED` | Token lost write access mid-session (session wiped, drafts kept) |
| `FORBIDDEN` | Token lacks the scope (403), incl. probe refusal |
| `NOT_FOUND` | Entry or media path missing |
| `CONFLICT` | CAS collision or occupied path (saves return conflicts as values instead) |
| `RATE_LIMIT` | GitHub quota exhausted; `retryAt` says when |
| `NETWORK` | Transport failure |
| `VALIDATION` | Refused before any network call; `issues` attached |
| `UNSUPPORTED` | Disabled by config (`create: false`, …) or v1 scope |
| `INVALID_CONFIG` | Bad `createCMS` options |
| `UNKNOWN` | Unclassified |

`ParseIssue`: `{ path, code, message, severity: "error" | "warning" }` with codes `TYPE_MISMATCH`,
`MISSING_REQUIRED`, `INVALID_OPTION`, `OUT_OF_RANGE`, `PATTERN_MISMATCH`, `INVALID_DATE`,
`INVALID_PATH`, `LIST_TOO_SHORT`, `LIST_TOO_LONG`, `RELATION_UNKNOWN`, `RELATION_CHECK_FAILED`,
`UNKNOWN_FIELD_TYPE`, and warnings `UNMODELED_KEY` / `VIRTUAL_KEY_IGNORED` (a stored `slug` key).

## `patcms/web` (browser only)

| Export | Job |
|---|---|
| `createIdbDraftStore(options?)` | IndexedDB `DraftStore`; options `{ dbName?, storeName? }` |
| `clearIdbDraftStore(options?)` | Wipe drafts |
| `createIdbTokenStore(options?)` | IndexedDB `TokenStore`; options `{ dbName?, storeName?, key? }` |
| `createSessionTokenStore(key?)` | `sessionStorage`-backed `TokenStore` (tab lifetime) |
| `openPatcmsDatabase` / `createSharedStore` / `closePatcmsDatabases` / `PATCMS_IDB_STORES` | Shared-database plumbing |

## `patcms/advanced` (Node-safe)

Superset of the main entry minus the client. Highlights:

| Export | Job |
|---|---|
| `runSave({ backend, branch, changes, message? })` | One save attempt: fresh head → tree → commit → CAS ref update → verify |
| `createSaveCoordinator({ backend, branch, drafts, ... })` | Queue, draft parking, retries (1 s/4 s backoff), leases, subscriptions |
| `rebase({ formValue, dirtyPaths, oldBase, oldRaw, newBaseRaw })` | Field-level three-way merge; Result-shaped, never throws; reports contested paths |
| `adjudicateDraft({ backend, branch, record })` | Boot/lease-steal draft decision: `discard` / `offer` / `conflict` — conservative, never a silent write |
| `GithubBackend` | `{ owner, repo, token: string \| (() => string \| undefined), fetch, baseUrl? }` — the `GitBackend` seam |
| `createStatusReads(backend, branch)` / `createStatusWatcher(options)` | Deploy-status polling; the watcher is pure (inject `now`, `schedulePoll`, `random`) |
| `canonicalJson` / `parseJsonDocument` / `serializeDocument` / `jsonEqual` | Source-preserving JSON (newline style survives round-trips) |
| `safePath` / `safeUrl` / `parseUntrustedJson` / `slugify` / `mustacheLite` / `compareValues` | Safety and text toolkit |
| `calculateMediaBudget` / `isUploadSizeBlocked` / `findReferences` | Media math |

## Version note

patcms is 0.x — a minor release may break the API. Pin the version and read the changesets.
