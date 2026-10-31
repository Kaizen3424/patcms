# AGENTS.md — MyCMS

**What this repo is.** A git-backed, zero-database CMS. `packages/core` is a framework-agnostic
TypeScript SDK; `packages/admin` is a React SPA a host mounts with
`mountAdmin(el, {config, support, repository})`; the browser talks directly to `api.github.com` with a
fine-grained PAT. There is no server, database, user account, role, or job. Project canon lives in
`docs/specs/` (master plan, six-area spec, invariant list, phase gates) and `docs/adr/`; this file does
not replace it.

## Read order

1. `specs/MyCMS.md` — the anchor. One read covers stack, commands, folders, routes, data model, auth,
   flows, invariants, env vars.
2. The one deep-dive for the area you are touching (inventory below).
3. Then the code. For project-management work (phase gates, invariant IDs, ADRs), go to `docs/specs/`.

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
- Budget: anchor 200–350 lines, deep-dives 100–250, whole tree under about 2% of hand-written source.
  Over budget means you are copying code.

## Inventory

```
specs/
  MyCMS.md                             anchor: the whole repo in one read
  workflows/publish-and-recovery.md    save machine, drafts, conflicts, boot, deploy status
  backend-and-auth-architecture.md     GitBackend, transaction, CAS, PAT, rate, contract suite
  content-model-architecture.md        config DSL, 12 field types, parse/save, untouched, widgets
  media-architecture.md                bijection, upload guards, references, trash, budget
  test-harness-architecture.md         FakeGithub, fixtures, e2e seams, CI guards
```

## Project process

Phase work follows `docs/specs/phases/`: read the phase's pre-flight, work its checklist top-down, and
tick an item only with command output or a named manual check. A phase gates on its exit checklist
**plus owner confirmation in chat** — agents never self-approve a gate. At session end, append a dated
bullet to that phase's session log and keep the phase status current. If reality contradicts the spec
or an ADR, update the spec/ADR first with a dated note, then the code.

## Canon lives elsewhere

`docs/specs/01-spec.md` · `docs/specs/invariants.md` · `docs/specs/phases/` (P0 through P7) ·
`docs/adr/` (ADR-0001 through ADR-0010). Those belong to the project process; this layer only
describes how the code behaves. Never restate an invariant ID here — link to it.

## Golden rule

Leave the specs at least as accurate as you found them, and no heavier than they need to be.
