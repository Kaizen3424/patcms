---
"patcms": minor
---

The headless client: `createCMS()` with `auth`, `entries`, `media`, `drafts`, and `events`; saves are single fast-forward-only commits whose conflicts come back as values; unmodeled keys are preserved verbatim across saves; the surface is split into `patcms`, `patcms/advanced`, and `patcms/web`.
