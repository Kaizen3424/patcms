# ADR-0005 — Backend = transactional Git-Data commits with FF-CAS; capabilities object

**Status:** Accepted · 2026-10-27

## Context
Round-1 blocker 1: a file-op-shaped backend (contents-API PUTs) produces N commits + partial-failure races and cannot honor "one squash commit". Round-1/2 GitHub review established: `PATCH /git/refs` has NO expected-SHA parameter; the guard is the server-enforced fast-forward (`force:false`, 422 = moved); compare-API is truncating/patch-trimming; trees can truncate at 100k entries/7MB.

## Decision
- Write path (THE primitive): `commitChanges({adds, updates, deletes}, baseHeadSha)` → client SHA-1 precompute → `createBlob` (≤5 concurrent) → `createTree` **with `base_tree`** (only changed paths; NEVER client-assembled full trees) → `createCommit(parents=[verified head])` → `updateRef force:false`. `writesFile` = sugar for single-file docs. Retry = **verify-then-rebuild** (GET ref first — done/rebuild/conflict), never blind replay, never `force:true`.
- Reads: single recursive root tree GET cached by commit-sha + ETag (304s quota-free), per-collection client-side filtering, `truncated:true` → assert/preview + subtree-walk fallback; `listChangedFiles(baseSha, headSha)` = tree set-diff keyed `{path → {sha, mode, type}}`; >1MB content via `/git/blobs`; contents-dir 1000-cap unused for correctness decisions.
- Conflict predicate (fixes whole-file-block/overwrite): apply iff ∀ changed path `remoteTuple == baseTuple` OR `canon(remoteBytes)==canon(baseBytes)` (auto-rebase w/ warning; mode-only diff auto-restores w/ commit-body warning entry; type change blocks); challenge reads are **fresh** (never cached) — INV-P08.
- Branch = parameter on EVERY method (`getRef(branch)`, `commitChanges(..., branch)`); zero `main` literals (lint fixture INV-P14). Stage-B PR/staging mode plugs in without interface break.
- `capabilities` = required exhaustive literal object (`{commitStatus: boolean, branches: boolean, …}`) — adding a key breaks every implementation at compile time; optional method-shaped capabilities (e.g. `commitStatuses?(sha) → {state:'pending'|'success'|'failure'|'unsupported', url}`) accessed ONLY after capability check. Media service lives ABOVE the backend; folder policy is config not transport.

## Consequences
- Rate math documented (write burst ≈ 17 req/saves well under 900 pts/min & 5000/h; secondary limits handled by plugin-throttling + Retry-After policy).
- GithubBackend additionally covered by recorded HTTP fixtures from a sandbox repo (transport-drift hedge).
- `main`-hardcoding anywhere is a review-blocking defect.
### P0 verification (2026-10-27)
- Contract as code now: `GitBackend` (branch is a parameter on every method; `baseHeadSha` CAS; exhaustive boolean `capabilities` incl. `commitStatus`), the truncation assert `assertNotTruncated` + `Result` type (INV-N02 setup), and the shared contract-suite runner the fixture exemplar passes. Transport lands P1 (reads) / P2 (writes). No deviation.

### P1 addendum (2026-10-27) — read surface amendment
The P0 interface was a write-shaped skeleton; reads need their own surface. Supersedes the P0 method shape (not the laws):
- `TreeEntry` gains `path` (tree entries are useless without it); tuple equality remains `{sha, mode, type}` and path is the map key in diffs.
- Read methods (branch parameter on EVERY method, INV-P14):
  - `readTree(branch, commitSha, options?: { etag?: string }) → { kind: 'tree', tree, etag } | { kind: 'not-modified', etag? }`
  - `readFile(branch, path, blobSha, options?: { etag?: string }) → { kind: 'file', file, etag } | { kind: 'not-modified', etag? }`; the implementation uses the contents route for small files and `/git/blobs` for >1MB (including the contents-route fallback), never `raw.githubusercontent.com`.
  - `listChangedFiles(branch, baseSha, headSha) → Map<path, TreeEntryTuple>` — branch is now explicit (P0 omitted it; review defect fixed).
