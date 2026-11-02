# Errors

patcms has two error vocabularies: `CMSError` for anything that fails an operation, and
`ParseIssue` for data that loaded but is not quite right. Knowing which is which is most of error
handling in a host.

## What throws vs what returns

| Situation | You get |
|---|---|
| Save/create hit a real conflict | **Value** `{ status: "conflict", current, local }` — never an exception |
| Save/create failed validation | **Throw** `CMSError` code `VALIDATION` with `issues` attached |
| `entries.validate` found issues | **Value** `{ ok: false, issues }` |
| Zero-diff save | **Value** `{ status: "noop" }` |
| Delete blocked by references | **Value** `{ status: "referenced", references }` |
| Missing entry | **Throw** `CMSError` code `NOT_FOUND` |
| Signed out | **Throw** `CMSError` code `AUTH_REQUIRED` |
| Token lost write access mid-session | **Throw** `CMSError` code `AUTH_EXPIRED` (session wiped, drafts kept) |

## `CMSError`

```ts
import { isCMSError } from "patcms"
import type { CMS } from "patcms"

declare const cms: CMS // constructed as in getting-started.md

try {
  await cms.entries.get("posts", "missing")
} catch (error) {
  if (isCMSError(error)) {
    console.log(error.code)   // see table below
    console.log(error.status) // HTTP status when one caused it
    console.log(error.issues) // ParseIssue[] when validation failed
    console.log(error.retryAt) // ISO timestamp for RATE_LIMIT
    // error.cause holds the original backend error — for logs, never for UI text
  }
}
```

| Code | Meaning | Typical source |
|---|---|---|
| `AUTH_REQUIRED` | No token / signed out | any call before `signIn` |
| `AUTH_EXPIRED` | Token lost write access mid-session (401) | writes; session is wiped, drafts kept |
| `FORBIDDEN` | Token lacks the scope (403), incl. probe refusal | sign-in, writes |
| `NOT_FOUND` | Entry or media path does not exist | `entries.get`, `media.get` |
| `CONFLICT` | CAS collision or occupied path | save/create (as value instead), media upload/delete/restore |
| `RATE_LIMIT` | GitHub quota exhausted | anything; `retryAt` says when |
| `NETWORK` | Transport failure | anything |
| `VALIDATION` | Refused before any network call | save/create (`issues`), media guards |
| `UNSUPPORTED` | Operation disabled by config or v1 scope | `create`/`delete` on restricted collections |
| `INVALID_CONFIG` | Bad options at construction | `createCMS` |
| `UNKNOWN` | Anything unclassified | — |

Never render raw GitHub prose to users — map codes to your own copy.

## `ParseIssue`

Parse issues come back in `entry.issues` (from `list`/`get`) and from `entries.validate`. Each has
`path` (JSON Pointer, list indices as `path[i]`), `code`, `message`, and `severity`
(`"error" | "warning"`).

| Code | Severity typically | Meaning |
|---|---|---|
| `TYPE_MISMATCH` | error | Value has the wrong JSON type for the field |
| `MISSING_REQUIRED` | error | Required field absent |
| `INVALID_OPTION` | error | Select value not among the options |
| `OUT_OF_RANGE` | error | Number/string/list bounds violated |
| `PATTERN_MISMATCH` | error | String/image pattern violated |
| `INVALID_DATE` | error | Datetime not ISO (or not `YYYY-MM-DD` with `dateOnly`) |
| `INVALID_PATH` | error | Image value outside the public folder shape |
| `LIST_TOO_SHORT` / `LIST_TOO_LONG` | error | List `min`/`max` violated |
| `RELATION_UNKNOWN` | error | Relation target does not exist in the target collection |
| `RELATION_CHECK_FAILED` | error | Relation check could not run |
| `UNKNOWN_FIELD_TYPE` | error | Data for a field type the config no longer declares |
| `UNMODELED_KEY` | warning | Key not in the schema — preserved in `untouched` |
| `VIRTUAL_KEY_IGNORED` | warning | A stored `slug` key — the slug lives in the filename |

## Patterns

```ts
import { isCMSError } from "patcms"
import type { CMS, CMSError, Entry, EntryValue } from "patcms"

declare const cms: CMS // constructed as in getting-started.md
declare const entry: Entry
declare const formValue: EntryValue
declare function showFieldError(path: string, message: string): void

// 1. Gate saves with validate; render issues as form errors.
const check = await cms.entries.validate(entry, formValue)
if (!check.ok) {
  for (const issue of check.issues) showFieldError(issue.path, issue.message)
}

// 2. Catch CMSError at operation boundaries; branch on code.
function describe(error: unknown): string {
  if (!isCMSError(error)) return "Something went wrong"
  const copy: Record<CMSError["code"], string> = {
    AUTH_REQUIRED: "Sign in first.",
    AUTH_EXPIRED: "Your session expired — sign in again. Your draft is safe.",
    FORBIDDEN: "This token cannot write to the repository.",
    NOT_FOUND: "That entry no longer exists.",
    CONFLICT: "Someone saved before you.",
    RATE_LIMIT: "GitHub rate limit reached — try again shortly.",
    NETWORK: "Network trouble — nothing was lost.",
    VALIDATION: "Fix the highlighted fields.",
    UNSUPPORTED: "This collection does not allow that action.",
    INVALID_CONFIG: "Configuration error.",
    UNKNOWN: "Something went wrong.",
  }
  return copy[error.code]
}
```

## Where to next

- [conflicts-and-drafts.md](./conflicts-and-drafts.md) — the conflict value in depth
- [configuration.md](./configuration.md) — the lenient/strict split behind these codes
