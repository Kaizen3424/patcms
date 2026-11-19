---
"patcms": minor
---

Adds all-or-nothing bulk writes: `entries.saveMany`, `entries.createMany`, and `entries.deleteMany` commit a whole batch once, check every base sha before writing, and return stale rows as conflicts with their current state. `saveMany` also accepts `list()` stubs, so a table can save edited rows without a per-row `get()`. One `entries:bulk` event fires per call.
