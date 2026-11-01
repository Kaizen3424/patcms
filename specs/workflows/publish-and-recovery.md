# Publish and recovery

> Parent: [`specs/CMS.md`](../CMS.md)

The save path is the part of this repo you cannot infer from a quick read. It is deliberately
over-built because its failure modes — lost work, double commits, silent overwrites — are the
product's whole value proposition.

## Cast

| Piece | File and symbol | Job |
|---|---|---|
| State machine | `packages/core/src/pipeline/save-machine.ts` (`SAVE_PHASE_ORDER`) | One transition table; illegal pairs are no-ops, never throws |
| Driver | `packages/core/src/pipeline/save-driver.ts` (`runSave`) | One attempt: reads, commit, classify, verify |
| Coordinator | `packages/core/src/pipeline/save-controller.ts` (`createSaveCoordinator`) | Queue, drafts, parking, retries, subscriptions |
| Rebase | `packages/core/src/pipeline/rebase.ts` (`rebase`) | Field-granular three-way merge, Result-shaped, never throws |
| Invariant engine | `packages/core/src/pipeline/invariant-engine.ts` | Classifies a draft against head: clean-reapply, adopt-remote, field-merge, blocked |
| Boot adjudication | `packages/core/src/pipeline/boot-replay.ts` (`adjudicateDraft`) | Boot and lease-steal decision: discard, offer, conflict |
| Freeze model | `packages/admin/src/editor/freeze-model.ts` | Minimal contested nodes and row decisions |
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
   send conditional headers.
3. Zero-diff changeset → return `noop` with **zero writes**.
4. `commitChanges` = blobs → tree with `base_tree` → commit naming the verified head as parent →
   FF-only ref update.
5. Classify the failure:

| Failure | Verdict | Behaviour |
|---|---|---|
| Ref moved / not a fast forward | `conflict` | Fresh challenge reads, no retry loop |
| Network class | `published` or a rebuild | Verify-then-rebuild: if head already carries our content, publish; otherwise rebuild on the same verified base |
| Rate limit | `parked` | Park until the reset window; event-driven resume |
| Auth, scope, or validation | `failed` | Auth pauses the queue; drafts stay |
| Zero diff | `noop` | No commit at all |
| Caller cancels | `cancelled` | No further writes |

6. Confirm by **content**, not by response code, that the remote now holds what we wrote. A 200 from
   the ref update is not proof; the observed head is.

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

## Conflict freeze

- Frozen paths are **minimal common nodes** — a whole list or parent object, never a leaf when a
  parent is contested.
- Contested subtrees render as plain text (trust policy).
- Decisions edit the form only. Save stays blocked until every row is decided.
- Keystrokes typed while saving replay onto the reconciled tree. Chosen-over-keystrokes is never
  allowed.
- Auto-merge is allowed **with announcements**: adopting remote changes, including deletions, warns.
  It never silently wins. If the user then saves, the reconciled base is adopted so the next save does
  not revert the partner edit.

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
- One refcounted watcher per sha (`packages/admin/src/status/registry.ts`); N chips on one commit
  share one poller.

## Where to change what

| You want | Touch |
|---|---|
| A new failure class | `packages/core/src/backend/write-errors.ts`, the coordinator's verdict map, and the copy deck |
| Different retry or parking policy | `save-controller.ts` and `rate-policy.ts`; keep resume event-driven |
| Different conflict granularity | `rebase.ts`, `field-paths.ts`, `freeze-model.ts` — they must agree |
| Different status timing | `DEFAULT_STATUS_TIMING`; hosts override via `AdminMountOptions.statusTiming` |
| Different recovery prompts | `boot-replay.ts` verdicts plus `packages/admin/src/editor/copy.ts` |

## Decisions and claims

### Decisions

| ID | The rule that still binds |
|---|---|
| ADR-0004 | Dirty is decided in the value domain with codepoint-exact `fieldEquals` (list order significant); the merge is performed in the raw domain, so untouched bytes are copied verbatim. Unknown keys come only from the new raw — old unknowns never resurrect — and a no-op is byte equality, never a re-serialisation. One state machine, one transition table, eight phases. A fresh `getRef` runs before every commit. Published is confirmed by content, not by a response code. Boot replay goes through the same invariant engine, and progression is callback-driven. The cross-tab lease is token + heartbeat + TTL + silent steal + full rebaseline; it is UX serialisation only, and the CAS remains the sole correctness mechanism. |
| ADR-0008 | Check-runs are primary on our exact sha; commit statuses are consulted only for the exact contexts in `deploy.contexts`, and only when the check-run set has no decisive result. Any failure conclusion is `failed` and outranks a still-running sibling; any non-completed run is `building`; all-success is `live`; `neutral` and `skipped` never mask a success. No decisive result inside the grace window is `unavailable`, never `failed`, and any read error is `unavailable` and stops the watcher. Reads use `per_page=100` and surface `total_count`; an incomplete page is unavailable. Generated and editable commit messages reject every skip token. Chips key to the entry's `latestCommitSha`, and head advancement supersedes the old watcher. |

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
| INV-P12 | Killing the tab mid-commit leaves a draft that boot replays as discard, offer, or conflict; the draft is deleted only after ref verification | `e2e/specs/kill-tab.spec.ts`, `packages/core/src/pipeline/__tests__/boot-replay.test.ts` |
| INV-P13 | The cross-tab lease is TTL plus heartbeat with a storage-event fallback, and its payload never carries content or credentials | `packages/core/src/pipeline/__tests__/inv-save-lease.test.ts` |
| INV-P15 | An unrelated file's validation failure never gates this save; coverage is reported as up-to-date, advisory, or unknown, never a false all-clear | `packages/admin/src/editor/__tests__/save-sweep.test.ts`, `e2e/specs/advisory-chip.spec.ts` |
| INV-P16 | Conflicts freeze per field at minimal common nodes, save stays blocked until every row is decided, and the resolved save publishes exactly the chosen bytes | `packages/admin/src/editor/__tests__/freeze-model.test.ts`, `packages/admin/src/editor/__tests__/freeze-panel.test.tsx`, `e2e/specs/conflict.spec.ts` |
| INV-P17 | After an auto-merge the next save diffs against the reconciled tree, so it cannot revert a partner's disjoint edits | `packages/core/src/pipeline/__tests__/save-controller.test.ts`, `packages/admin/src/editor/__tests__/form-value.test.ts` |
| INV-D01 | Check-runs are primary, statuses only through `contexts[]`, and only an all-success sha is Live; an absent result inside the 120 s grace is unavailable, never failed | `packages/core/src/status/__tests__/inv-status-truth.test.ts`, `e2e/specs/deploy-status.spec.ts` |
| INV-D02 | Generated and editable commit messages reject the four skip tokens before any network call | `packages/core/src/pipeline/__tests__/inv-skip-token.test.ts` |
| INV-D03 | Head advancement annotates "superseded by {sha}" and stops the watcher; a late run never repaints newer state | `packages/core/src/status/__tests__/inv-supersede.test.ts` |
