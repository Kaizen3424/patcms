# ADR-0007 — Media: staged tiles, commit-with-entry, worker-based raster pipeline, budget guard

**Status:** Accepted · 2026-10-27

## Context
Genesis identified canvas manipulation thread-cost and the private-repo preview problem; panel rounds added: 9-photo café-wifi failure modes, commit spam (N uploads = N Cloudflare builds), orphan media poisoning transactional semantics, CDN-stale previews, and repo growth unheard.

## Decision
1. **Staging**: uploads become **tiles in the entry's draft record** (keyed alongside drafts, `INV-parked` semantics); NOTHING touches GitHub until the referencing entry saves. Save = **ONE tree commit** staging all blobs + entry JSON together ⇒ N photos = 1 build, atomic with the entry. Standalone library uploads (no referencing entry) commit alone via the same transactional primitive.
2. **Raster pipeline in a worker**: decode → `OffscreenCanvas` (worker context, UI responsive) → re-encode `image/webp|jpeg` (~400KB target) → **EXIF stripped by construction** (re-encode), orientation preserved via `imageOrientation:'from-image'`. Pre-caps: file ≤15MB, natural dims pre-check (decompression-bomb guard). SVG uploads rejected (ADR-0006). Filenames auto-sanitized showing the result ("écu-bad.jpg" → visible, not silent).
3. **Content-addressed dedupe**: client-side SHA-1 precompute skips `createBlob` when bytes unchanged.
4. **Previews**: `GET /git/blobs/{sha}` (base64 ≤100MB) cached keyed by **blob sha** — replace/rename produce new shas so staleness is impossible; `raw.githubusercontent.com` NEVER (TTL up to 24h + private-repo 404; standing veto). `URL.createObjectURL` revoked on teardown (genesis memory-leak note absorbed). >1MB reads routed via blobs (contents-API cap).
5. **Writes**: only via `safePath()`-validated repo-relative paths mapped through config (`public/images/**` ⇄ `/images/**`, per-collection overrides — bijection invariant INV-M01). Delete/rename in media requires `findReferences()` clearance (cross-collection + single-file docs); replace-in-place warns "returning visitors may see the old photo up to an hour" (honest CDN framing; auto-rename+usage-cascade = v2).
6. **Budget guard**: snapshot computes per-collection/total media sizes from the tree; warn ~800MB / 2500 images (GitHub: ~1GB warn, 5GB support-contact, 100MiB hard reject); client blocks >90MiB uploads.

## Consequences
Draft restore banner must state "recovered before your last save" so a reopened product doesn't read as if queued photos went live. No LFS in v1 (documented; repo budget guard is the compensation).
### P0 verification (2026-10-27)
- Backend seam already shaped for the media law: `FileWrite { path, bytes }` (bytes-only; the serializer owns encoding) + fixture media dirs (playground/fixtures/repo/public/images). Worker raster pipeline lands P4. No deviation.

### Phase 4 addendum — Media service, bijection, budget, and preview reads (2026-10-31)
1. **Path mapping bijection (INV-M01)**:
   - Root media config: `media: { folder: string, publicFolder: string }` (e.g. `public/images` ⇄ `/images`).
   - Collection overrides: `collection.media?: MediaFolders` (e.g. `public/images/products` ⇄ `/images/products`).
   - Resolution employs longest-prefix matching.
   - All mapping functions (`publicPathToRepoPath`, `repoPathToPublicPath`) enforce `safePath()`: public paths must be absolute (`/`), repo paths must be relative (no leading `/`), traversals (`..`), encoded separators (`%2f`, `%5c`), and backslashes are strictly rejected.
   - Bijection identity holds: `repoPathToPublicPath(publicPathToRepoPath(p)) === p`.
2. **Snapshot tree media budget math**:
   - `calculateMediaBudget(treeEntries, media)` walks recursive tree entries in $O(N)$ with zero network requests using `TreeEntryTuple.size`.
   - Thresholds: Warning surfaced when repository media total $\ge 800\text{MB}$ (`838,860,800` bytes) or total media count $\ge 2,500$ files.
   - Client upload block enforced on any single file $>90\text{MiB}$ (`94,371,840` bytes).
3. **Content-addressed preview reads (INV-N03)**:
   - Previews read through `GitBackend.readBlob(sha: string): Promise<Uint8Array>`.
   - Content-addressed by SHA-1 hash; zero dependence on branch names, paths, or `raw.githubusercontent.com`.
   - Previews use `URL.createObjectURL` with a ref-counted lifecycle calling `URL.revokeObjectURL` on zero subscribers or component unmount.
