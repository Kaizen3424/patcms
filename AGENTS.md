# AGENTS.md — patcms

**What this repo is.** A git-backed, zero-database, headless CMS SDK. `packages/core` is published as
`patcms`: a framework-agnostic TypeScript client whose high-level `createCMS()` is the product. The
browser talks directly to `api.github.com` with a fine-grained PAT. There is no server, database,
user account, role, or job. `playground/src/panel` is the example admin proving `createCMS()` is
sufficient — it is the reference consumer, not a published artifact. The durable description of the
code lives in `specs/`; `plans/` holds the one active delivery plan. This file is the working manual,
not a replacement for either.

## Read order

1. `specs/CMS.md` — the anchor. One read covers stack, commands, folders, routes, data model, auth,
   flows, vetoes, and the identifier index.
2. The one deep-dive for the area you are touching (inventory below). Its closing "Decisions and
   claims" section holds the binding rules and the tests that enforce them.
3. Then the code. For release or cutover work, read `plans/headless-sdk.md`.

Do not read all six specs for a one-file change.

## Code wins

If a spec and the code disagree, **the code is the truth**. Fix the spec in the same change that fixes
the code. Never leave the disagreement for later, and never "fix" code to match a stale spec without
confirming which behaviour is intended.

## Update the specs when you change any of these

| Trigger | Update |
|---|---|
| A route, screen, or navigation entry | anchor §4 |
| A backend or pipeline signature/capability | anchor §3/§7 and `backend-and-auth-architecture.md` |
| The data model: collection kinds, field types, descriptors | anchor §5 and `content-model-architecture.md` |
| The auth flow, token storage, or probe | anchor §6 and `backend-and-auth-architecture.md` |
| An env var, flag, or fixture parameter | anchor §9 and `test-harness-architecture.md` |
| Commands, CI jobs, build outputs, deploy config | anchor §2/§10 and this file |
| A save, conflict, draft, or recovery rule | `workflows/publish-and-recovery.md` |
| Media paths, guards, references, trash, budgets | `media-architecture.md` |
| A decision (`ADR-xxxx`) or testable claim (`INV-xxxx`) | The owning deep-dive's "Decisions and claims" table, then the index in anchor §8 |
| A new gotcha — anything that cost real time | The relevant spec, as a one-line rule |

A gotcha discovered and not written down is a gotcha the next agent pays for again.

## When to create a new spec file

Only when all three hold:

1. The contract cannot be inferred by a careful reader in under a minute.
2. It spans multiple files or a trust/security boundary.
3. It will not be stale in a month.

Name it `pages/<route>.md`, `<subsystem>-architecture.md`, or `workflows/<flow>.md`, and start it with
a `> Parent:` line linking to the anchor. Then add it to the anchor's deep-dive index — an orphan spec
is a bug. If it cannot earn 100 lines, it belongs as a section in an existing file.

## Writing rules

- Orientation, not replication. If the code answers it in seconds, do not write it.
- Write the gotcha, not the history. Git has the history.
- No line numbers, no `file.ts:123`. Cite `path/to/file.ts` plus the symbol name.
- Never link a gitignored or local-only path: `.env*`, `dist/`, `dist-types/`, `*.tsbuildinfo`,
  `coverage/`, `test-results/`, `playwright-report/`, `blob-report/`, `.vite/`, `node_modules/`,
  `.pnpm-store/`, `ABANDONED_FILES/`, sibling checkouts.
- Tables for enumerations, prose for reasoning.
- Every spec reachable from the anchor.
- If a claim is duplicated elsewhere, say **"change all N together"** and name the places.
- If a fact will be stale in a month, leave it out.
- Budget: anchor 200–350 lines, deep-dives 100–250, whole tree under about 2.5% of hand-written source.
  Over budget means you are copying code.

## Inventory

```
specs/
  CMS.md                               anchor: the whole repo in one read
  workflows/publish-and-recovery.md    save machine, drafts, conflicts, boot, deploy status
  backend-and-auth-architecture.md     GitBackend, transaction, CAS, PAT, rate, contract suite
  content-model-architecture.md        config DSL, 12 field types, parse/save, untouched, widgets
  media-architecture.md                bijection, upload guards, references, trash, budget
  test-harness-architecture.md         FakeGithub, fixtures, test doubles, CI guards
plans/
  headless-sdk.md                      patcms surface, publish blockers, admin cutover
```

## Project process

Work follows the active plan in `plans/`: read it top-down and tick an item only with command output or
a named manual check. A phase gates on its exit checklist **plus owner confirmation in chat** — agents
never self-approve a gate. At session end, append a dated bullet to the plan's session log and keep its
status current. When a phase closes, replace the plan rather than accumulating them; git has the
history. If reality contradicts a spec or a decision row, update the spec first, then the code.

## Where the rest lives

Decision rationale and testable claims are not a separate register: each deep-dive ends with a
"Decisions and claims" section, and `specs/CMS.md §8` indexes which file owns which id. Release policy
(ADR-0010) and the yve cutover checklist (INV-C01–C04) live in the active plan. Never restate an id's
rule in two places — link to the owning section.

## Golden rule

Leave the specs at least as accurate as you found them, and no heavier than they need to be.
