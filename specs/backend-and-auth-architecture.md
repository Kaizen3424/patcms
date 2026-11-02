# Backend and auth

> Parent: [`specs/CMS.md`](CMS.md)

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
| Auth error during work | Mark the session expired, keep drafts, require a fresh `auth.signIn()` |

Stores (`packages/core/src/web/token-stores.ts`): IndexedDB `patcms` / `auth` is the opt-in persistent
store, `sessionStorage` is the per-device fallback, and `MemoryTokenStore` is for tests. The probe
result is **never persisted** — only the token may be.

**Shared-IDB gotcha.** `auth` and `drafts` share one `patcms` database (`PATCMS_IDB_STORES` in
`packages/core/src/web/idb-store.ts` is `["auth", "drafts"]`). `idb-keyval` only creates its store
during `onupgradeneeded`, which fires once — so the second adapter to open the database would get
`NotFoundError` on its first transaction. `packages/core/src/web/idb-store.ts` opens the database
once, declares every store up front, and bumps the version if one is missing. **Add a new store to
that array in the same change that starts using it**, or that adapter fails only on fresh profiles.
The reference admin's journal/onboarding/discard stores open their own databases through
`createSharedStore`; they are admin-owned and never part of the published schema.

## The contract suite

`CORE_CONTRACT_SUITE` (`packages/core/src/__tests__/support/contract-suite.ts`) is the admission gate.
`GithubBackend`, `FakeGithubServer`, and any future backend must all pass it. It pins shape, ref and
tree reads, byte-identical file reads, ETag revalidation, empty diffs, status read shape, CAS
behaviour, and commit semantics. It is test-only: it lives under `src/__tests__/support/` and is never
exported from a public entry.

If you add a capability to `GitBackend`, add its check here in the same change — otherwise the suite
stops being a gate and becomes decoration.

## Probe

`probeGithubCapabilities` (`packages/core/src/backend/github/probe.ts`) reads rate limit, repo,
branch-protection admin, and check-runs. Checks-read may be `missing` or `forbidden` without blocking
login: private repos often cannot read check-runs with a fine-grained PAT, so the UI shows status as
unavailable rather than an error.

## Decisions and claims

### Decisions

| ID | The rule that still binds |
|---|---|
| ADR-0001 | Everything is injected at one composition root. For hosts that is `createCMS(options)` (`packages/core/src/client/create-cms.ts`), which wires backend, cache, auth, and drafts behind the seams; low-level hosts compose the same pieces by hand from `patcms/advanced`. Core imports no concrete IDB, session, or network implementation — those live behind interfaces (`composition.ts` `FetchLike`, `TokenStore`, `DraftStore`), which keeps the main entry Node-safe. Every backend must pass the shipped contract suite, so a fake cannot silently drift from the real transport. |
| ADR-0002 | The token is persisted only behind an explicit "Remember on this device" opt-in, with `sessionStorage` as the per-device fallback. Hard conditions: wipe on sign-out, wipe on a 401 after a failed re-probe, bootstrap is restore → re-probe → wipe-on-failure, and a token never appears in a URL or query string. Draft lifecycle is orthogonal — a 401 wipe never touches drafts. No fabricated expiry UI: GitHub cannot introspect PAT expiry. |
| ADR-0005 | The write primitive is blobs (≤ 5 concurrent) → tree with `base_tree` → commit naming the verified head as parent → fast-forward-only `updateRef`. Verify-then-rebuild lives in the pipeline driver, not the transport, which stays a thin CAS primitive. Reads are one recursive tree cached by commit sha plus ETag, with `truncated` handled by a subtree walk. The conflict predicate is tuple-or-canon equality over fresh challenge reads. `branch` is a parameter on every method and `capabilities` is an exhaustive literal object. Status reads are required methods gated only by `capabilities.commitStatus`. |

### Claims

| ID | Claim | Enforcing test |
|---|---|---|
| INV-A01 | A 401 mid-work marks the session expired (`AuthController.markExpired`), keeps drafts, and surfaces re-auth to the host; hosts re-probe before resuming in place (the example panel re-signs in via the expired session) | `packages/core/src/client/__tests__/client.test.ts` |
| INV-A02 | The error classifier maps 404/403/401/422 to named guided screens, and no founder surface ever shows GitHub prose | `packages/core/src/pipeline/__tests__/inv-error-taxonomy.test.ts` |
| INV-A03 | The capability probe runs at login, is never persisted, and re-runs on 401/403/422-after-write; quota-blocked windows are never entered | `packages/core/src/backend/github/__tests__/inv-probe.test.ts` |
| INV-A04 | A token never appears in a URL or query string, is reachable only through the auth provider, and is wiped on sign-out, failed bootstrap, or 401 | `packages/core/src/auth/__tests__/inv-token-hygiene.test.ts` |
| INV-A05 | Log masking covers `authorization`, `token`, `secret`, and `x-github-*` keys plus `github_pat_…`, `ghp_…`, and email values; the ring buffer is memory-only | `packages/core/src/safety/__tests__/inv-log-masking.test.ts`, `packages/core/src/safety/__tests__/logger-masking.test.ts` |
| INV-N01 | Concurrency stays ≤ 5, `Retry-After` and `X-RateLimit-Reset` are honoured, and primary exhaustion parks with a countdown that wakes event-driven | `packages/core/src/pipeline/__tests__/inv-rate-policy.test.ts` |
| INV-N02 | Recursive tree reads assert `!truncated` and fall back to a subtree walk instead of treating truncation as mass deletion | `packages/core/src/backend/__tests__/inv-truncation.test.ts` |
| INV-P01 | Ref updates are fast-forward only: a concurrent push yields a typed conflict, HEAD is unchanged, and the request log holds zero `force:true` PATCHes | `packages/core/src/pipeline/__tests__/inv-ff-only.test.ts` |
| INV-P02 | A fault between blob, tree, commit, and ref leaves HEAD unchanged, and a retry reconciles to exactly one commit | `packages/core/src/pipeline/__tests__/inv-atomicity.test.ts` |
| INV-P03 | Retried blob and tree calls converge on equal SHAs, and the ref is updated exactly once | `packages/core/src/pipeline/__tests__/inv-idempotent-retry.test.ts` |
| INV-P06 | Path identity is the tuple `{sha, mode, type}`: a mode-only drift auto-restores with a commit-body note, and a type change blocks | `packages/core/src/pipeline/__tests__/inv-tuple-predicate.test.ts` |
| INV-P14 | `branch` is a parameter on every backend and pipeline call — zero `main` literals — and branch names are URL-encoded including `+` | `packages/core/src/backend/__tests__/inv-branch-param.test.ts` |
| INV-N06 | Branch-addressed GETs (ref, contents) and the capability probe are fetched with `cache: "no-store"` — GitHub answers the ref route with `max-age=60`, so a browser HTTP cache would otherwise serve a stale head after a foreign commit; SHA-addressed reads (trees, commits, blobs, statuses) stay cacheable | `packages/core/src/backends/github/__tests__/github-backend.test.ts`, `packages/core/src/backend/github/__tests__/inv-probe.test.ts` |
