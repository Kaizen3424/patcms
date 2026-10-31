# Backend and auth

> Parent: [`specs/MyCMS.md`](MyCMS.md)

Everything the app knows about the outside world goes through one interface. Adding a backend means
implementing that interface and passing the contract suite — not editing the pipeline.

## The contract

`GitBackend` (`packages/core/src/backend/types.ts`) is the only transport surface core knows:

| Method | Purpose |
|---|---|
| `getRef(branch)` | Current head |
| `readTree(branch, commitSha, options?)` | Recursive root tree; callers must reject truncation |
| `readFile(...)` / `readBlob(sha)` | File bytes; `readFile` supports conditional reads |
| `listChangedFiles(...)` | Diff between two commits |
| `commitChanges(branch, changes, options)` | The transactional write |
| `readCheckRuns(branch, sha)` / `readCommitStatuses(branch, sha)` | Deploy truth |

Capabilities are exhaustive literal booleans (`GitBackendCapabilities`), so a backend that cannot read
checks says so instead of throwing at runtime.

**Branch law:** `branch` is a required parameter on every method. There is no default branch anywhere
in core or the pipeline. Hardcoding `main` is a standing veto.

## The write transaction

`GithubBackend.commitChanges` (`packages/core/src/backends/github/index.ts`):

1. Read the current ref — fresh, on every attempt.
2. Create blobs for every added or changed file, pooled at ≤ 5 concurrent uploads.
3. Create a tree with `base_tree` set to the verified head tree; deletions use `sha: null`.
4. Create a commit whose parent is the verified head.
5. Update the ref **fast-forward only** — no `force`.

Any stage failing leaves HEAD untouched, and a retry reconciles to exactly one commit. That is the
atomicity guarantee, and it is tested stage by stage.

Why this order: GitHub's git-data API is the only way to make a multi-file change atomic. The
Contents API commits one file at a time and would produce partial publishes.

## Reads

- File bodies and previews come from the **git blob API**. `raw.githubusercontent.com` is banned: it
  would leave the token-scoped API surface and violate the origin allowlist.
- Conditional reads use ETags, and a `304` is a valid result. But **challenge reads in the save path
  never send conditional headers** — a cached answer must not decide a conflict.
- Recursive tree reads can truncate. Callers must detect it and fall back to sub-tree reads; a
  truncated tree treated as complete looks exactly like mass deletion.

## Errors

Two typed families, both carrying `status`, `retryAfter`, and `resetAt` where available:

| Family | File | Codes |
|---|---|---|
| Read | `packages/core/src/backend/errors.ts` | `AUTH_EXPIRED`, `SCOPE`, `NOT_FOUND`, `RATE_LIMIT`, `NETWORK`, `TREE_TRUNCATED`, `UNKNOWN` |
| Write | `packages/core/src/backend/write-errors.ts` | The same plus `CAS_CONFLICT`, `VALIDATION` |

Response bodies never enter messages. The admin maps codes to prose through the copy deck; the
transport never writes user-facing text.

## Rate and concurrency

- Blob uploads are pooled at **5 concurrent** in `GithubBackend.commitChanges`.
- `Retry-After` and `X-RateLimit-Reset` are carried verbatim into typed errors.
- Primary exhaustion surfaces a reset countdown and **parks** the save. Resume is event-driven, never
  a busy poll.
- Secondary-limit responses are treated as backoff, not failure.
- `createConcurrencyLimiter` in `packages/core/src/pipeline/rate-policy.ts` is the reusable FIFO gate;
  it is currently exercised by tests rather than wired into the backend, so do not assume it governs
  real writes.

## Auth lifecycle

`PatProvider` (`packages/core/src/auth/pat-provider.ts`) is the whole state machine:

| Step | Behaviour |
|---|---|
| Sign in | Probe, then keep the token in memory only after success |
| Remember | Explicit opt-in writes to the injected `TokenStore` |
| Bootstrap | Restore → re-probe → **wipe on failure** → login card |
| Sign out | Wipe memory and store |
| Auth error during work | Pause the queue, keep drafts, require `resumeAuth()` |

Stores (`packages/core/src/web/token-stores.ts`): IndexedDB `mycms` / `auth` is the opt-in persistent
store, `sessionStorage` is the per-device fallback, and `MemoryTokenStore` is for tests. The probe
result is **never persisted** — only the token may be.

**Shared-IDB gotcha.** `auth`, `drafts`, `journal`, `onboarding`, and `discards` share one `mycms`
database. `idb-keyval` only creates its store during `onupgradeneeded`, which fires once — so the
second adapter to open the database would get `NotFoundError` on its first transaction.
`packages/core/src/web/idb-store.ts` opens the database once, declares every store in
`MYCMS_IDB_STORES`, and bumps the version if one is missing. **Add a new store to that array in the
same change that starts using it**, or that adapter fails only on fresh profiles.

## The contract suite

`CORE_CONTRACT_SUITE` (`packages/core/src/backend/contract-suite/`) is the admission gate.
`GithubBackend`, `FakeGithubServer`, and any future backend must all pass it. It pins shape, ref and
tree reads, byte-identical file reads, ETag revalidation, empty diffs, status read shape, CAS
behaviour, and commit semantics.

If you add a capability to `GitBackend`, add its check here in the same change — otherwise the suite
stops being a gate and becomes decoration.

## Probe

`probeGithubCapabilities` (`packages/core/src/backend/github/probe.ts`) reads rate limit, repo,
branch-protection admin, and check-runs. Checks-read may be `missing` or `forbidden` without blocking
login: private repos often cannot read check-runs with a fine-grained PAT, so the UI shows status as
unavailable rather than an error.
