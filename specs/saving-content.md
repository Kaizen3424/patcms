# Publish and recovery

> Parent: [`specs/README.md`](README.md)

The save path is the part of this repo you cannot infer from a quick read. It is deliberately
over-built because its failure modes — lost work, double commits, silent overwrites — are the
product's whole value proposition.

Two consumers drive this machinery. `createCMS()` is the default path: `entries.save` runs the driver
directly and returns conflicts as a value (`{ status: "conflict", current, local }`). Hosts that want
queueing, parking, leases, or boot adjudication assemble them from `patcms/advanced` — the deleted
reference admin was one such consumer; the example panel needs neither and uses the default path.

## Cast

| Piece | File and symbol | Job |
|---|---|---|
| State machine | `packages/core/src/pipeline/save-machine.ts` (`SAVE_PHASE_ORDER`) | One transition table; illegal pairs are no-ops, never throws |
| Driver | `packages/core/src/pipeline/save-driver.ts` (`runSave`) | One attempt: reads, commit, classify, verify — the only piece `createCMS()` needs |
| Coordinator | `packages/core/src/pipeline/save-controller.ts` (`createSaveCoordinator`) | Queue, drafts, parking, retries, subscriptions (advanced surface) |
| Rebase | `packages/core/src/pipeline/rebase.ts` (`rebase`) | Field-granular three-way merge, Result-shaped, never throws |
| Invariant engine | `packages/core/src/pipeline/invariant-engine.ts` | Classifies a draft against head: clean-reapply, adopt-remote, field-merge, blocked |
| Boot adjudication | `packages/core/src/pipeline/boot-replay.ts` (`adjudicateDraft`) | Boot and lease-steal decision: discard, offer, conflict (advanced surface) |
| Deploy status | `packages/core/src/status/classify.ts`, `watcher.ts` | Truth matrix and polling |

## Phases

`editing → dirty → queued → committing → published | conflict | failed | paused`.

- `failed` retries with backoff, then parks as `paused(manual)`.
- `paused` carries a reason: `network`, `auth`, or `quota`. Each resumes differently; drafts survive
  all three.
- Progression is callback-driven (`subscribe`). The only timers are injected wakes (rate window,
  backoff) — never a polling loop inside the machine.

## What the driver does, in order

1. Reject a message containing a skip token — **before any network call**.
2. Read a **fresh** branch ref and a fresh base tree. Challenge reads never consult a cache and never
   send conditional headers. On an **empty repository** (ADR-0011, below) the read is a typed
   `EMPTY_REPO` and the base binds as `""`; a missing branch on a non-empty repository refuses the
   save here, before any write, with a branch-named `NOT_FOUND`.
3. Zero-diff changeset → return `noop` with **zero writes**.
4. `commitChanges` = blobs → tree with `base_tree` → commit naming the verified head as parent →
   FF-only ref update. With an empty-string base (zero-commit repo) the same call instead
   bootstraps through the contents API (see ADR-0011 below — the git-data API is closed there).
5. Classify the failure:

| Failure | Verdict | Behaviour |
|---|---|---|
| Ref moved / not a fast forward | `conflict` | Fresh challenge reads, no retry loop |
| Network class | `published` or a rebuild | Verify-then-rebuild: if head already carries our content, publish; otherwise rebuild on the same verified base |
| Rate limit | `parked` | Park until the reset window; event-driven resume |
| Auth, scope, or validation | `failed` | Auth pauses the queue; drafts stay |
| Branch missing on a non-empty repo | `failed` (`NOT_FOUND`) | Message names the branch; refused before any write |
| Zero diff | `noop` | No commit at all |
| Caller cancels | `cancelled` | No further writes |

6. Confirm by **content**, not by response code, that the remote now holds what we wrote. A 200 from
   the ref update is not proof; the observed head is.

## Empty repositories (ADR-0011)

Gotcha (bit for real, twice): a repository with zero commits — every freshly created one — has no
branch to read, and **GitHub answers branch-addressed reads of it with HTTP 409, not 404**, carrying
a "Git Repository is empty" body. The same 409 fires on every branch-addressed WRITE to the entire
git-data API of that repo — blobs, trees, commits, and both ref routes. Other 409s exist, so the
body class is the discriminator (`EMPTY_REPO_BODY_SIGNATURE` in `packages/core/src/backend/errors.ts`),
never the status alone; the read classifier and the write classifier (`classifyWriteResponse` in
`packages/core/src/backend/write-errors.ts`) must both consult it and change together.

