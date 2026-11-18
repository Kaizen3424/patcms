---
"patcms": minor
---

Reads now reuse a head confirmed within 30 s (`readReuseMs`, default 30 000; `0` disables) and cache entry bodies by blob sha, so a repeat listing, an entry open right after a listing, and a re-open after `refresh()` download nothing. `refresh()` re-checks the ref only and keeps unchanged bodies. Parallel body reads are capped at 5 (`readConcurrency`), and the in-memory blob cache is LRU-bounded (`maxBlobBytes`, `maxBlobEntries`). Every write path still re-checks the head first, so the window can delay a foreign change on screen but never hide it from a save. Adds `deploy.propagationMs` and `DEFAULT_DEPLOY_PROPAGATION_MS` for the post-save "may take a moment" notice.
