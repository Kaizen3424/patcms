# `patcms/advanced`

`createCMS()` covers the default path: reads, saves, conflicts as values, media, drafts. The
advanced entry is everything the client is built on — drive the save driver yourself, swap the
backend, reuse the git object and serialization helpers. **Everything here is Node-safe**; only
`patcms/web` touches DOM globals.

```ts
import {
  GithubBackend,
  adjudicateDraft,
  canonicalJson,
  createSaveCoordinator,
  createStatusWatcher,
  rebase,
  runSave,
  safePath,
} from "patcms/advanced"
```

`patcms/advanced` is a superset of the main entry minus the client — config DSL, fields, media
helpers, safety, and status are all re-exported here too.

## `runSave` — the save driver

One save attempt against a backend: fresh head → tree → commit → fast-forward-only ref update →
verify. This is the piece `createCMS()` calls; use it directly when you build your own transaction
(e.g. media batches joined with an entry in one tree commit):

```ts
import { runSave } from "patcms/advanced"
import type { CommitChangeSet, GithubBackend } from "patcms/advanced"

declare const backend: GithubBackend
declare const changes: CommitChangeSet

const verdict = await runSave({
  backend,
  branch: "main",
  changes,
  message: "Spring campaign copy", // becomes the commit body; skip tokens are refused
})
// verdict.kind: "saved" | "noop" | "conflict" | "rate-limited" | "failed" | ...
```

Skip-token commit messages (`[skip ci]` and friends) are rejected **before any network call** —
the CMS must never mute its own deploy.

## `createSaveCoordinator` — queue, retries, leases

The coordinator wraps the driver with a queue, draft parking, retryable-failure backoff
(default 1 s then 4 s), cross-tab leases, and subscriptions. This is what a multi-editor admin
needs; the default client deliberately does not include it:

```ts
import { createSaveCoordinator } from "patcms/advanced"
import type { DraftStore, GithubBackend } from "patcms/advanced"

declare const backend: GithubBackend
declare const drafts: DraftStore

const coordinator = createSaveCoordinator({ backend, branch: "main", drafts })

// coordinator.enqueue(request), .subscribe(listener), .snapshot(), .dispose()
// A second enqueue for the same key rejects with SaveInFlightError.
```

Options: `now` (injectable clock), `scheduleWake` (single scheduled-wake seam for rate windows and
backoff), `onAfterWriteFailure` (re-probe hook after 401/403/422-class write failures),
`retryDelaysMs`, `maxSelfRebases`.

## `rebase` — field-level three-way merge

The default client returns conflicts as values and lets the host resolve them. `rebase` is the
optional merging engine: given your form value, the paths you dirtied, and the old and new base
bytes, it splices your dirty paths onto the new base and reports real overlaps:

```ts
import { rebase } from "patcms/advanced"
import type { FieldPath, JsonValue } from "patcms/advanced"

declare const formValue: JsonValue
declare const oldBase: JsonValue
declare const oldRaw: string
declare const newBaseRaw: string
declare const dirtyPaths: ReadonlySet<FieldPath>

const result = rebase({ formValue, dirtyPaths, oldBase, oldRaw, newBaseRaw })
if (result.ok) {
  // result.mergedRaw — bytes to save (verbatim when there was nothing to splice)
  // result.conflicts — paths where both sides edited (host must decide)
  // result.warnings — adopted foreign changes worth announcing
} else {
  // result.issues — STALE_BASE / ROOT_SHAPE / path problems
}
```

`rebase` verifies `oldBase` really is the parse of `oldRaw` (STALE_BASE guard) and never throws —
failures are values. Conflicts it reports are exactly the contested paths; render them like the
per-field recipe in [conflicts-and-drafts.md](./conflicts-and-drafts.md).

## `adjudicateDraft` — boot and lease-steal decisions

A draft that outlives its tab meets a branch that moved on. `adjudicateDraft` classifies the
situation conservatively — unreadable input resolves `offer`, never a discard, never a silent
write:

```ts
import { adjudicateDraft } from "patcms/advanced"
import type { DraftRecord, GithubBackend } from "patcms/advanced"
import type { SaveDraftPayload } from "patcms/advanced"

declare const backend: GithubBackend
declare const record: DraftRecord<SaveDraftPayload>

const verdict = await adjudicateDraft({ backend, branch: "main", record })
// { kind: "discard", reason: "already-live" | "converged", headSha }
// { kind: "offer",   headSha, mergedRaw?, notes, announcements }  — show the draft
// { kind: "conflict", ... }                                        — field-freeze UI
```

The same adjudication serves lease-steal/visibility-change rebaselines — never a blind re-dispatch.

## `GithubBackend` and the backend seam

```ts
import { GithubBackend } from "patcms/advanced"
import type { FetchLike } from "patcms/advanced"

declare const getToken: () => string | undefined

// The DOM fetch type is wider than the SDK's transport seam (its body allows
// more than the SDK sends) — adapt once, exactly as the SDK does internally:
const fetchLike: FetchLike = (input, init) => fetch(input, init as RequestInit)

const backend = new GithubBackend({
  owner: "your-org",
  repo: "your-site",
  token: getToken, // string | (() => string | undefined)
  fetch: fetchLike, // required — inject your own for tests
  // baseUrl: "https://api.github.com", // default; override for proxies/tests
})
```

The backend implements `GitBackend` (ref/tree/blob/commit primitives). Every piece above takes one,
which is what makes the whole stack testable without GitHub (see [testing.md](./testing.md)).

## Status, serialization, safety, media math

Also exported from `patcms/advanced`:

| Export | Job |
|---|---|
| `createStatusReads(backend, branch)` / `createStatusWatcher(options)` | Deploy-status polling; the watcher is pure (inject `now`, `schedulePoll`, `random`) — see [deploy-status.md](./deploy-status.md) |
| `parseJsonDocument` / `serializeDocument` / `canonicalJson` / `detectNewline` / `jsonEqual` / `documentsCanonicallyEqual` | Source-preserving JSON: newline style and trailing newline survive round-trips; `canonicalJson` for stable equality |
| `composeEntryDocument` | Value + untouched → document bytes |
| `safePath` / `safeUrl` / `parseUntrustedJson` / `slugify` / `mustacheLite` / `compareValues` | The safety and text toolkit (see [pitfalls.md](./pitfalls.md) for why they are non-optional) |
| `calculateMediaBudget` / `isUploadSizeBlocked` / `findReferences` / `trashMediaPath` / `restoreMediaPath` | Media math behind the client's guards |
| `SnapshotStore` | The snapshot cache seam |
| `createOneFlightQueue` | One-request-at-a-time queue seam |
| `fieldEquals` / `computeDirtyPaths` / `resolveConflictPaths` | Value-domain diffing (never compare serialized strings) |
| `SAVE_PHASE_ORDER` / `transitionSaveState` / `isRetryableWriteCode` | The save state machine |
| `composeCommitMessage` / `containsSkipToken` | Commit message law |
| `PatProvider` / `MemoryTokenStore` / `CapabilityProbeError` | Auth seams |
| `parseDate` / `createLogger` / `StagedMediaTileRecord` | Misc: date parsing, masked logging, staged media tiles |

## When *not* to use advanced

If `createCMS()` handles your case, stay on it — the high-level surface is where the guarantees
(conflict-as-value, untouched preservation, draft law) are maintained and tested. Reach for
advanced when you need a different transaction shape, a custom queue, or the raw pieces.

## Where to next

- [testing.md](./testing.md) — the backend seam is what makes fake-GitHub testing possible
- `specs/workflows/publish-and-recovery.md` — the save machine and adjudication in depth
