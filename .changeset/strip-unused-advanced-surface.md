---
"patcms": minor
---

Removed three advanced surfaces that had no remaining consumers:

- `SnapshotStore` and the `patcms/advanced` cache re-exports — superseded by the client's internal head/tree cache; hosts building a custom read layer should own their own cache.
- The recorded-replay helpers (`createReplayFetch`, `buildMatchKey`, `canonicalizeJson`, `normalizeBodyString`, `normalizeRequestPath`, and the `RecordedTape` types) — test-harness machinery that does not belong on a public entry; it stays internal to the repo's recorded-tape tests.
- The founder-surface display helpers `formatMoney`, `formatFriendlyDate`, `formatRelativeTime`, and `parseDate` — host UI conveniences with no consumer left; format dates and money in your own UI with `Intl`.
