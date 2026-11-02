# patcms pitfalls — what to avoid

Read this before writing unusual code against the package. The vetoes are enforced by the package's
architecture and its CI; breaking one in host code breaks the guarantees the host relies on.

## Hard vetoes

| Never | Why |
|---|---|
| `force: true` or any force-push | The conflict model assumes fast-forward-only refs; a force-push silently destroys partner work |
| Reading `raw.githubusercontent.com` | Leaves the token-scoped API surface; use the git blob API (`media.get`) |
| Token in a URL, query string, redirect, or log line | Tokens leak through history, referrers, logs. Sign-in form or env var only |
| `dangerouslySetInnerHTML`, `eval`, `new Function`, `innerHTML=` | Repository content is untrusted input; rendering it as HTML is the primary attack surface |
| `Object.assign` / deep merge on parsed repository JSON | Prototype pollution and silent clobbering; use `compareValues` / `canonicalJson` |
| A second serializer bypassing the save path | Serialization preserves newline style, trailing newline, and untouched keys; a side channel will not |
| Whole-entry conflict buttons ("take mine / theirs") | Conflicts are per-field values; whole-entry choices lose disjoint partner edits |
| Importing test doubles from the package | Public entries export none — fakes live in test-only support paths |
| Commit messages with `[skip ci]`-style tokens | The SDK refuses them before any network call — the CMS never mutes its own deploy |

## Failure modes that surprise people

- **The browser HTTP cache lies about the branch head.** GitHub serves the ref route with
  `max-age=60`. The client sends branch-addressed GETs with `cache: "no-store"` for this reason.
  Custom transports must keep that behaviour; SHA-addressed reads stay cacheable on purpose.
- **Conflicts are values.** Wrapping `entries.save` in try/catch to "handle conflicts" catches
  nothing — the catch branch is for `VALIDATION`, `AUTH_EXPIRED`, `RATE_LIMIT`, `NETWORK`.
- **`noop` is success.** Zero-diff saves return `{ status: "noop" }` with no commit. Do not retry,
  do not warn.
- **`defaultValue` is not injection.** Old entries never gain defaults by being read; defaults
  materialise only via `createBlankEntryValue` / `foldFieldDefaults`. Missing `hidden` fields with
  defaults ARE backfilled on save (repair-on-save).
- **A stored `slug` key is ignored on purpose.** The slug lives in the filename; a JSON `slug` key
  becomes `untouched` + a `VIRTUAL_KEY_IGNORED` warning.
- **Media guards refuse before any network call.** Empty file, > 90 MiB, `.svg` (unless
  `allowSvg`) → `CMSError VALIDATION`. No image processing exists in the SDK — resize/EXIF-strip
  host-side if needed.
- **Delete is reference-checked.** `media.delete` returns `{ status: "referenced", references }`
  instead of deleting; only pass `checkReferences: false` after a human decision. Deletes are
  tombstones in `_trash/`; restore refuses occupied destinations (`CONFLICT`).
- **Replaced images keep their path.** CDN may serve old bytes for up to an hour after
  `overwrite: true` — prefer delete + re-upload under a new path when freshness matters.
- **Rate budget is finite.** `session.rateLimit.remaining` is worth rendering; the probe reports
  `quotaBlockedUntil` when GitHub says the window is closed.
- **One fine-grained PAT, one repository.** Contents read+write, Checks read, optional
  Administration read. Any same-origin script can read a persisted token — keep it scoped and
  rotatable.
- **JSON only in v1.** No Markdown/MDX collections, no GitLab backend, no OAuth, no PR-review mode.
- **0.x breaks.** A minor release may change the API; pin the version.

## Quick triage

| Symptom | Likely cause |
|---|---|
| `CMSError AUTH_REQUIRED` on an operation | Not signed in — `auth.signIn` / seeded `token` missing |
| `AUTH_EXPIRED` mid-session | 401 during a write; session wiped, drafts kept, `onAuthExpired` fired |
| `FORBIDDEN` at sign-in | Token lacks Contents write (or the probe failed) — check scopes |
| `VALIDATION` with `issues` on save | Strict save gate; render `issue.path` + `issue.message` per field |
| `CONFLICT` from `media.upload` | Path exists — confirm, then `overwrite: true` |
| `CONFLICT` from `media.restore` | Destination occupied — by design |
| `UNSUPPORTED` on `create`/`delete` | Collection config sets `create: false` / `delete: false`, or files collection |
| Fresh upload missing from `media.list` | Stale HTTP cache in a custom transport — keep `cache: "no-store"` on branch-addressed GETs |
| Entry fields "disappearing" | They became unmodeled (config change) — they live in `entry.untouched` and survive saves |
| `INVALID_CONFIG` at construction | No global `fetch` in a Node script — pass `options.fetch` |
