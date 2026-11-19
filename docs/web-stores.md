# `patcms/web`

The browser-only adapters: an IndexedDB draft store, an on-device content cache, and token stores.
Everything else in the package is Node-safe — this is the only entry that touches DOM globals, and
the main package never imports it. A host that keeps everything in memory does not need it at all.

```bash
# imported as:
import { createIdbContentStore, createIdbDraftStore, createIdbTokenStore } from "patcms/web"
```

## Draft persistence

```ts
import { createIdbDraftStore } from "patcms/web"
import { createCMS } from "patcms"
import type { ConfigDefinition } from "patcms"

declare const config: ConfigDefinition

const cms = createCMS({
  config,
  repository: { owner: "your-org", repo: "your-site", branch: "main" },
  drafts: createIdbDraftStore(), // drafts survive reloads and crashed tabs
})
```

| Export | Job |
|---|---|
| `createIdbDraftStore(options?)` | `DraftStore` backed by IndexedDB. `options`: `{ dbName?, storeName? }` (sane defaults) |
| `clearIdbDraftStore(options?)` | Wipes the draft store (e.g. a "clear local data" setting) |

## On-device content cache

Without this, every fresh page load downloads every entry in the collections you open. With it, the
text is kept on the device and only documents whose bytes actually changed are downloaded. A warm
open of a 180-entry collection goes from ~183 requests to 3 (ref, commit, tree).

```ts
import { createIdbContentStore } from "patcms/web"
import { createCMS } from "patcms"
import type { ConfigDefinition } from "patcms"

declare const config: ConfigDefinition

const cms = createCMS({
  config,
  repository: { owner: "your-org", repo: "your-site", branch: "main" },
  contentStore: createIdbContentStore(), // cold opens stop re-downloading unchanged entries
})
```

Records are keyed by **path + git blob sha**, never by path alone, so a foreign edit cannot be served
from an old copy: the new tree carries a new sha and the record simply misses. Because the key is
not repo-scoped, use one `ContentStore` per repository (or give each repo its own `storeName`).
Stored text is raw JSON, not a parsed object, so a schema change cannot corrupt the cache. The store is bounded (8 MiB
/ 2000 records by default, oldest first) and pruned against the current tree. Signing out wipes it;
`destroy()` and closing the tab leave it intact.

| Export | Job |
|---|---|
| `createIdbContentStore(options?)` | `ContentStore` backed by IndexedDB. `options`: `{ dbName?, storeName?, maxBytes?, maxEntries? }` |
| `clearIdbContentStore(options?)` | Wipes only the content store |

To write your own adapter, implement the `ContentStore` seam from `patcms`; the browser one is just
the shipped implementation.

## Token persistence

```ts
import { createIdbTokenStore, createSessionTokenStore } from "patcms/web"
import { createCMS } from "patcms"
import type { ConfigDefinition } from "patcms"

declare const config: ConfigDefinition

const cms = createCMS({
  config,
  repository: { owner: "your-org", repo: "your-site", branch: "main" },
  // Survives reloads; combined with auth.signIn(token, { remember: true }):
  tokenStore: createIdbTokenStore(),
  // Or tab-session only:
  // tokenStore: createSessionTokenStore(),
})
```

| Export | Job |
|---|---|
| `createIdbTokenStore(options?)` | `TokenStore` backed by IndexedDB. `options`: `{ dbName?, storeName?, key? }` |
| `createSessionTokenStore(key?)` | `TokenStore` backed by `sessionStorage` (tab lifetime only) |

A failed re-check wipes the stored token and drops to `signedOut` — the host shows its sign-in form
again. See [authentication.md](./authentication.md).

## The shared database

Both stores share one IndexedDB database with per-purpose object stores:

| Export | Job |
|---|---|
| `PATCMS_IDB_STORES` | `["auth", "drafts", "content"]` — the store names the package owns |
| `openPatcmsDatabase(dbName?, storeNames?)` | Low-level opener returning the raw `IDBDatabase` |
| `createSharedStore(dbName, storeName)` | Build an `idb-keyval`-compatible custom store on the shared database |
| `closePatcmsDatabases()` | Close every opened handle (tests, hot reload) |

If you bring your own persistence, you do not need any of this: `createCMS` accepts any
`DraftStore`/`TokenStore`/`ContentStore` implementation (see the seams in
[conflicts-and-drafts.md](./conflicts-and-drafts.md),
[authentication.md](./authentication.md), and [reading-content.md](./reading-content.md)).

## Threat model reminder

An IndexedDB token is readable by any code on the same origin. Keep the PAT single-repository,
fine-grained, and rotatable — see [authentication.md](./authentication.md).
