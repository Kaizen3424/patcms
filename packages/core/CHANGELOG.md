# patcms

## 0.3.0

### Minor Changes

- 6fef825: Empty repositories are now supported end-to-end. Reads of a freshly created (zero-commit) repository treat it as "no content" — `entries.listPaths` returns `[]`, `entries.get` and the commit log behave as not-found/empty, and the GitHub 409 "Git Repository is empty" response is recognized as typed no-content instead of leaking an UNKNOWN error. The first save on an empty repository now bootstraps the repository: it creates the root commit and the branch in that one save; every later save is an ordinary fast-forward, and a race between two bootstraps resolves as a conflict value (never a force-push). Saving to a branch that does not exist on a repository that has commits now fails fast with a clear `NOT_FOUND` error naming the branch.
- b4b92ee: Removed three advanced surfaces that had no remaining consumers:
  
  - `SnapshotStore` and the `patcms/advanced` cache re-exports — superseded by the client's internal head/tree cache; hosts building a custom read layer should own their own cache.
  - The recorded-replay helpers (`createReplayFetch`, `buildMatchKey`, `canonicalizeJson`, `normalizeBodyString`, `normalizeRequestPath`, and the `RecordedTape` types) — test-harness machinery that does not belong on a public entry; it stays internal to the repo's recorded-tape tests.
  - The founder-surface display helpers `formatMoney`, `formatFriendlyDate`, `formatRelativeTime`, and `parseDate` — host UI conveniences with no consumer left; format dates and money in your own UI with `Intl`.

## 0.2.0

### Minor Changes

- 8c5f020: Adds all-or-nothing bulk writes: `entries.saveMany`, `entries.createMany`, and `entries.deleteMany` commit a whole batch once, check every base sha before writing, and return stale rows as conflicts with their current state. `saveMany` also accepts `list()` stubs, so a table can save edited rows without a per-row `get()`. One `entries:bulk` event fires per call.
- 10f4d24: Adds entry history and restore: `entries.history` pages the commits that touched one file (a `listPaths` stub is enough, so deleted entries keep their log), `entries.atRevision` reads a past version without writing, and `entries.restore` writes that version's exact bytes as a new commit — a deleted file is re-created, a file changed since you loaded it is a `conflict`, a file that already holds those bytes is a `noop`, and a version that no longer validates is refused with `CMSError("VALIDATION")`. History is never rewritten and the ref is never forced. One `entries:restore` event fires per call. The GitHub backend gains `listCommits` for path-filtered log paging.
- a2a4f26: Reads now reuse a head confirmed within 30 s (`readReuseMs`, default 30 000; `0` disables) and cache entry bodies by blob sha, so a repeat listing, an entry open right after a listing, and a re-open after `refresh()` download nothing. `refresh()` re-checks the ref only and keeps unchanged bodies. Parallel body reads are capped at 5 (`readConcurrency`), and the in-memory blob cache is LRU-bounded (`maxBlobBytes`, `maxBlobEntries`). Every write path still re-checks the head first, so the window can delay a foreign change on screen but never hide it from a save. Adds `deploy.propagationMs` and `DEFAULT_DEPLOY_PROPAGATION_MS` for the post-save "may take a moment" notice.
- 5c89dac: Adds an optional on-device content cache: `createCMS({ contentStore })`, with the IndexedDB adapter `createIdbContentStore()` from `patcms/web`. Entry text is keyed by path + blob SHA, so a warm open skips every unchanged document (183 → 3 requests for 180 entries). The store is bounded, pruned against the current tree, and wiped on sign-out and `clearCache()` — not on `destroy()`. `clearCache()` is now async.

## 0.1.0

### Minor Changes

- a56402d: The headless client: `createCMS()` with `auth`, `entries`, `media`, `drafts`, and `events`; saves are single fast-forward-only commits whose conflicts come back as values; unmodeled keys are preserved verbatim across saves; the surface is split into `patcms`, `patcms/advanced`, and `patcms/web`.
- b0b921b: P1 read path: zod-first config DSL, lenient parse and strict-save validator, source-preserving serializer, GitHub read backend with ETag/truncation handling, snapshot cache, PAT lifecycle and capability probe.
- cad4c33: Phase 4 media system: media service bijection & budget math (INV-M01), findReferences engine, media library tombstone ladder (INV-M03), and blob preview caching in the example panel. (The Web Worker raster normalization pipeline shipped only in the deleted reference admin.)
