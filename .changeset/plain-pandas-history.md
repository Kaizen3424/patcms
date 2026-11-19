---
"patcms": minor
---

Adds entry history and restore: `entries.history` pages the commits that touched one file (a `listPaths` stub is enough, so deleted entries keep their log), `entries.atRevision` reads a past version without writing, and `entries.restore` writes that version's exact bytes as a new commit — a deleted file is re-created, a file changed since you loaded it is a `conflict`, a file that already holds those bytes is a `noop`, and a version that no longer validates is refused with `CMSError("VALIDATION")`. History is never rewritten and the ref is never forced. One `entries:restore` event fires per call. The GitHub backend gains `listCommits` for path-filtered log paging.
