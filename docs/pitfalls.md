# Pitfalls

The vetoes and gotchas below are the ones that cost real time to discover. The first section is
non-negotiable — the package's own architecture refuses these, and so should your host code.

## The standing vetoes

| Never | Why |
|---|---|
| `force: true`, or any force-push | The whole conflict model assumes fast-forward-only refs. A forced push silently destroys partner work |
| Reading `raw.githubusercontent.com` | It leaves the token-scoped API surface. Files and previews come from the git blob API (`media.get`) |
| A token in a URL, query string, redirect, or log line | Tokens leak through history, referrers, and logs. Sign-in form or env var, nothing else |
| `dangerouslySetInnerHTML`, `eval`, `new Function`, `innerHTML=` | Repository content is untrusted input; rendering it as HTML is the primary attack surface |
| `Object.assign` or deep-merging parsed repository JSON | Prototype pollution and silent key clobbering. Use the value-domain helpers (`compareValues`, `canonicalJson`) |
| A second serializer bypassing the save path | Serialization preserves newline style, trailing newline, and untouched keys — a side channel will not |
| Whole-entry conflict choices in your default UI | Conflicts are per-field values; a "take mine / take theirs" whole-entry button loses disjoint partner edits |
| Test doubles imported from the package | The public entries export none — fakes live in test-only support paths |

## Operational gotchas

### The browser HTTP cache lies about the branch head

GitHub serves `GET /git/ref/heads/main` with `Cache-Control: max-age=60`. The client sends
branch-addressed GETs (the ref, contents listings, the probe) with `cache: "no-store"` for exactly
this reason — without it, a just-pushed foreign commit is invisible for up to a minute and the
media list misses fresh uploads. If you write your own transport or cache layer, keep that
`no-store`; SHA-addressed reads (trees, commits, blobs) stay cacheable on purpose.

### A replaced image keeps its old bytes for a while

`media.upload(..., { overwrite: true })` keeps the path, so the CDN may serve the stale image for
up to an hour. When freshness matters, delete + re-upload under a new path instead.

### Conflicts are values — do not try to catch them

A save that hits a CAS conflict on your file returns `{ status: "conflict", current, local }`.
Wrapping `entries.save` in try/catch to "handle conflicts" catches nothing; the catch branch is for
`VALIDATION`, `AUTH_EXPIRED`, `RATE_LIMIT`, and friends (see [errors.md](./errors.md)).

### `noop` is success

A save whose serialized bytes equal what is on the branch returns `{ status: "noop" }` with no
commit. Treat it as saved — do not retry, do not warn.

### `defaultValue` is metadata, not injection

Parsing never inserts defaults into loaded entries. Defaults materialise only through
`createBlankEntryValue` / `foldFieldDefaults` when a host builds a new value. If a field looks
"missing" on old entries, that is the untouched-preservation contract working.

### Stored `slug` keys are ignored on purpose

The slug lives in the filename. A `slug` key inside the JSON becomes an `UNMODELED_KEY` +
`VIRTUAL_KEY_IGNORED` warning and rides in `entry.untouched` — it is not deleted, but it does not
drive anything.

### Media guards refuse before any network call

Empty file, > 90 MiB, and `.svg` (unless `allowSvg`) are rejected with `VALIDATION` before a byte
leaves the browser. There is no image processing in the SDK — resize and EXIF-strip host-side if
your product needs it.

### Delete is reference-checked, and that is a feature

`media.delete` returns `{ status: "referenced", references }` instead of deleting when entries use
the file. Render the references (`collection`, `slug`, `fieldPath`, `title`, `altText`); only pass
`checkReferences: false` after a human decision.

### Skip tokens are refused, not stripped

A commit message containing `[skip ci]` (or `[ci skip]`, `[no ci]`, `[skip actions]`) fails the
save before any network call. The CMS must never silently suppress its own deploy.

### One fine-grained PAT, one repository

Scope the token to the repository it manages (Contents read+write, Checks read, optional
Administration read). Any same-origin script can read a persisted token — single repo, rotatable,
never in logs.

### JSON only in v1

Entries are JSON documents. Markdown/MDX collections, GitLab backends, OAuth, and PR-based review
flows are out of scope for 0.x — do not build on them existing.

### 0.x will break

The package is pre-1.0: a minor release may change the API. Pin your version, and read the
changesets before upgrading.

## Where to next

- [errors.md](./errors.md) — the full code catalogue behind several of these
- `specs/CMS.md` §8 — the veto list in its canonical form
