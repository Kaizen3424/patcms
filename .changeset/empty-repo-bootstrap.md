---
"patcms": minor
---

Empty repositories are now supported end-to-end. Reads of a freshly created (zero-commit) repository treat it as "no content" — `entries.listPaths` returns `[]`, `entries.get` and the commit log behave as not-found/empty, and the GitHub 409 "Git Repository is empty" response is recognized as typed no-content instead of leaking an UNKNOWN error. The first save on an empty repository now bootstraps the repository: it creates the root commit and the branch in that one save; every later save is an ordinary fast-forward, and a race between two bootstraps resolves as a conflict value (never a force-push). Saving to a branch that does not exist on a repository that has commits now fails fast with a clear `NOT_FOUND` error naming the branch.