- ETag/conditional cache logic lives in the admin queryFns; the backend only sends `If-None-Match` and reports `not-modified`. No second cache in the transport.
- Recursive tree reads assert `!truncated`; on truncation the backend walks subtrees non-recursively and fails loudly if a subtree is still truncated (INV-N02).
- Read errors are a small typed set for P1 (`AUTH_EXPIRED`, `SCOPE`, `NOT_FOUND`, `RATE_LIMIT`, `NETWORK`, `UNKNOWN`); the full classified union + write cases lands P2.2.

### P2 addendum (2026-10-27) — write surface + driver placement (C.1)

- `commitChanges` gains an optional 4th parameter `options?: { message?: string }` — GitHub's `createCommit` requires a commit message. The pipeline supplies the machine-checkable default (`chore(cms): <summary>`, phase gotcha "code-free default"); skip-token rejection for user-editable messages lives in the pipeline (`inv-skip-token`, ADR-0008 §4), NOT in the transport.
- **Verify-then-rebuild is a pipeline driver above `commitChanges`** (`core/src/pipeline/`), not transport logic: the backend stays a thin CAS primitive (blobs → tree with `base_tree` → commit → FF `updateRef`). The driver owns the fresh-`getRef`-before-every-save rule (ADR-0004 state machine), the zero-diff skip (INV-S02 C.1 scope: prospective blob-sha set equality against the fresh base tree ⇒ no commit; content-addressing makes the resulting tree sha equal transitively), and unknown-outcome re-verification (done / rebuild / conflict, never blind replay — INV-P09).
- **Write error vocabulary** (completes the "full classified union" promised above): `BackendWriteError` codes `CAS_CONFLICT` (FF/ref-moved 422), `VALIDATION` (other 422 class, e.g. oversize tree/missing blob), `AUTH_EXPIRED`, `SCOPE`, `NOT_FOUND`, `RATE_LIMIT` (+`retryAfter`/reset), `NETWORK`, `UNKNOWN`. The classifier maps status + body class ONLY — response bodies never leak into messages (read-path precedent).
- **After-write failure hook**: the driver exposes `onAfterWriteFailure(code)`; the admin/PatProvider wiring re-probes on 401/403/422-after-write (completes the INV-A03 P1-parked partial at P2.5 wiring).
- **Reference fake**: `core/src/backend/fake-github-server.ts` — an HTTP-shaped, in-memory GitHub git-data model (refs/blobs/trees/commits, deterministic git framing, FF-only CAS, zero-dep). Core INV tests drive it through a `FetchLike` adapter; the playground's MSW FakeGithub delegates endpoint semantics to it so fixture and contract behavior share ONE source of framing/permission rules (ADR-0001/0009 posture). Chaos knobs live in the harness adapters, not in the truthful server model.

### P2.8 addendum (2026-10-28) — status reads are required methods, not optional capabilities

Supersedes the P0 sentence "optional method-shaped capabilities … accessed ONLY
after capability check" **as it applies to deploy status**. The status reads are
now required methods on `GitBackend` so every implementation confronts the
contract at compile time; the existing exhaustive boolean
`capabilities.commitStatus` remains the ONLY gate.

- `readCheckRuns(branch, sha) → { kind: "ok"; totalCount; runs } | { kind: "unsupported" }`
- `readCommitStatuses(branch, sha) → { kind: "ok"; statuses } | { kind: "unsupported" }`

Rules:
- capability `false` ⇒ `{ kind: "unsupported" }` with zero network I/O (the
  suite pins the shape; implementations own the no-I/O rule);
  capability `true` ⇒ truthful read; failures use the existing classified read
  errors (`AUTH_EXPIRED`, `SCOPE`, `NOT_FOUND`, `RATE_LIMIT`, `NETWORK`, `UNKNOWN`).
  403 + any `x-ratelimit-reset` is `RATE_LIMIT`, never `SCOPE`.