One empty-repo mode everywhere:

- Reads see no content. `entries.listPaths` is `[]`, `entries.get` is a missing entry, the commit log
  is empty, and the client binds no head — the empty snapshot keys under the canonical empty tree sha
  (`GIT_EMPTY_TREE_SHA1`, pinned in `git-sha.test.ts`). Nothing surfaces as UNKNOWN.
- The first save is the bootstrap, and the git-data API is INVISIBLE to it. `commitChanges` with an
  empty-string base does its work through the REST contents API — `PUT /contents/{path}` with no
  `sha` — which is the one write GitHub keeps open on a zero-commit repo; GitHub creates the root
  commit AND the branch in that single request (never patched afterwards, nothing forced).
- A save that changes exactly one add/update IS that one PUT: one tidy commit per save also on the
  first save. A multi-file save seeds its lexicographically-first add/update through the PUT and then
  runs the ordinary pipeline on top of the seed commit — exactly two commits, the documented
  bootstrap exception to one-commit-per-save; both carry the save message (deploy-muting skip-token
  law, ADR-0008). Delete-only changesets against an empty repo are a `noop` by the zero-diff law.
- The bootstrap CAS is the parent chain. The seed commit must BE a root commit: if it has a parent,
  the branch materialized between the ref read and the PUT (another writer won) and the save refuses
  as a conflict value. GitHub's contents API has no atomic "create only if the branch is absent", so
  a disjoint-path race may land its PUT as a child of the winner's head before refusing — the ref is
  never forced back; the host's next rebind consumes reality. A same-path race never lands: the
  missing-sha 422 ("sha" wasn't supplied) classifies as CAS_CONFLICT before any mutation.
- Empty ≠ branchless. A missing branch on a repository that HAS commits is refused with
  `GitHub branch not found: {branch}` before any write — as is a missing repository behind sign-in's
  probe. Only the zero-commit repo takes the bootstrap path.

Enforcing tests: `packages/core/src/client/__tests__/empty-repo.test.ts` (end to end), the transport
check `backend-writes/empty-repo-bootstrap` in `packages/core/src/__tests__/support/contract-suite.ts`,
and the model laws in `packages/core/src/backend/__tests__/fake-github-server.test.ts`.

## History and restore

`entries.history` pages the path-filtered commit log; `atRevision` reads one historical tree + blob;
`restore` reuses the same save driver with the historical **bytes**.

- History binds to a path, not to a live file: a `listPaths` stub is enough, so a deleted entry's log
  stays reachable. GitHub's `sha` paging param is inclusive, so the client asks for `limit + 1` and
  drops the cursor row — a page never repeats.
- `atRevision` never touches the head cache: a historical tree goes through the in-flight map only, and
  blob reads stay content-addressed (a sha is immutable, so the normal blob cache is safe).
- `restore` is a normal CAS write, never a force: `noop` when the current blob sha already equals the
  historical one, `conflict` when the file changed since the entry/stub was loaded, an add when the
  file is gone. Unrelated-path CAS losses retry once, like `save`.
- A historical value must pass today's `validateEntryForSave` gate; failure is `CMSError("VALIDATION")`
  with zero writes. The escape hatch is `atRevision` + a deliberate `save` by the host.
- Success is confirmed by content like any write; the event is `entries:restore` with the **new**
  commit sha. History itself is never rewritten, so a restore shows up as a new revision.

## Draft law

- Key: `${repo}/${collection}/${slug}`. Staged media lives under `${key}/media/${n}`.
- Persisted payload: `{filePath, baseSha, baseRaw, formValue}` — `SaveDraftPayload` in
  `packages/core/src/drafts/index.ts`.
- `oldBase` and `dirtyPaths` are **never persisted**; they are derived at boot from `baseRaw`, so a
  stored record can never contradict the field-granularity law.
- Order is: write draft → first network call → … → verify ref → delete draft. Nothing else deletes
  it. A crash between the last two steps leaves a draft, which is the correct outcome.

## Boot and lease-steal share one adjudication

`adjudicateDraft` receives a fresh head and returns exactly one verdict:

| Verdict | Meaning | Effect |
|---|---|---|
| `discard` | Head already carries our content (parse-equal or byte-equal) | Delete the draft, no prompt |
| `offer` | A clean apply is possible | "Resume your unsaved changes?" — nothing writes until confirmed |
| `conflict` | Real overlap, or a blocked class (resurrect, type change, delete-vs-edit, unreadable) | Straight into the freeze UI |

- Boot **never auto-writes**.
- The cross-tab lease is UX serialisation only; the CAS is the sole correctness mechanism. Stealing a
  lease triggers the same full adjudication, not a fast path.

## Conflict rendering (host responsibility)

The default client has no freeze UI: a conflict is a returned value and the host decides. The example
panel shows the minimal viable policy (`playground/src/panel/lib/conflict.ts`, `screens/EntryScreen.tsx`):

- Render **current vs local per field** in a table; the host picks which side to keep per field.
- Untouched keys of the current version are preserved either way — the host never re-serialises
  fields it does not render.
- "Save selected" publishes exactly the chosen bytes; the next save diffs against the reconciled
  tree (INV-P17).

The deleted reference admin layered a freeze model on top (minimal contested nodes, keystroke replay
while saving); a host that wants that assembles it from `patcms/advanced`.

## Deploy status

Two sources, strict precedence:

| Source | When used | Success |
|---|---|---|
| Check runs | Primary, when the backend supports it | Every relevant run concluded `success` |
| Commit statuses | Only for the exact contexts in `config.deploy.contexts`, and only when checks are not decisive | All configured contexts `success` |

- `neutral` and `skipped` never count as success; a skipped-only set is `unavailable`.
- Failure outranks a still-running sibling.
- No decisive result within the grace window (120 s default) → `unavailable`, **never** `failed`.
- Read errors degrade to `unavailable`.
- Polling 5 s → 10 s, 10-minute ceiling, ±20% jitter (`DEFAULT_STATUS_TIMING`).
- Head advances while watching → the watcher is superseded and stops. A stale snapshot is never
  presented as current.
- One watcher per watched sha; the host refcounts (the deleted reference admin kept a registry at
  `status/registry.ts` — the SDK provides `createStatusWatcher`, one watcher per call). Head
  advancement supersedes the old watcher.

## Where to change what

| You want | Touch |
|---|---|
| A new failure class | `packages/core/src/backend/write-errors.ts`, the coordinator's verdict map, and the host's UI copy |
| Different empty-repo detection or read/write mapping | `packages/core/src/backend/errors.ts` (signature), the write classifier in `packages/core/src/backend/write-errors.ts`, the read classifier in `packages/core/src/backends/github/index.ts`, and the readers — change all together, the contract suite check holds them to it |
| Different retry or parking policy | `save-controller.ts` and `rate-policy.ts`; keep resume event-driven |
| Different conflict granularity | `rebase.ts` and `field-paths.ts` — they must agree |
| Different status timing | `DEFAULT_STATUS_TIMING`; a host passes its own `StatusTiming` to `createStatusWatcher` |
| Different recovery prompts | `boot-replay.ts` verdicts; the host renders the copy |

## Decisions and claims

### Decisions

| ID | The rule that still binds |
|---|---|
| ADR-0004 | Dirty is decided in the value domain with codepoint-exact `fieldEquals` (list order significant); the merge is performed in the raw domain, so untouched bytes are copied verbatim. Unknown keys come only from the new raw — old unknowns never resurrect — and a no-op is byte equality, never a re-serialisation. One state machine, one transition table, eight phases. A fresh `getRef` runs before every commit. Published is confirmed by content, not by a response code. Boot replay goes through the same invariant engine, and progression is callback-driven. The cross-tab lease is token + heartbeat + TTL + silent steal + full rebaseline; it is UX serialisation only, and the CAS remains the sole correctness mechanism. |
| ADR-0008 | Check-runs are primary on our exact sha; commit statuses are consulted only for the exact contexts in `deploy.contexts`, and only when the check-run set has no decisive result. Any failure conclusion is `failed` and outranks a still-running sibling; any non-completed run is `building`; all-success is `live`; `neutral` and `skipped` never mask a success. No decisive result inside the grace window is `unavailable`, never `failed`, and any read error is `unavailable` and stops the watcher. Reads use `per_page=100` and surface `total_count`; an incomplete page is unavailable. Generated and editable commit messages reject every skip token. Chips key to the entry's `latestCommitSha`, and head advancement supersedes the old watcher. |
| ADR-0011 | Empty repositories are usable end-to-end. GitHub's 409 "Git Repository is empty" classifies as a typed `EMPTY_REPO` error on reads AND writes (every reader treats it as "no content"; the write classifier maps it to `EMPTY_REPO`, never VALIDATION). The first save binds no base and bootstraps through the REST contents API — the git-data API is closed on a zero-commit repo — as ONE contents PUT when the save changes a single add/update (GitHub creates the root commit and the branch in that request), or a seed PUT plus one ordinary commit for a multi-file save. The bootstrap CAS is the parent chain: the anchored commit must be a root commit, a raced branch refuses as a CAS conflict, and nothing is ever forced. A missing branch on a non-empty repository refuses the save before any write with `GitHub branch not found: {branch}`. The FakeGithub model owns the truthful empty-state laws (closed git-data, contents-PUT bootstrap); the contract suite's empty-repo check keeps every backend implementation honest. |

### Claims

| ID | Claim | Enforcing test |
|---|---|---|
| INV-P04 | Overlapping saves serialise to exactly one ref update per save, and the second save rebases on the first's commit | `packages/core/src/pipeline/__tests__/inv-one-flight.test.ts` |
| INV-P05 | The same-file predicate applies only when every changed path is clean-reapply, adopt-remote, or mode-restore; drifted same-file blocks at field granularity, drifted other files auto-reapply | `packages/core/src/pipeline/__tests__/inv-conflict-predicate.test.ts` |
| INV-P07 | Formatting-only foreign commits auto-rebase silently; semantic drift is never false-passed | `packages/core/src/pipeline/__tests__/inv-canon-relax.test.ts` |
| INV-P08 | Challenge reads never come from an ETag or sha cache; a poisoned stale cache still blocks on real drift | `packages/core/src/pipeline/__tests__/inv-fresh-binding.test.ts` |
| INV-P09 | An unknown-outcome retry re-reads the ref first and classifies done / rebuild / conflict — never a blind replay | `packages/core/src/pipeline/__tests__/inv-verify-rebuild.test.ts` |
| INV-P10 | Published means the ref is observed to carry our content; orphan blobs are never "cleaned up" | `packages/core/src/pipeline/__tests__/inv-published-truth.test.ts` |
| INV-P11 | A rate-limited save parks with drafts already in IndexedDB, then resumes with no loss and no duplicate commit | `packages/core/src/pipeline/__tests__/inv-parked-tx.test.ts` |
| INV-P12 | Killing the tab mid-commit leaves a draft that boot replays as discard, offer, or conflict; the draft is deleted only after ref verification | `packages/core/src/pipeline/__tests__/boot-replay.test.ts` |
| INV-P13 | The cross-tab lease is TTL plus heartbeat with a storage-event fallback, and its payload never carries content or credentials | `packages/core/src/pipeline/__tests__/inv-save-lease.test.ts` |
| INV-P17 | After an auto-merge the next save diffs against the reconciled tree, so it cannot revert a partner's disjoint edits | `packages/core/src/pipeline/__tests__/save-controller.test.ts` |
| INV-P18 | A restore lands the historical blob sha as a new commit, returns `noop`/`conflict`/`VALIDATION` without writing when the rules say so, and never forces the ref | `packages/core/src/client/__tests__/history.test.ts` |
| INV-P19 | On a zero-commit repository reads see no content (`listPaths` is empty, `get` is missing-entry), the first save publishes through the contents API (one PUT per single-file save; seed + one commit for multi-file), the second save is a ref-PATCH fast-forward, a losing bootstrap is a CAS conflict (same-path before any mutation; disjoint-path may land its child PUT while still refusing), and saving to a missing branch on a non-empty repo fails `NOT_FOUND` naming the branch | `packages/core/src/client/__tests__/empty-repo.test.ts`, `packages/core/src/backends/github/__tests__/empty-repo.test.ts` |
| INV-D01 | Check-runs are primary, statuses only through `contexts[]`, and only an all-success sha is Live; an absent result inside the 120 s grace is unavailable, never failed | `packages/core/src/status/__tests__/inv-status-truth.test.ts` |
| INV-D02 | Generated and editable commit messages reject the four skip tokens before any network call | `packages/core/src/pipeline/__tests__/inv-skip-token.test.ts` |
| INV-D03 | Head advancement annotates "superseded by {sha}" and stops the watcher; a late run never repaints newer state | `packages/core/src/status/__tests__/inv-supersede.test.ts` |

> INV-P15 and INV-P16 were retired with `packages/admin` (P2 parity, 2026-11-01): the save sweep and
> the freeze model were reference-admin UX, not SDK behaviour. The surviving contract — conflicts are
> values the host resolves, and a resolved save publishes exactly the chosen bytes — is owned by
> ADR-0004 and the client tests.
