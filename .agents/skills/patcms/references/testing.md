# patcms testing guide

Every network call goes through one injected seam, and the package ships a fake GitHub that speaks
the real API shape. Integrations are testable without a real PAT.

## The `fetch` seam

```ts
import { createCMS } from "patcms"
import type { ConfigDefinition } from "patcms"
import type { FetchLike } from "patcms/advanced"

declare const config: ConfigDefinition

// Your fake transport: assert on `input`, serve fixture responses. Branch-
// addressed GETs arrive with init.cache === "no-store" — fakes may ignore it.
const fakeFetch: FetchLike = (input) => {
  console.log("REQUEST", input)
  return Promise.resolve(new Response("{}", { status: 200 }))
}

const cms = createCMS({
  config,
  repository: { owner: "test-org", repo: "test-repo", branch: "main" },
  token: "github_pat_test",
  fetch: fakeFetch,
})
```

The transport receives every request as `(input: string, init?: FetchRequestInitLike)` where the
init carries `method`, `headers` (record), `body` (`string | Uint8Array`), and `cache`
(`"no-store"` on branch-addressed GETs). Responses need only `{ ok, status, statusText, headers.get,
json(), text() }` — a real `Response` satisfies that.

Note: a raw DOM `fetch` does not structurally satisfy `FetchLike` (the DOM `RequestInit.body` type
is wider than what the SDK sends) — adapt once with
`const fetchLike: FetchLike = (input, init) => fetch(input, init as RequestInit)`.

## The fake GitHub harness (in the patcms repository)

Test-only pieces under `packages/core/src/__tests__/support/` (never exported from the package):

| Piece | Job |
|---|---|
| `FakeGithubServer` | In-memory GitHub: refs, trees, blobs, commits, CAS semantics, check-runs |
| `fake-github-fetch` | The same fake as a `fetch` handler — point `options.fetch` at it |
| `contract-suite.ts` | The behavioural contract every backend must satisfy |

The fake implements real failure modes (CAS conflicts, 401s, rate limits, truncated responses) —
mocking business logic is forbidden in this repo; integration tests exercise real code paths.

## The playground dev harness

`pnpm -C playground dev` runs the example panel against the fake in a real browser (MSW). Query
parameters inject the failure modes users actually hit:

| Parameter | Effect |
|---|---|
| `conflictDemo=save` | A foreign commit lands right before the CAS check → conflict value |
| `tokenChaos=expire-on-write` | Token expires after the first write → 401 recovery path |
| `rateLimitWriteSeconds=<n>` | Writes rate-limited for n seconds |
| `failBlobUploadIndex=<n>` | The n-th blob POST fails with 503 → upload retry path |

The harness's `guardFetch` refuses any GitHub request when the fake worker is not controlling the
page — a leaked real request fails loudly instead of silently hitting `api.github.com`. Steal that
pattern for your own dev harness.

## Testing your own admin

1. **Unit-test UI logic against the value contracts** — conflicts are values, `noop` is normal,
   issues are data. No network needed.
2. **Integration-test the wiring** with `options.fetch` pointed at a fake speaking the real routes.
3. **Smoke-test against a real repository last**, with a dedicated test repo and a scoped PAT:
   read-only probe → one save (verify the diff touches only your field) → one deliberate conflict
   (push externally, then save) → one media upload/delete/restore → clean up and verify the tree is
   byte-identical to where you started.
4. Never test against production content, and never add force semantics — the client has none, and
   your harness must not either.