- `branch` stays a parameter on both methods (INV-P14 / provider parity) even
  where GitHub's route is sha-scoped.
- `per_page=100` for check-runs and `total_count` are pinned in the ADR-0008
  P2.8 appendix; an incomplete page is `unavailable`, never Live.
- No caching: status truth is polled fresh. This is not the content read cache
  and never feeds conflict decisions (INV-P08 untouched).

Contract suite: `STATUS_READ_CHECK` runs for every backend. With
`commitStatus:false` it asserts `unsupported` for both methods; with `true` it
asserts ok-shaped results and that both accept an arbitrary branch/sha without
touching a hard-coded branch. `SHAPE_CHECK` grows the two method names.

Reference fake: `FakeGithubServer` gains a stateful status model — check runs and
commit statuses attach to commit shas, setters (`setCheckRuns`, `setStatuses`)
drive it, and the routes resolve either a branch name or a 40-hex sha so the
login probe (`.../commits/{branch}/check-runs?per_page=1`) keeps working. The
playground's MSW FakeGithub delegates these routes to the core model (replacing
the P1 static stub) and keeps the single-branch fallback
(`server.ref(ref) ?? (40-hex ? ref : snapshot.headSha)`) so `checksRead` never
turns `missing` spuriously. `FixtureBackend` reports `ok` with empty collections when its
`commitStatus` capability is true; it invents no second truth source.

### P2/C.2 addendum — recursive reads surface `blob` + `commit` tuples (2026-10-27)

Found during INV-P06: the P1 recursive-tree parser dropped every non-`blob` entry, so a foreign submodule swap (`type: "commit"`) was invisible at the read layer and reached the conflict engine as a phantom deletion (spurious `resurrect`). That contradicts this ADR's own conflict predicate — the base→head diff is keyed `{path → {sha, mode, type}}` and "type change blocks" — tuple truth requires type variety to survive reads. Real GitHub recursive trees include submodule entries. Fix: recursive reads keep `blob` + `commit` entries (submodule swaps stay visible; INV-P06 end-to-end), and tree-POST validation accepts gitlink entries without requiring the pointer sha to exist in-repo (submodule targets live in external repos — real GitHub parity). `tree`-type children remain flattened containers (recursive mode returns none; the truncated-walk fallback assembles its own flat list). No law above changes — this restores what the reads bullet already promised.

### P2.11 addendum (2026-10-29) — Recorded fixture wire format, redaction rules, and replay semantics

Completes the Consequences note: *"GithubBackend additionally covered by recorded HTTP fixtures from a sandbox repo (transport-drift hedge)"*.

1. **Wire schema (`RecordedTape`):**
   - Serialized JSON containing:
     - `schemaVersion: 1`
     - `meta`: `{ schemaVersion: 1, recordedAt: string, owner: string, repo: string, branch: string, source: "sandbox" | "synthetic", description: string }`
     - `interactions`: list of `{ request, response }` where:
       - `request`: `{ method: string, url: string, headers?: Record<string, string>, body?: unknown }`
       - `response`: `{ status: number, statusText?: string, headers: Record<string, string>, body?: unknown }`
2. **Matching semantics (`createReplayFetch`):**
   - In-memory `FetchLike` implementation (`packages/core/src/backends/github/recorded-replay.ts`).
   - Grouping into a **Keyed-Endpoint FIFO Queue**:
     `matchKey = method + " " + pathnameAndQuery + (etag ? " [etag=" + etag + "]" : "") + (bodySha ? " [body=" + bodySha + "]" : "")`
   - Concurrent calls (e.g. `mapLimited(writes, 5)` in blob uploads) are disambiguated by body hash SHA-256.
   - Sequential monotonic calls (e.g. repeated `getRef` calls advancing HEAD from initial to committed to CAS head) are popped sequentially from the FIFO queue for that key.
   - Conditional requests (`If-None-Match`) match only when the incoming request supplies the header, cleanly separating 200 unconditional reads from 304 not-modified revalidations.
   - Headers: `response.headers.get(name)` performs case-insensitive retrieval (`headers[name.toLowerCase()] ?? null`).
   - Unmatched requests or exhausted queues throw descriptive errors listing the requested method, URL, key, candidate keys in tape, and remaining depths.
