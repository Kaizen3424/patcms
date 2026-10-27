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
