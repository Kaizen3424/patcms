# `patcms/web`

The browser-only adapters: an IndexedDB draft store and token stores. Everything else in the
package is Node-safe — this is the only entry that touches DOM globals, and the main package never
imports it. A host that keeps drafts in memory does not need it at all.

```bash
# imported as:
import { createIdbDraftStore, createIdbTokenStore } from "patcms/web"
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
| `PATCMS_IDB_STORES` | `["auth", "drafts"]` — the store names the package owns |
| `openPatcmsDatabase(dbName?, storeNames?)` | Low-level opener returning the raw `IDBDatabase` |
| `createSharedStore(dbName, storeName)` | Build an `idb-keyval`-compatible custom store on the shared database |
| `closePatcmsDatabases()` | Close every opened handle (tests, hot reload) |

If you bring your own persistence, you do not need any of this: `createCMS` accepts any
`DraftStore`/`TokenStore` implementation (see the seams in
[conflicts-and-drafts.md](./conflicts-and-drafts.md) and
[authentication.md](./authentication.md)).

## Threat model reminder

An IndexedDB token is readable by any code on the same origin. Keep the PAT single-repository,
fine-grained, and rotatable — see [authentication.md](./authentication.md).
