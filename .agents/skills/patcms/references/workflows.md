# patcms task recipes

Concrete flows for the tasks an agent is most likely asked to implement. Snippets assume a
constructed client where noted (`declare const cms: CMS` — construct it as in the SKILL.md
quickstart).

## Boot: restore a remembered session

```ts
import type { CMS } from "patcms"

declare const cms: CMS

// On app boot: restore a persisted token (undefined when none) and re-probe.
const session = await cms.auth.restore()

// Drive your UI from status transitions:
const off = cms.auth.onChange((status) => {
  console.log("auth:", status) // "signedOut" | "checking" | "signedIn"
})
// Later: off()
```

If the probe fails (revoked token), the stored token is wiped and the host shows its sign-in form.
A 401 mid-write marks the session expired, keeps drafts, and calls the `onAuthExpired` callback
passed to `createCMS()`.

## Guide the user to a suitable token

Hosts that show a "how do I make a token?" helper can pre-fill the fine-grained personal access
token form with a template URL (documented under "Pre-filling fine-grained token details using URL
parameters" in GitHub Docs):

```http
https://github.com/settings/personal-access-tokens/new
  ?name=My+site+editor
  &description=Content+and+media+access
  &target_name=my-org
  &expires_in=90
  &contents=write
```

| Parameter | Pre-fills |
| --- | --- |
| `name` | token display name (≤ 40 chars, URL-encoded) |
| `description` | token description (≤ 1024 chars, URL-encoded) |
| `target_name` | resource owner — user or organization slug |
| `expires_in` | days until expiration: integer 1–366, or `none` |
| `<permission>=read\|write\|admin` | one query parameter per permission, e.g. `contents=write` |

- **Required permissions:** `contents=write` (which includes read) is the only mandatory
  permission — commits, ref updates, git blob reads, and media uploads all use Contents.
  `metadata:read` is included automatically with any fine-grained token.
- **Optional read-only extras:** `checks=read` and `administration=read` back the deploy-status
  feature and the probe's branch-protection check. The sign-in probe treats both as advisory —
  login and saving work without them — but adding them keeps the capability report fully green
  instead of `forbidden`/`missing`.
- **Repository selection cannot be pre-filled:** the URL pre-fills name/owner/expiry/permissions,
  but there is no query parameter for the repository list. Always instruct the user to choose
  **Only select repositories** and select only the content repository — never **All
  repositories**. Without the selection the token can access nothing.
- For an organization, `target_name` must be an organization the token's creator is a member of,
  and the organization's PAT policy must allow the token (an org owner may need to approve it).
  An organization token-lifetime policy can also cap `expires_in=none` to a shorter maximum.
- Template parameters carry no secret — this does not violate the "never put the token in a URL"
  rule. Never append a created token to any URL.

### Recipe: producing a custom token URL (on request)

When the user asks for the token link / pre-filled token URL for a project (new or existing),
produce it from the project's content repository details — never hardcode one project's URL into
another:

1. **Read the project's repository details** — the owner (user or organization), repo name, and
   branch from the host's connection config, defaults, or README. If they are not set anywhere,
   ask the user for the GitHub URL before inventing values.
2. **Build the URL**, one `&`-separated parameter per field, URL-encoded:
   - `name=[site]+[purpose]+editor` (≤ 40 chars, e.g. `Casa+Kryz+content+editor`)
   - `description=[short purpose note for the content repo]`
   - `target_name=[owner slug]`
   - `expires_in=none` for a long-lived client-facing editor; a number of days (e.g. `90`) for
     automation or tooling — when the choice isn't obvious, ask in the same reply, don't stall
   - `contents=write` (mandatory), `checks=read` and `administration=read` (optional read-only
     extras, keep them so the capability probe reports green)
3. **Always state, in the same reply:**
   - the token is shown once after **Generate token** — copy immediately;
   - repository selection cannot be pre-filled — instruct them to choose **Only select
     repositories** and select **only** the content repository, never **All repositories**;
   - for an organization: the creator must be a member of the org, its PAT policy must allow
     tokens, and the token may need org-owner approval; the org's maximum-lifetime policy can cap
     `none`.
4. If the host has an admin page with token instructions, update its help text to use the new
   URL (with `&` escaped as `&amp;` in HTML attributes) instead of leaving the generic page link.

## List and render a library

```ts
import type { CMS } from "patcms"

declare const cms: CMS

const posts = await cms.entries.list("posts", { sort: "date", direction: "desc" })
for (const post of posts) {
  console.log(post.slug, post.title, post.issues.length ? `${post.issues.length} parse issue(s)` : "")
}
const drafts = await cms.drafts.list("posts") // for "unsaved changes" badges
```

## Edit, autosave a draft, save

```ts
import type { CMS, Entry, EntryValue } from "patcms"

declare const cms: CMS

const entry = await cms.entries.get("posts", "hello-world")

// Offer a saved draft before editing; warn when the branch moved since it was written.
const draft = await cms.drafts.get(entry)
if (draft && draft.baseSha !== entry.sha) console.warn("draft is stale — the branch moved")

// Autosave: debounce drafts.save (~600 ms after the last keystroke in the reference panel).
let timer: ReturnType<typeof setTimeout> | undefined
function queueDraftSave(value: EntryValue): void {
  clearTimeout(timer)
  timer = setTimeout(() => void cms.drafts.save(entry, value), 600)
}

// Save: validate first (issues as a value), then save (validation failure throws).
const formValue: EntryValue = draft?.value ?? entry.value
const check = await cms.entries.validate(entry, formValue)
if (!check.ok) {
  for (const issue of check.issues) console.log(issue.severity, issue.path, issue.message)
} else {
  const result = await cms.entries.save(entry, formValue)
  if (result.status === "saved") {
    console.log("commit", result.commitSha) // the client deleted the draft for you
  } else if (result.status === "noop") {
    console.log("nothing changed — no commit") // treat as success
  } else {
    console.log("conflict — see the recipe below")
  }
}
```

## Resolve a conflict (per field, never whole-entry)

```ts
import { canonicalJson } from "patcms"
import type { CMS, Entry, EntryValue, FieldDescriptor, JsonValue } from "patcms"

declare const cms: CMS
declare const entry: Entry
declare const formValue: EntryValue

function sameValue(a: unknown, b: unknown): boolean {
  return canonicalJson((a ?? null) as JsonValue) === canonicalJson((b ?? null) as JsonValue)
}

const result = await cms.entries.save(entry, formValue)
if (result.status === "conflict") {
  // One row per modeled field: remote value vs yours. Render both; let the user pick.
  const rows = entry.fields
    .filter((field) => field.type !== "divider" && field.type !== "hidden" && field.type !== "slug")
    .map((field) => ({
      name: field.name,
      theirs: result.current.value[field.name],
      mine: result.local[field.name],
      equal: sameValue(result.current.value[field.name], result.local[field.name]),
    }))

  // Compose the picks on top of the REMOTE value so unrendered partner edits survive.
  const picks: Record<string, "mine" | "current"> = {}
  for (const row of rows) picks[row.name] = row.equal ? "current" : "mine"
  const merged: Record<string, unknown> = { ...result.current.value }
  for (const field of entry.fields) {
    if (field.type !== "divider" && picks[field.name] === "mine" && field.name in result.local) {
      merged[field.name] = result.local[field.name]
    }
  }

  // The next save diffs against the reconciled tree — it cannot revert the partner's edits.
  await cms.entries.save(result.current, merged)
}
```

For automatic field-level merging, use `rebase()` from `patcms/advanced` — the default path never
merges on its own.

## Create and delete entries

```ts
import { isCMSError } from "patcms"
import type { CMS } from "patcms"

declare const cms: CMS

const created = await cms.entries.create("posts", { title: "Hello", date: "2026-05-01" })
if (created.status === "saved") console.log(created.entry.slug)
// Validation failures throw CMSError VALIDATION with .issues — catch and render:
try {
  await cms.entries.create("posts", {})
} catch (error) {
  if (isCMSError(error) && error.code === "VALIDATION") console.log(error.issues)
}

const existing = await cms.entries.get("posts", "hello-world")
const gone = await cms.entries.delete(existing)
if (gone.status === "conflict") console.log(gone.current) // changed on branch — re-read first
```

On a **freshly created (empty) repository** the first `entries.create` also creates the very first
commit and the branch — reads before it are empty lists / `NOT_FOUND`, and no separate "repo init"
exists. GitHub closes its git-data API (blobs/trees/commits) on zero-commit repos, so the SDK
bootstraps through the contents API instead: a single-file first save is one commit; when the first
save touches several files the seed landing is one commit and the rest a second (the one documented
exception to one-commit-per-save). A `NOT_FOUND` whose message names the branch instead means the
branch is missing on a repository that has commits: create the branch on GitHub first, then save.

## Media: upload, reference, delete, restore

```ts
import { isCMSError } from "patcms"
import type { CMS } from "patcms"

declare const cms: CMS
declare const bytes: Uint8Array // e.g. new Uint8Array(await file.arrayBuffer())

// Upload (guards run before any network call: empty, > 90 MiB, .svg unless allowSvg).
try {
  const file = await cms.media.upload({ name: "kyoto-garden.jpg", bytes })
  console.log(file.publicPath) // "/images/kyoto-garden.jpg" — store this in an image field
} catch (error) {
  if (isCMSError(error) && error.code === "CONFLICT") {
    await cms.media.upload({ name: "kyoto-garden.jpg", bytes }, { overwrite: true })
  }
}

// Reference check is automatic on delete; the result names every usage.
const deletion = await cms.media.delete("/images/kyoto-garden.jpg")
if (deletion.status === "referenced") {
  for (const ref of deletion.references) {
    console.log(ref.collection, ref.slug, ref.fieldPath, ref.altText)
  }
  // After a human decision, force past the guard:
  await cms.media.delete("/images/kyoto-garden.jpg", { checkReferences: false })
}

// Trash tab and restore (restore refuses when the destination is occupied — CONFLICT).
const trash = await cms.media.list({ includeTrash: true })
if (trash[0]) {
  const restored = await cms.media.restore(trash[0].path)
  console.log(restored.publicPath)
}
```

Previews read bytes through the blob API (`media.get`) and mint object URLs — one per path, revoked
on unmount, invalidated after writes. `raw.githubusercontent.com` is banned. A replaced file keeps
its path, so the CDN may serve old bytes for a while — prefer delete + re-upload when freshness
matters.

## Deploy status (advanced)

```ts
import {
  createStatusReads,
  createStatusWatcher,
  DEFAULT_STATUS_TIMING,
  FetchLike,
  GithubBackend,
} from "patcms/advanced"

declare const token: string
declare const commitSha: string

const fetchLike: FetchLike = (input, init) => fetch(input, init as RequestInit)
const backend = new GithubBackend({ owner: "your-org", repo: "your-site", token, fetch: fetchLike })

const watcher = createStatusWatcher({
  sha: commitSha,
  reads: createStatusReads(backend, "main"),
  contexts: ["Cloudflare Pages"], // same list as config.deploy.contexts
  timing: DEFAULT_STATUS_TIMING,
  now: () => Date.now(),
  schedulePoll: (delayMs, task) => {
    const id = setTimeout(task, delayMs)
    return () => clearTimeout(id)
  },
  random: Math.random,
  onChange: (snapshot) => console.log(snapshot.kind, snapshot.source),
})
watcher.start()
watcher.stop()
```

Verdicts: `awaiting` / `building` / `live` / `failed` / `unavailable`. Missing data is
`unavailable`, never a false `failed`. A fine-grained PAT often cannot read check-runs — the probe's
`checksRead` tells you whether to render the feature at all.

## Node script (no browser, no UI)

```ts
import { createCMS } from "patcms"
import type { ConfigDefinition } from "patcms"

declare const config: ConfigDefinition
declare const process: { env: Record<string, string | undefined> }

const cms = createCMS({
  config,
  repository: { owner: "your-org", repo: "your-site", branch: "main" },
  token: process.env.GITHUB_TOKEN, // seeded without probing
})
await cms.auth.verify() // probe now; throws when the token cannot write

for (const entry of await cms.entries.listPaths("posts")) {
  console.log(entry.slug)
}
```
