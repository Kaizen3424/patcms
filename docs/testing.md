# Testing an integration

patcms is built to be tested without GitHub. Every network call goes through one injected seam
(`fetch`), and the repo ships a fake GitHub that speaks the real API shape — the same fake the
package's own 500+ tests run against.

## The `fetch` seam

`createCMS` accepts `options.fetch`. In tests, intercept it:

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

The custom transport receives every request: `input` is the URL string, `init` a
`FetchRequestInitLike` (method, headers, body, and `cache` — branch-addressed GETs arrive with
`cache: "no-store"`). Assert on URLs and bodies, or serve responses from fixtures.

## The fake GitHub harness

Two layers live in the repo, both test-only (never exported from the package):

| Piece | Where | Job |
|---|---|---|
| `FakeGithubServer` | `packages/core/src/__tests__/support/fake-github-server.ts` | An in-memory GitHub: refs, trees, blobs, commits, CAS semantics, check-runs |
| `fake-github-fetch` | `packages/core/src/__tests__/support/fake-github-fetch.ts` | The same fake as a `fetch` handler — point `options.fetch` at it |
| contract suite | `packages/core/src/__tests__/support/contract-suite.ts` | The behavioural contract every backend must satisfy |

A test harness that **mocks business logic** is forbidden here — the fake implements the real API
shapes (including failure modes: CAS conflicts, 401s, rate limits, truncated responses), so
integration tests exercise the real code paths.

## The playground dev harness

`pnpm -C playground dev` runs the example panel against the fake inside a real browser (MSW
service worker). Query parameters inject chaos — the same failure modes your users will hit:

| Parameter | Effect |
|---|---|
| `conflictDemo=save` | A foreign commit lands right before the CAS check → conflict value |
| `tokenChaos=expire-on-write` | The token expires after the first write → 401 recovery path |
| `rateLimitWriteSeconds=<n>` | Writes rate-limited for n seconds |
| `failBlobUploadIndex=<n>` | The n-th blob POST fails with a 503 → upload retry path |

The harness also guards itself: its `guardFetch` refuses any GitHub request when the fake worker is
not controlling the page — so a leaked real request fails loudly instead of silently hitting
`api.github.com`. Steal that pattern for your own dev harness.

## Testing your own admin

1. **Unit-test your UI logic** against the value contracts: conflicts are values, `noop` is normal,
   issues are data. None of that needs a network.
2. **Integration-test the wiring** with `options.fetch` pointed at the fake (or a thin fake of your
   own that speaks the same routes).
3. **Smoke-test against a real repository** last, with a dedicated test repo and a scoped PAT:
   - read-only probe first,
   - one save, verify the diff touches only your field,
   - one deliberate conflict (push externally, then save),
   - one media upload/delete/restore,
   - then clean up and verify the tree is byte-identical to where you started.
4. Never test against production content, and never let a test run with `force` semantics — the
   client has none, and your harness should not add any.

## Where to next

- `specs/test-harness-architecture.md` — how the fake is built and what the suites cover
- [pitfalls.md](./pitfalls.md) — the failure modes worth chaos-testing