3. **Redaction & Security Laws (INV-A04 / INV-A05):**
   - Authorization headers: unconditionally scrubbed to `Bearer [token]` in all recorded requests.
   - Token scrubbing: raw token string passed to capture script is replaced globally across headers and payloads with `[token]`.
   - Committer PII: Git author and committer emails in responses are replaced with `cms-contract-bot@example.com`, names with `MyCMS Contract Runner`.
   - Header allowlist: responses keep only functional headers inspected by `GithubBackend` and write-error classifiers (`etag`, `content-type`, `x-ratelimit-limit`, `x-ratelimit-remaining`, `x-ratelimit-reset`, `x-ratelimit-resource`, `retry-after`). Volatile headers (`x-github-request-id`, `set-cookie`, `date`, `server`, etc.) are stripped. All header keys are lower-cased.
   - CAS error body preservation: HTTP 422 error bodies from GitHub (`Update is not a fast forward`, `ref update`, etc.) are preserved verbatim (minus token/email) so `classifyWriteResponse` correctly yields `CAS_CONFLICT`.
   - Fail-closed pre-write scan: capture script scans output for raw tokens (`ghp_*`, `github_pat_*`) or unmasked emails, failing immediately on detection.
4. **Parameterization & Branch Rules (INV-P14):**
   - Canonical placeholders: repository identity is parameterized (defaulting to `test-owner` and `test-repo`), allowing replay against any test owner/repo options without URL mismatches.
   - Branch names: fixtures and replay tests use `contract-fixture` or parameter variables; literal `"main"` is prohibited anywhere in core backends.
5. **Dual-source capture strategy:**
   - `--seed` mode uses `FakeGithubServer` to generate deterministic golden tapes offline, ensuring CI and offline builds pass without network or live GitHub credentials.
   - Live mode captures real traffic from a GitHub sandbox repo after resetting the fixture branch, satisfying the real-world transport drift hedge.

### P2.12 verification notes (2026-10-30)

Completed and verified by the P2.12 end-to-end journey test suite:
- Atomic Git data transactions, fast-forward CAS commits, and classified write error recovery verified end-to-end in the playground environment with MSW and Playwright across `e2e/specs/kill-tab.spec.ts`, `e2e/specs/parked-tx.spec.ts`, and `e2e/specs/publish-loop.spec.ts`.
- All Phase 2 invariants (`INV-P01` through `INV-P17`) are fully implemented and verified with green test suites.

### Phase 4 addendum — Tree entry size and content-addressed blob reading (2026-10-31)

1. **Tree entry size widening**:
   - `TreeEntryTuple` gains optional `readonly size?: number`.
   - `GithubBackend.readTree` parses `size` from blob items returned by GitHub's recursive `git/trees` endpoint and subtree walks.
   - `FakeGithubServer` and `ReferenceFixtureBackend` populate `size` for blob entries from stored/fixture bytes.
   - Preserves O(N) budget calculation across the repository without issuing N+1 network requests.
2. **Content-addressed blob reading**:
   - `GitBackend` adds `readBlob(sha: string): Promise<Uint8Array>`.
   - Directly calls `GET /git/blobs/:sha` with authenticated headers; returns decoded binary bytes.
   - Content-addressed: does not take a branch or path parameter because Git blob SHAs are immutable.
   - Verified across all backends via `CORE_CONTRACT_SUITE` (`BLOB_READ_CHECK`).


