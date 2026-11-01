# Security Policy

## Scope (v1, browser-only model)

- All GitHub access is **browser → `api.github.com`** using a **fine-grained personal access token** scoped to one repository: `Contents: read+write` (required), `Checks: read` (required for build-status display), `Administration: read` (owner-only, optional — enables branch-protection preflight).
- The token lives in a browser storage behind an opt-in "Remember on this device" choice (default **on** when provisioned by the owner; see [ADR-0002](specs/backend-and-auth-architecture.md)). It is wiped on sign-out and on failed re-probe after any auth error. It is **never** sent to any server, never placed in URLs, never logged (log masking is automated + test-enforced).
- The admin page loads **zero third-party runtime scripts** and ships a pinned CSP (`connect-src 'self' https://api.github.com`); supply chain is controlled via pnpm `onlyBuiltDependencies` allowlist + frozen lockfile + CI audit gates.

## Explicitly NOT supported (out of threat-model scope, v1)

- Server-side deployments or any backend component.
- OAuth flows, third-party packaged widget code, GitLab/other backends, PR-branch editorial modes — none of these exist in 0.x.
- Confidentiality of the token against arbitrary code executing on the admin origin (documented honestly: storage choice is a convenience trade-off, not a boundary — see [ADR-0002](specs/backend-and-auth-architecture.md)).

## Reporting a vulnerability

Use **GitHub Security Advisories → "Report a vulnerability"** (private reporting). **Never open a public issue for anything token-related.** Include: component (`core`/`admin`), a minimal reproduction (config/entry JSON that triggers it), and affected flows.

Response targets: acknowledge in 3 days; triage decision in 14 days; fix lands via normal changeset release with a credit if you want one.

## Safe-rotation guidance for editors

Fine-grained PATs expire (≤1 year; we recommend ≤90 days). If saving stops working with an auth error: request a fresh token from your site maintainer — your work is safe in local drafts and survives re-auth (the editor never loses form state to auth failures).
