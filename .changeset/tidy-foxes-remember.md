---
"patcms": minor
---

Adds an optional on-device content cache: `createCMS({ contentStore })`, with the IndexedDB adapter `createIdbContentStore()` from `patcms/web`. Entry text is keyed by path + blob SHA, so a warm open skips every unchanged document (183 → 3 requests for 180 entries). The store is bounded, pruned against the current tree, and wiped on sign-out and `clearCache()` — not on `destroy()`. `clearCache()` is now async.
