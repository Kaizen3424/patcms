# Contributing (trunk-based law — recorded at P0, expanded for OSS at P7)

## Branching

- **Trunk-based**: `main` is the one long-lived branch. All work lands as short-lived feature branches off `main`, merged fast (or a single direct conventional commit for small changes).
- Never work on long-lived topic branches; rebase or merge `main` back into your branch at least at completion time.
- `main` is always green: the CI gate (install → typecheck → lint → test → build → e2e) must pass before a push.

## Commit conventions

- **Conventional Commits**: `feat|fix|chore|docs|refactor|test|build|ci(scope): summary` — imperative, lowercase summary, no final period.
- Content commits authored by the CMS itself carry the machine-checkable **`chore(cms):`** prefix.
- No force-pushes, ever (standing veto — `force:true` ref updates are rejected by design; the same rule applies to people).
- No human-time estimates anywhere (commit messages, docs, issues).

## Hygiene

- Run the focused tests before committing (`pnpm --filter <pkg> test -- <file>`).
- Specs move BEFORE mechanisms land (see `AGENTS.md` → "Update the specs").
- Tokens and sandbox-repo credentials never enter the repo.

## Toolchain

- Node 22 pinned for CI/tooling (`.nvmrc` = `22`); local runtimes may use any Node satisfying `engines` (≥22.12) — owner decision recorded in [ADR-0010](plans/phase-7-publish.md).
- pnpm pinned via the root `packageManager` field (corepack).
