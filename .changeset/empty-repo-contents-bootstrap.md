---
"patcms": minor
---

Empty repositories are now bootstrapped through the GitHub contents API. Live verification showed that GitHub closes its entire git-data API on a zero-commit repository — creating blobs, trees, and commits there all fail with 409 "Git Repository is empty" — so the previous git-data bootstrap could never land. The first save on an empty repository now creates the first commit and the branch with a single contents-API PUT: one commit when the save writes exactly one file, two commits (seed landing, then the remaining writes) when it writes several. Media uploads ride the same save path, so the first `media.upload` bootstraps the repository too. A write-side 409 carrying the "Git Repository is empty" signature now classifies as `EMPTY_REPO` instead of `VALIDATION`, so fresh-repository onboarding no longer reports "content needs attention". Races between two bootstraps still refuse as conflict values and the SDK never force-pushes.
