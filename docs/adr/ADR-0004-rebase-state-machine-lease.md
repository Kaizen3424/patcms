# ADR-0004 — rebase() semantics + save state machine + save lease

**Status:** Accepted · 2026-10-27

## Context
Concurrency policy is "guided re-conflict" (no 3-way merge in v1), yet round-2 found the naive version: (a) whole-entry Take/Show buttons vaporize founder work; (b) queued second entry false-conflicts against its own first commit's head; (c) boolean soup (`dirty/saving/error`) multiplies unsoundly; (d) a dead committing tab can deadlock cross-tab locks.

## Decision — rebase() formal contract (property-tested, 11 cases)
```
rebase({formValue, dirtyPaths: Set<fieldPath>, oldBase, newBaseRaw, oldRaw})
  → { mergedRaw, conflicts: fieldPath[] }
```
- **Dirty decided in the VALUE domain** (per-field `fieldEquals`: exact codepoints, list order significant, recursion: objects recuse, lists per item).
- **Merge performed in the RAW domain**: dirty paths serialize from the form; everything else copied verbatim from `newBaseRaw` (unknowns come only from the new raw — old unknowns never resurrect; deletion warns).
- No-op iff `mergedRaw === newBaseRaw` byte-equal.
- Property tests P1–P11: disjoint-preserve · overlap-conflict (never silent win) · idempotence · no-change identity (no re-serialization) · unknown-preserve · unknown-loss-warn · key-order preservation · list-permutation-dirty · defaults-never-inject · no-op skip · codepoint-exact equality.

