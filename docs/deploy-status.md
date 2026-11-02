# Deploy status

After a save lands, the natural question is "is it live yet?". patcms answers it from two GitHub
sources with a strict precedence and a bias toward honesty: when data is missing the verdict is
`unavailable`, **never** a false `failed`.

## The two sources

| Source | When used | Success means |
|---|---|---|
| Check runs | Primary — always consulted | A decisive check run (`success`/`failure`) |
| Commit statuses | Only for contexts configured in `deploy.contexts` | A configured context reports success |

```ts
import { defineConfig } from "patcms"

export const config = defineConfig({
  media: { folder: "public/images", publicFolder: "/images" },
  deploy: { contexts: ["Cloudflare Pages"] }, // commit-status fallback
  collections: [],
})
```

Absent or empty `contexts` turns the commit-status fallback off entirely.

## The decision matrix

| Verdict | Meaning |
|---|---|
| `awaiting` | Nothing decisive yet and the commit is young |
| `building` | A check run or configured status is in progress |
| `live` | Decisive success |
| `failed` | Decisive failure (failure outranks a still-running sibling) |
| `unavailable` | No decisive result within the grace window, read errors, or no data — **never** a guess |

`neutral` and `skipped` check runs never count as success; a skipped-only set is `unavailable`.

## Watching a commit

The watcher is a pure state machine — it takes injected reads and timers, so it is trivially
testable. Wire it to a `GithubBackend` (see [advanced.md](./advanced.md)):

```ts
import {
  createStatusReads,
  createStatusWatcher,
  DEFAULT_STATUS_TIMING,
  GithubBackend,
} from "patcms/advanced"
import type { FetchLike } from "patcms/advanced"

declare const token: string
declare const commitSha: string

// DOM fetch → SDK transport seam (see advanced.md for why the adapter exists):
const fetchLike: FetchLike = (input, init) => fetch(input, init as RequestInit)

const backend = new GithubBackend({
  owner: "your-org",
  repo: "your-site",
  token,
  fetch: fetchLike,
})

const watcher = createStatusWatcher({
  sha: commitSha,
  reads: createStatusReads(backend, "main"),
  contexts: ["Cloudflare Pages"], // same list as config.deploy.contexts
  timing: DEFAULT_STATUS_TIMING, // optional — this is the default
  now: () => Date.now(),
  schedulePoll: (delayMs, task) => {
    const id = setTimeout(task, delayMs)
    return () => clearTimeout(id)
  },
  random: Math.random,
  onChange: (snapshot) => {
    // snapshot.kind: "awaiting" | "building" | "live" | "failed" | "unavailable"
    // snapshot.source: which truth source decided ("checks" | "statuses" | "none")
    // snapshot.detailsUrl: https-only link to the failing run, when present
    console.log(snapshot.kind, snapshot.source)
  },
})

watcher.start()
// The branch head advanced? The watcher is superseded and stops on its own —
// a stale snapshot is never presented as current. Stop manually when the UI goes away:
watcher.stop()
```

Defaults (`DEFAULT_STATUS_TIMING`, all overridable via `timing`): fast poll 5 s for the first
60 s, then 10 s; grace window 120 s before `unavailable`; 10-minute watch ceiling; ±20% jitter.

## The high-level path

The watcher needs a `GitBackend` (the advanced seam) — it is not on the high-level client. If you
are not assembling a backend anyway, the panel's approach is the honest one: show the commit sha
and link to the repo. And since a fine-grained PAT often **cannot** read check-runs at all, the
probe reports `checksRead` so you can hide the feature instead of showing `unavailable` forever.

## Where to next

- [advanced.md](./advanced.md) — constructing a `GithubBackend` for the watcher
- `specs/workflows/publish-and-recovery.md` — the full truth matrix and its invariants
