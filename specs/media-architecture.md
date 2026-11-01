# Media

> Parent: [`specs/CMS.md`](CMS.md)

Media is the only binary content in the repo, and the only place where a wrong path silently breaks
the live site. Two rules carry most of the design: the public⇄repo mapping is bijective and validated,
and nothing is ever hard-deleted.

## The bijection

| Direction | Function |
|---|---|
| public → repo | `publicPathToRepoPath(publicPath, media)` |
| repo → public | `repoPathToPublicPath(repoPath, media)` |
| active folders | `resolveMediaFolders(config, collectionName?)` |

All three live in `packages/core/src/media/bijection.ts`. Both directions run `safePath()`: traversals,
backslashes, encoded separators, absolute paths, and prefix escapes are rejected, not normalised.

Consequence: a stored image value is always a **public path** (`/images/…`), while the file always
lives at a **repo path** (`public/images/…`). Writing one where the other belongs produces a broken
image that no type checker catches.

Collection overrides are resolved in exactly one function. Re-implementing the `config.media`
fallback elsewhere will drift.

## Upload pipeline

The SDK path (`media.upload` in `packages/core/src/client/media.ts`) is: sanitise the filename →
client guards → git blob → commit through the normal save transaction.

| Guard | Value | Why |
|---|---|---|
| Max file size | 90 MiB | client-side refusal before network |
| SVG | rejected | script-bearing XML, not a raster (`allowSvg` to override) |
| Empty file | rejected | nothing to commit |

There is no raster normalisation in the SDK: the deleted reference admin ran a worker pipeline
(header sniff, EXIF-stripping re-encode to WebP, 15 MB / 24 MP / 8192 px caps) that died with it. A
host that wants those guarantees builds them host-side before calling `media.upload`. Batch uploads
that must land with an entry in ONE tree commit go through the advanced batch save (INV-M02).

## Previews

- Previews read the **git blob API** (`readBlob`) and turn bytes into object URLs. The example panel
  implements the cache (`MediaPreviewCache` in `playground/src/panel/screens/MediaScreen.tsx`): one
  object URL per blob sha, disposed when the media tab unmounts.
- `raw.githubusercontent.com` is banned: it would leave the token-scoped API surface and violate the
  origin allowlist (INV-N03).

**Replace-in-place honesty.** Replacing a file keeps its path, so the CDN may serve the old bytes for
up to about an hour. A host UI that offers replace must say so rather than pretending the swap is
instant; the example panel offers delete + re-upload instead.

## Delete ladder

| Rung | Action | Effect |
|---|---|---|
| 1 | Remove from an entry | Clears the field value; the file stays |
| 2 | Delete in the media library | **Blocked** while `findReferences` finds at least one usage |
| 3 | Confirmed delete | One atomic commit moving the blob to `_trash/` |

- `findReferences` (`packages/core/src/media/references.ts`) scans entry values across the whole index
  for the public path, and for relation slugs.
- `_trash/` is a real repo prefix (`TRASH_PREFIX`), so a tombstone is visible in git history and
  survives a reload.
- Restore (`createRestoreChanges`, `restoreMediaPath` in `packages/core/src/media/delete-ladder.ts`) is
  **collision-guarded**: if the original path is occupied, restore refuses rather than overwriting.

## Budget

`calculateMediaBudget` (`packages/core/src/media/budget.ts`) is O(N) over one recursive tree read — no
network.

| Metric | Threshold | Behaviour |
|---|---|---|
| Total media bytes | ≥ 800 MB | warn |
| Total media files | ≥ 2,500 | warn |
| Single upload | > 90 MiB | hard block |

Warnings are advisory and never block a save.

## Failure modes worth knowing

| Symptom | Likely cause |
|---|---|
| Broken image after publish | repo path written as a public path, or the reverse |
| Delete button disabled | References exist; the UI must name them |
| Restore refuses | Target path is occupied — by design |
| Old image persists after replace | CDN cache, not a save failure |
| Upload rejected instantly | Client guard (size, SVG, empty) before any network call |

## Decisions and claims

### Decisions

| ID | The rule that still binds |
|---|---|
| ADR-0007 | A standalone `media.upload` commits the file through the same transactional save primitive as an entry; a batch of media plus the entry JSON lands as ONE tree commit via the advanced batch save. Previews read `/git/blobs/{sha}` and are cached by blob sha; `raw.githubusercontent.com` is never used. Writes go only through `safePath()`-validated repo paths mapped by config; delete and rename need `findReferences()` clearance; replace-in-place warns about CDN staleness. Budget: warn at ~800 MB or 2 500 files, block any single upload above 90 MiB. No LFS in v1. Raster normalisation (EXIF strip, re-encode, dimension caps) is a host concern — the reference admin's worker pipeline was deleted with it. |

### Claims

| ID | Claim | Enforcing test |
|---|---|---|
| INV-M01 | The public⇄repo bijection is identity-preserving, honours per-collection overrides, and rejects traversal and prefix escapes | `packages/core/src/media/__tests__/inv-media-bijection.test.ts` |
| INV-M02 | N photos plus the entry JSON are one tree commit; a per-tile retry resends only the failed file | `packages/core/src/pipeline/__tests__/inv-batch-integrity.test.ts` |
| INV-M03 | Delete is blocked while `findReferences()` finds any usage; a confirmed delete moves to `_trash/` in one commit and restore is collision-guarded | `packages/core/src/media/__tests__/inv-referential-delete.test.ts` |
| INV-T04 | SVG uploads are rejected; existing SVGs render only via `<img src=blob:>`; zero inline repo `<svg>`, `<object>`, or `<embed>` | `packages/core/src/client/__tests__/client.test.ts`, `packages/core/src/safety/__tests__/inv-golden-xss.test.ts` |
| INV-N03 | Previews never read `raw.githubusercontent.com` — the domain is banned repo-wide and previews go through content-addressed blob reads | `packages/core/src/safety/__tests__/repo-bans.test.ts` |

> INV-T05 (EXIF strip + pre-decode dimension caps) was retired with `packages/admin` (P2 parity,
> 2026-11-01): the worker raster pipeline was reference-admin code, not SDK behaviour. The surviving
> upload guards are the 90 MiB cap, SVG refusal, and the empty-file refusal (all in
> `packages/core/src/client/media.ts`).
