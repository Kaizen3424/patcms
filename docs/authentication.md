# Authentication

patcms uses exactly one credential: a **GitHub fine-grained personal access token** scoped to the
repository it manages. There are no user accounts, roles, or sessions server-side — GitHub
repository permissions are the authorization model.

## Creating the token

| Permission | Access | Why |
|---|---|---|
| Contents | read and write | read entries and media, publish commits |
| Checks | read | deploy status from check-runs |
| Administration | read | optional; branch-protection preflight |

Keep it single-repository and fine-grained, and treat it as rotatable — the client holds a
write-capable token in an origin that also renders untrusted repository content.

## The capability probe

`auth.signIn(token)` does not just store the token — it probes what the token can actually do and
refuses to sign in with one that cannot write:

```ts
import { isCMSError } from "patcms"
import type { CMS } from "patcms"

declare const cms: CMS // constructed as in getting-started.md
declare const token: string // from your sign-in form

try {
  const session = await cms.auth.signIn(token, { remember: true })
  console.log(session.capabilities.repo)          // "ok" | "missing" | "forbidden" | "error"
  console.log(session.capabilities.protectionAdmin) // branch-protection preflight (optional scope)
  console.log(session.capabilities.checksRead)    // advisory: fine-grained PATs often cannot read check-runs
  console.log(session.rateLimit)                  // { limit, remaining, resetAt } | null
} catch (error) {
  if (isCMSError(error)) {
    // FORBIDDEN: the token cannot write to this repository.
    // Render your own message — never surface raw GitHub prose.
  }
}
```

Construction is offline: `createCMS({ token })` seeds a token without probing, and no network call
happens until an entry/media operation or `auth.verify()`. That is the script-friendly path:

```ts
import { createCMS } from "patcms"
import type { ConfigDefinition } from "patcms"

declare const config: ConfigDefinition
declare const process: { env: Record<string, string | undefined> }

const cms = createCMS({
  config,
  repository: { owner: "your-org", repo: "your-site", branch: "main" },
  token: process.env.GITHUB_TOKEN, // seeded, not probed
})

// Probe now (throws CMSError when the token cannot write):
await cms.auth.verify()
```

## The sign-in lifecycle

| Member | Behaviour |
|---|---|
| `auth.status` | `"signedOut" \| "checking" \| "signedIn"` |
| `auth.session` | `{ repository, capabilities, rateLimit } \| undefined` — absent for a seeded token until `verify()` |
| `auth.signIn(token, { remember? })` | Probes, then signs in. `remember: true` persists through the `tokenStore` |
| `auth.restore()` | Restores a persisted token and re-probes; resolves `undefined` when none stored |
| `auth.verify()` | Re-probes the current token; throws on failure |
| `auth.signOut()` | Clears the session **and** the persisted token |
| `auth.onChange(listener)` | Status transitions; returns an unsubscribe function (also emits `auth:change`) |

The boot pattern from the example panel: construct → `await cms.auth.restore()` → render
signed-out or signed-in based on `auth.status`, updated via `auth.onChange`.

## Token storage

The `tokenStore` seam decides where `remember: true` persists — `read()`, `write(token)`, and
`clear()`, all async:

```ts
import { createCMS } from "patcms"
import type { ConfigDefinition, TokenStore } from "patcms"

declare const config: ConfigDefinition
declare const myStore: TokenStore // your implementation of the seam

const cms = createCMS({
  config,
  repository: { owner: "your-org", repo: "your-site", branch: "main" },
  tokenStore: myStore,
})
```

Default: memory-only (gone on reload). In the browser use `createIdbTokenStore()` from
`patcms/web`; `createSessionTokenStore()` keeps the token for the tab session only. A failed
re-check (revoked token, expired probe) **wipes** the stored token and drops to `signedOut` — the
host shows the sign-in form again.

## Expiry mid-work

A 401 during a write marks the session expired, keeps drafts, and calls the `onAuthExpired`
callback you passed to `createCMS()`:

```ts
import { createCMS } from "patcms"
import type { ConfigDefinition } from "patcms"

declare const config: ConfigDefinition

const cms = createCMS({
  config,
  repository: { owner: "your-org", repo: "your-site", branch: "main" },
  onAuthExpired() {
    // Show the re-auth UI. Drafts are intact; after sign-in the host resumes.
  },
})
```

## Rate budget

`session.rateLimit` carries `{ limit, remaining, resetAt }` from the probe. GitHub's core REST
budget for a fine-grained PAT is modest — render `remaining` in your UI (the example panel shows it
in the sidebar) and avoid polling loops. When GitHub says the quota is exhausted, the probe reports
`quotaBlockedUntil` and no requests may run in that window.

## Token hygiene

- Never put the token in a URL, a query string, or a log line. The SDK's masked logger scrubs
  `github_pat_…`/`ghp_…` shapes and `authorization` headers, but your own logging is yours to keep
  clean.
- Never commit one. Pass it through a sign-in form (browser) or an environment variable (scripts).
- Any code running on the same origin can read a persisted token — that is the threat model. Scope
  it to one repository and rotate it.

## Where to next

- [web-stores.md](./web-stores.md) — the IndexedDB token stores
- `specs/backend-and-auth-architecture.md` — the probe contract and rate policy in depth