## Decision — save state machine (one transition table, no scattered booleans)
`editing(baseSha) → dirty → queued → committing → published | conflict | failed(retryable→backoff cap→paused(manual)) | paused(reason{network,auth,quota})`
Rules (adopted from round-2): fresh `getRef()` immediately before EVERY commit (queued saves don't false-conflict after own commit) · confirmation by content (200 ⇒ published; lost-response ⇒ tree-sha re-verify; orphan blobs harmless-documented) · drafts deleted only post-ref-verify · resume is never a blind re-dispatch (one batch rebaseline: `getRef`+`listChangedFiles` → queued|conflict) · boot replay through the invariant engine (equal→discard / canon-diff→offer resume / drift→conflict) · progression callback-driven, visibilitychange wakes verify-then-rebuild.

## Decision — cross-tab lease
BroadcastChannel alone is not a lease: implement **token + heartbeat + TTL with silent steal + full rebaseline**; `storage`-event fallback (Safari <15.4); payloads never carry sensitive content; the lease is UX serialization only — the FF/CAS invariant remains the sole correctness mechanism.

## Consequences
GUI conflicts become FIELD-granular: non-overlapping fields auto-merge with announcements; overlapping fields → per-field choices; any discarded version archived 30 days (founder-cry prevention).
### P0 verification (2026-10-27)
- The exhaustive eight-phase save vocabulary is code (`SAVE_PHASE_ORDER`, echo-tested) as the anchor for the single transition table; the machine + invariant engine + `rebase()` land P2.4/P2.5. No deviation.

## Appendix — C.2 conflict decision matrix + `rebase()` semantics (2026-10-27)

Recorded before the mechanism lands (ADR-first law; supersedes nothing above — it pins the details the signed contract left open).

### `fieldPath` representation

`fieldPath` is an ordered segment list `readonly (string | number)[]` — object keys are strings, list indices are numbers (1-based none, 0-based like JSON). No delimiter encoding: a key containing `.`/`[` cannot collide with a path token. The dotted display form (`"contact.email[2]"`) is a **UI/message-map concern** and never an API input. The P1 issue-path strings stay display-only.

### `fieldEquals` (value domain)

Structural equality: strings compared codepoint-exact (`a === b`, `\u00e9` ≠ `e\u0301`), numbers/booleans/null `===`, records compared by key set + values (**key order irrelevant** to equality), arrays compared length + per-index **order-significant**. Lists are compared per index ("lists per item"): a permutation changes matched pairs ⇒ not equal.

### Dirty granularity (both sides — ours and foreign)

`diffPaths(next, base)` walks the value pair and emits:
- records: descend (objects recuse); key added/removed/changed ⇒ emit that key path (deletions emit the key too).
- lists: `length differ` ⇒ emit the **whole list path** (single unit); lengths equal ⇒ descend per index (`path[i]`).
- leaves: `!fieldEquals` ⇒ emit.

Consequences both sides rely on: foreign length change always collapses to the whole-list unit, whose path is an ancestor of any our-scope item path ⇒ an index-shift can never splice silently (ancestor rule below). Reordering a list marks it dirty cleanly at the list path — or, when lengths are equal and reordering moves items across indices, as the set of changed item paths; both are cleanly covered (`list-permutation-dirty` property).

### `rebase()` formal semantics

```
rebase({formValue, dirtyPaths, oldBase, oldRaw, newBaseRaw})
  → { ok: true,  mergedRaw, conflicts: fieldPath[], warnings: fieldPath[] }
  | { ok: false, issues: RebaseIssue[] }
```

| Input | Meaning |
|---|---|
| `formValue` | The user's current edited value tree (JSON-safe). |
| `dirtyPaths` | Field paths the user changed since load (editor-tracked; the granularity rules above, computed against `oldBase`). Nested paths are subsumed by their dirty ancestor. |
| `oldBase` | The **full parsed value of `oldRaw`** (all keys, including unmodeled ones). `rebase` verifies this pair (`jsonEqual(oldBase, parse(oldRaw))`) and fails `STALE_BASE` otherwise — trust-but-verify, cheap, keeps the engine honest about caller caches. |
| `oldRaw` | Raw bytes the form was loaded from (the pre-foreign version). |
| `newBaseRaw` | Freshly read remote bytes — the version the merge must land on. |

Result shape is Result-carried (spec §7 never-throw law forces the `ok`/`issues` extension of the originally sketched `{mergedRaw, conflicts}` tuple):
- **Merging is in the RAW domain.** Adjudicated dirty paths that apply are spliced from `formValue` into a structural copy of `parse(newBaseRaw)` (key insertion order preserved); the result is canonical-printed. If no splice actually mutates the tree, `mergedRaw === newBaseRaw` **byte-identical** (no re-serialization — `no-op skip`/`no-change identity`). A dirty path whose form value already `fieldEquals` the new-base value (convergent edit) splices nothing — silent agreement, no conflict, no warning.
- **Dirty `Splice` decisions**: at dirty path P, `resolve(formValue, P)` found ⇒ replace/create that subtree (creating intermediate containers when genuinely new); not found ⇒ DELETE the key from the merged tree.
- **Conflicts (`never silent win`)**: a dirty path P conflicts when the foreign set F (`diffPaths(parse(newBaseRaw), oldBase)`… i.e. foreign = `diffPaths(newBase, oldRaw-value)`) contains P, an ancestor of P, or a descendant of P. Conflicts are reported at the **minimal common node** (shorter path). Conflict fields are NOT spliced — remote bytes stay until the user chooses (freeze; C.3/C.5 surface).
- **Foreign set F uses the same granularity rules** and covers ALL keys (modeled or not) — unknowns participate.
- **Unknowns come only from the new raw** — `old unknowns never resurrect`: merged unknown keys only exist because `newBaseRaw` carries them.
- **Deletion warns**: unknown (and any adopted foreign) changes surface in `warnings` — every foreign-touched path that is neither a conflict nor silently convergent, including foreign deletion of an unknown key (`unknown-loss-warn`) and adopted formatting. Losing-old non-conflicting changes are announced ("non-overlapping fields auto-merge with announcements").
- **Defaults never inject**: `rebase` is schema-blind; no default folding, no key creation beyond user-introduced dirty paths.

### File-level conflict engine (decision matrix)

`resolveConflictPaths` adjudicates each entry of the base→head `changed` diff against our write set. Challenge reads go through a `readFreshBlob` seam the engine calls and NEVER consult any cache (INV-P08; poisoned-cache tests assert block-on-real-drift). `headEntries` (head tree) is an input so foreign **deletions** — absent from a head-side diff — still detect resurrection.

| # | Signal | Verdict | Enforcement |
|---|---|---|---|
| 1 | P not among our writes/deletes | `other-file` | Auto-reapplied: foreign change is just part of the new base (P05 "drifted other-files auto-reapply"). |
| 2 | `{sha,mode,type}`: sha equal, type equal, mode differs | `mode-restore` | Our write proceeds with our mode; commit-body note records the restore (INV-P06). |
| 3 | sha equal, type differs | `blocked: type-change` | Never silently applies (INV-P06). |
| 4 | sha differs, `canon(ourBaseBytes) == canon(remoteBytes)` | `adopt-remote` | Formatting-only foreign change: remote bytes become the substrate silently, with a note (INV-P07 one-way relaxation). |
| 5 | sha differs, canon-different, P ∈ our writes | `field-merge` | `rebase()` adjudicates fields (INV-P05 "drifted same-file blocks w/ field-granularity freeze"). |
| 6 | P ∈ our writes, P absent from head tree | `blocked: resurrect` | Foreign deleted a file we edited — never a silent overwrite. |
| 7 | P ∈ our deletes, foreign edited it | `blocked: delete-vs-edit` | User confirms re-deletion (C.5 UI). |
| 8 | P ∈ our deletes, foreign deleted it too | reconciled | No action (both sides agree). |
| 9 | Challenge read failed / unavailable / non-blob | `blocked: unreadable` | Conservative; never false-adopt on missing evidence. |

`sameFilePredicateSatisfied` ⇔ every path in our write set resolves to `clean-reapply` | `adopt-remote` | `mode-restore` (P05: "applies iff ∀ changed remoteTuple(baseBlob) == baseTuple OR canon-equal"; `other-file` paths never enter the predicate). Canon predicate default = parse-value equality from P1's serializer (`jsonEqual` over `parseUntrustedJson`); injectable for tests. `notes[]` carry machine-checkable commit-body warnings (mode restores, formatting adoptions).

## Appendix — C.3 operational pins (2026-10-27)

Recorded before the P2.5 mechanisms land (ADR-first law; pins the operational details the signed contract left open — no law above changes).

### Persisted draft record (boot-replay payload)

`DraftRecord.value` for entry saves carries exactly:

```
{ filePath, baseSha, baseRaw, formValue, savedAt }
```

- `baseRaw` = the UTF-8-decoded raw bytes the form was loaded from (`oldRaw` of `rebase()`); `formValue` = the JSON-safe edited value tree; `baseSha` = the commit sha the form was loaded against.
- `oldBase` and `dirtyPaths` are NEVER persisted — they are derived at boot (`oldBase = parse(baseRaw)`, `dirtyPaths = diffPaths(formValue, oldBase)`), so a persisted record can never disagree with the granularity law.
- Media tiles key alongside (`${key}/media/${n}`, P4); settings docs key by file path. Draft lifecycle is orthogonal to token lifecycle (ADR-0002) — a 401 wipe NEVER touches drafts (INV-A01).

### Draft write/delete ordering (INV-P11)

- The draft record is written (awaited) BEFORE the save's first network call — the fresh `getRef` included. A save that dies anywhere below the write leaves a usable draft.
- Deletion happens ONLY after the ref is observed to contain the commit (published-by-content, INV-P10). On `conflict`/`failed`/`paused` the draft is retained verbatim.

### One-flight queue (INV-P04)

- Keyed per repo+branch (ONE queue per controller): all overlapping saves — autosave, manual, later media — drain sequentially. Each drained save starts with a FRESH `getRef` (ADR-0004 rule), so the second save re-bases on the first's commit sha and never false-conflicts against its own predecessor; each job funnels through exactly ONE `updateRef`.
- Rationale: ref updates on a branch are inherently serialized server-side; queueing matches transport truth and avoids spending quota on CAS retries against our own predecessor.

### Lease operational numbers (INV-P13)

- TTL 15 000 ms · heartbeat every 5 000 ms · a holder silent past one TTL is stealable. Steal is SILENT (victim learns only on its next beat failing) and the stealer MUST run the full batch rebaseline (`getRef` + `listChangedFiles` → `queued|conflict`) — never a blind re-dispatch of the victim's `committing` state (paused-reasons table).
- Lease message payload: `{purpose, key, holderId, expiresAt}` — never content, never token, never field values. The lease is UX serialization only; FF/CAS stays the sole correctness mechanism.
- Transport: `BroadcastChannel` primary; `storage`-event fallback for engines without BC (Safari <15.4) behind an injected carrier interface so both are testable without a browser.

### Paused reasons + resume mapping

- `paused(reason: quota)` ← RATE_LIMIT verdict carrying `describeRatePause` waitMs: with guidance → countdown + single scheduled wake (`createRateResume`, event-driven, INV-N01); WITHOUT guidance (malformed headers) → `paused(manual)` with an explicit "try again" affordance — the machine never tight-loops on a null window.
- `paused(reason: auth)` ← AUTH_EXPIRED after the after-write hook: drafts retained, token wiped (ADR-0002), inline re-auth sheet, probe re-run BEFORE resume (INV-A01/A03).
- `paused(reason: network)` ← NETWORK/UNKNOWN after the retryable backoff cap (aligned with the driver's rebuild budget: 2) → `paused(manual)`.
- `visibilitychange` wake → verify-then-rebuild BEFORE trusting any queued state (never timer-cadence progression).

### Boot replay classes (INV-P12)

Boot runs the invariant engine over each surviving draft against a FRESH head read; verdict classes:

1. `discard` — head bytes already carry our intended content (blob-sha equal) or canon-equal to the merged would-be content: the save landed or converged; delete the draft.
2. `offer` — engine verdicts all proceed (`clean-reapply`/`adopt-remote`/`mode-restore`) but content differs: surface "resume your unsaved changes" (founder confirms; nothing auto-writes at boot).
3. `conflict` — `field-merge`/`blocked`: straight into the field-granularity freeze UI.

Boot NEVER auto-writes to the remote; replay only adjudicates and deletes drafts in the `discard` class.

## Appendix — P2.6 editor integration pins (2026-10-27)

Recorded before the P2.6 mechanisms land (ADR-first law). These pin the coordinator's editor-facing
lifecycle and the save-cycle laws the UI must obey. No law above changes; one deliberate widening of
`RESET` is marked as such.

### Coordinator lifecycle surface

- `markDirty(draftKey, baseSha)` dispatches `MARK_DIRTY` (legal from `editing|dirty`; elsewhere a no-op).
- `reset(draftKey, baseSha)` dispatches `RESET`. **Widened in P2.6:** legal from every phase EXCEPT
  `committing` (`published|conflict|failed|paused|queued|editing|dirty` → `editing`). Rationale: the
  editor needs a hard reset on mount/remount and after abandoning a parked job; excluding `committing`
  keeps the masking risk out — while a write is genuinely in flight the machine must not be told a new
  base. The editor calls it (a) on first mount with the snapshot head, (b) after a published/noop
  verdict with the new coordinate, (c) when the founder starts over from the latest version.
- `cancel(draftKey)` abandons a save that is NOT `committing`: it sets a cancel flag and wakes the job's
  gate so the next loop iteration resolves `{kind:"cancelled"}` and dispatches `RESET`. The draft is
  RETAINED (it is the crash-safety record). Cancelling a `committing` job is a no-op — a transport
  write cannot be un-sent, and pretending otherwise would desync the UI from the ref.
- `save(request)` REJECTS a second request for a `draftKey` that still has a live job
  (`SaveInFlightError`). Rationale (found while planning P2.6): `jobs` is keyed by draftKey, so a second
  `save()` would overwrite the registration and strand the first promise behind the one-flight queue —
  a permanent deadlock that also swallows the first save's verdict. The editor additionally disables
  submit while a save is live; the rejection is the machine-checkable backstop.
- `SaveVerdict` gains `{kind:"cancelled"}` so an abandoned job settles honestly instead of hanging.

### Save-cycle law (post-publish base)

- On `published`, the new base is `verdict.commitSha` — the commit the ref was OBSERVED carrying
  (INV-P10) — never a re-read. The editor sets `baseSha := commitSha`, `baseRaw := <the bytes it
  composed>`, `baseValue := parse(baseRaw)`, then `reset(draftKey, commitSha)`.
- On `noop` the base is unchanged; `reset(draftKey, baseSha)` keeps the same coordinate.
- **Dirtiness is a VALUE-domain fact** (`computeDirtyPaths(formValue, baseValue) ≠ ∅`); lifecycle is the
  machine. The save bar consumes both. A founder who undoes back to the base sees "all changes saved"
  while the machine is still `dirty` — the machine never un-dirties and no event is invented for it.
- Edits made while `queued|committing` stay in the form tree; after `published` + `reset` the local diff
  against the new base decides whether the bar shows unsaved changes again. No keystroke is discarded
  by a save completing.

### Untouched composition + virtual keys (INV-S01/S03)

- The editor's ONLY serialization path is
  `composeEntryDocument({fields, value, untouched, document})`: `mergeUntouched(value, untouched)` →
  strip every declared `slug` field (virtual, derived from the filename, never persisted) →
  `serializeDocument(document, merged)`. Passing a modeled-only tree would make untouched keys look
  deleted to `rebase()` (silent data loss), so the full tree is mandatory.
- `formValue` persisted in the draft and passed to `rebase()` is that same full tree (untouched
  included, virtual keys stripped).

### Editor surfaces at P2.6

- `authPaused` refuses pre-network with `failed(AUTH_EXPIRED)` and no dispatch. The P2.6 editor maps it
  (and `paused(auth)`) to an "access key needs checking" state and routes the founder through
  sign-out → sign-in → boot offer. The in-place re-auth sheet + `resumeAuth()` wiring stays P2.10;
  INV-A01 remains partial until then.
- Boot replay covers the ENTRY-level adjudication only: `discard` deletes the draft, `offer` shows a
  confirm banner, `conflict` shows an honest message with "start over from the latest version". The
  field-granularity freeze UI stays P2.9.
- Lease scope for v0 = the entry draftKey; acquire on mount, heartbeat, release on unmount. `onLost`
  shows a notice and the next save adjudicates through the coordinator (never a blind re-dispatch).
  Full steal-rebaseline UX = P2.9.
- The draft key law (`${repo}/${collection}/${slug}`) does not carry `branch`, so two branches of one
  repo share a draft and lease slot. Accepted for the single-branch Stage A; revisited if multi-branch
  editing lands.

### Shared IndexedDB schema (2026-10-27, found by the P2.6 save e2e)

`auth` (ADR-0002) and `drafts` (this ADR) live in ONE database (`mycms`). idb-keyval's
`createStore(dbName, storeName)` can only create its object store while the database is being CREATED:
the second adapter to open an existing version-1 database receives `NotFoundError` on its first
transaction, which blocked the first real save in a browser. The storage decision is unchanged (drafts
stay in IndexedDB, key law unchanged); the web adapters now open the database ONCE through
`web/idb-store.ts`, declaring every object store up front and bumping the version when an existing
database is missing one. Adding a store means adding its name to `MYCMS_IDB_STORES` in the same change.

## Appendix — P2.7 lease-notice + sweep advisory pins (2026-10-27)

Recorded before the P2.7 mechanisms land (ADR-first law). No law above changes.

### Lease-notice completion (the INV-P13 surface)

- `leaseLost` stays a WARNING, never a correctness gate: while a tab knows it does not hold the
  lease, its Save button stays disabled — that is deliberate UX serialization (the lease is
  UX-only; INV-P01 FF/CAS remains the sole correctness mechanism). A save attempted while lost
  would most often land as a conflict screen (the field-granularity freeze UI is P2.9), so the
  notice is the honest serialization slot.
- Two clearing paths, both event-driven (NEVER timer-cadence acquire):
  1. **Manual "Check again"**: the founder re-runs `acquire(draftKey)`. `acquire` already refuses
     only while a LIVE foreign claim exists (unexpired), so a re-check can never silently steal
     from a live, heart-beating editor; only a holder silent past one TTL (15s) — dead or
     throttled — is stealable. Clearing happens on a `true` answer; the bar returns to
     dirty/clean.
  2. **Auto re-acquire on an OBSERVED foreign `release`**: `SaveLease` gains
     `onFreed(key, handler): () => void` — fired exactly when a foreign `release` leaves the key
     with no live foreign claim AND we do not hold. The consumer re-acquires on the signal;
     clearing only when the re-acquire returns `true` (someone may have claimed in between; then
     the notice stays honest).
- `onFreed` does NOT fire for silent TTL expiry (nothing travels the wire when a tab dies) — the
  manual check covers that path. Both paths are pinned by the L2 lease journey.
- **No timer-based auto re-acquire**: browsers heavily throttle background tabs, so a timed
  re-check could steal from a live editor that merely went quiet. Manual check + observed release
  only.
- Draft writes continue verbatim while leaseLost (status quo): drafts are the crash-safety record
  keyed `${repo}/${collection}/${slug}` and two tabs share one device store, so concurrent
  editing while lost is a documented last-writer-wins limitation — revisited with the P2.9
  rebaseline UX, not patched by inventing keyed slot variants now.
- `AdminMountOptions` gains `leaseTtlMs?: number` (compositional host surface, zero new deps); the
  playground reads a `?leaseTtlMs=` URL parameter into it so the e2e can exercise the TTL-steal
  deterministically. The shipped default stays 15 000 ms.

#### Refinement — first-come holds are never stolen by id (2026-10-27, P2.7 L2 journey)

The first L2 lease journey run exposed code deviating from this appendix: `acquire` refused a
live foreign claim only when the claimant's id was SMALLER (`foreign.holderId < selfId`), so a
claimant with a smaller id could silently steal a LIVE, heart-beating hold — a coin flip under
random session ids; and a claim ARRIVAL displaced a live hold whenever its id was smaller, which
the appendix's "can never silently steal" sentence never licensed for entries opened second.

Refinement, recorded before the mechanism (schéma, not a contract change — the wire payload
stays the 5-tuple):

- `SaveLease` tracks a first-observation stamp per foreign claim (`foreignSeenAt`); RENEWALS by
  the same holder keep the stamp, so a heart-beating hold stays "pre-existing" to later
  claimants no matter when its last beat landed. Our own hold keeps its establishing stamp
  (`ourHoldStamp`); renewals keep it too.
- `acquire` refuses a live foreign claim whose stamp predates our post by more than the settle
  window — REGARDLESS of id. The grace window absorbs message-order inversions in a
  millisecond double-click race; claims first seen within that window are CONTEMPORANEOUS and
  keep the pinned id tie-break (smaller id wins the fresh race, deterministic).
- A claim arrival NEVER displaces our hold. The old smaller-id "silent steal on arrival" is
  superseded: the victim learns only from its own beat failing (TTL expiry), or from the
  discovery guard — a live foreign claim whose stamp predates our own hold's stamp (possible
  only after clock skew or delayed delivery) makes the NEXT beat fail and fire `onLost`.
- Only a holder silent past one TTL is stealable, as pinned above — enforceable solely through
  claim expiry (`liveForeign` already filters it).

### Cross-entry sweep + advisory chips (master-plan §5.2(b); admin-owned per the phase deliverables)

- Trigger: once after a `published` verdict, at the sha the ref was OBSERVED carrying
  (`verdict.commitSha`, INV-P10 content truth). `noop` saves sweep nothing.
- The sweep is ADMIN-side (`sweepSite`): fresh `readTree(branch, commitSha, {})` with no etag — a
  full fetch; per-file reads ride `readFile(branch, path, blobSha)`, where a 304 is
  content-addressed truth (the blob sha IS the bytes identity), not a stale-cache hazard.
  **Scope note:** INV-P08 (fresh-binding) covers CONFLICT challenge reads through the engine's
  `readFreshBlob` seam only; it never applies to this advisory sweep. Pinned so the two laws
  cannot bleed into each other.
- The sweep NEVER touches the shared React Query snapshot/index caches (an invalidation
  mid-editor would churn mounts and boot adjudication) — it performs standalone reads.
- Classification (`classifySweep`, pure): other entries carrying error-level issues →
  `advisory(problems)` — one problem per ENTRY with its first error issue (bespoke per-code prose
  stays with the message map, P3.8/P5.6); no errors anywhere → `upToDate` (no chip); any
  read/parse/transport failure → `unknown` (conservative: coverage-honest copy, never a false
  "all clear").
- **Copy veto note:** master-plan §5.2's literal chip phrase ("Your change is **committed**") uses
  a word banned on founder surfaces (§7 vocabulary ban); the deck says "saved" instead —
  *"Your change is saved, but the site's update is paused by an older problem."* This supersedes
  the master-plan wording until the copy law audit (P5.6) formalizes it.
- CTAs: "Take me there" (route link to the problem entry's editor) and "Copy message for {name}"
  (minimal clipboard composer NOW; the structured composer is P2.10 and will supersede it).
  Chips render one per problem entry, individually dismissible.
- THE STANDING VETO, restated for this surface: an advisory chip never gates her save. Chip state
  lives outside the save-bar model entirely; nothing in the save path reads it.
