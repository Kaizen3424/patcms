# Publish and recovery

> Parent: [`specs/MyCMS.md`](../MyCMS.md)

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
