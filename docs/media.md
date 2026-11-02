# Media

## The bijection

Every image lives at a **repo path** (`public/images/…`) and is referenced by a **public path**
(`/images/…`). The mapping comes from config and is bijective — writing one where the other
belongs produces a broken image no type checker catches.

```ts
import { defineConfig } from "patcms"

export const config = defineConfig({
  // Root media mapping: repo folder ⇄ public URL path.
  media: { folder: "public/images", publicFolder: "/images" },
  collections: [],
})
```

A collection may override it (`media: { folder: "public/destinations", publicFolder: "/destinations" }`).
The client resolves the override for you when you pass `collection` to media calls; two pure
helpers do the conversion when you need it yourself:

```ts
import type { CMS } from "patcms"

declare const cms: CMS // constructed as in getting-started.md

cms.media.repoPath("/images/hero.jpg")    // "public/images/hero.jpg"
cms.media.publicPath("public/images/hero.jpg") // "/images/hero.jpg"
// Throws CMSError (VALIDATION) for paths outside the configured folders.
```

A stored image **value** in an entry is always the public path (`/images/...`) — that is what the
`image` field validates and what your site renders.

## Uploading

```ts
import { isCMSError } from "patcms"
import type { CMS } from "patcms"

declare const cms: CMS // constructed as in getting-started.md
declare const bytes: Uint8Array // e.g. await file.arrayBuffer() → new Uint8Array(...)

try {
  const file = await cms.media.upload({ name: "kyoto-garden.jpg", bytes })
  console.log(file.publicPath) // "/images/kyoto-garden.jpg" — store this in an image field
} catch (error) {
  if (isCMSError(error) && error.code === "CONFLICT") {
    // The path already exists. Confirm with the user, then:
    await cms.media.upload({ name: "kyoto-garden.jpg", bytes }, { overwrite: true })
  }
}
```

| Guard | Refusal | Override |
|---|---|---|
| Empty file | `CMSError` `VALIDATION` | — |
| Larger than 90 MiB | `CMSError` `VALIDATION` | — |
| `.svg` extension | `CMSError` `VALIDATION` (SVG is executable in a browser context) | `allowSvg: true` |
| Path already exists | `CMSError` `CONFLICT` | `overwrite: true` |

Filenames are sanitised before they reach the repo: Unicode normalisation, control characters
stripped, `<>:"|?*` and whitespace become `-`, trimmed, capped at 120 characters; extension and
case are preserved.

There is **no raster processing in the SDK** — no resizing, no EXIF stripping. If your product
needs normalised images, transform them host-side before calling `upload`. Batch uploads that must
land together with an entry in one commit go through the advanced batch save (see
[advanced.md](./advanced.md)).

## Listing and reading

```ts
import type { CMS } from "patcms"

declare const cms: CMS // constructed as in getting-started.md

// All live media across the root folder and every per-collection folder:
const files = await cms.media.list()

// Scoped to one collection's media folder:
const scoped = await cms.media.list({ collection: "destinations" })

// Trash tab: tombstones instead of live files. `path` is the tombstone repo
// path (pass it to restore()); `publicPath` is where the file would restore to.
const trash = await cms.media.list({ includeTrash: true })

// Bytes for a preview (git blob API — see "Previews" below):
const blob = await cms.media.get("/images/kyoto-garden.jpg")
// blob.bytes: Uint8Array, blob.type: MIME from the extension (best effort)
```

## Previews

Previews read the **git blob API** (`media.get`) and turn bytes into object URLs.
`raw.githubusercontent.com` is never used — it would leave the token-scoped API surface.

The pattern from the example panel: one object URL per blob sha, minted lazily, revoked when the
view unmounts, invalidated after any write:

```ts
import type { CMS } from "patcms"

declare const cms: CMS // constructed as in getting-started.md

const cache = new Map<string, string>()

async function previewUrl(publicPath: string): Promise<string> {
  const cached = cache.get(publicPath)
  if (cached) return cached
  const blob = await cms.media.get(publicPath)
  const url = URL.createObjectURL(new Blob([blob.bytes as BlobPart], { type: blob.type }))
  cache.set(publicPath, url)
  return url
}

function disposePreviews(): void {
  for (const url of cache.values()) URL.revokeObjectURL(url)
  cache.clear()
}
```

Call `disposePreviews()` when your media view unmounts, and clear the cache entry after
upload/delete so the next preview re-reads fresh bytes.

## Deleting: references, trash, restore

```ts
import type { CMS } from "patcms"

declare const cms: CMS // constructed as in getting-started.md

const result = await cms.media.delete("/images/kyoto-garden.jpg")
if (result.status === "referenced") {
  // Reference check ran first (default). Show who uses it:
  for (const ref of result.references) {
    console.log(ref.collection, ref.slug, ref.fieldPath, ref.title, ref.altText)
  }
  // Business decision: block, or force past the guard:
  await cms.media.delete("/images/kyoto-garden.jpg", { checkReferences: false })
} else {
  console.log(result.commitSha) // one commit: file moved to _trash/
}
```

- A confirmed delete is a **tombstone**: the file moves to `_trash/…` in one commit. Nothing is
  hard-deleted.
- Restore moves it back, collision-guarded — an occupied destination is a `CONFLICT`, by design:

```ts continue
const restored = await cms.media.restore("_trash/public/images/kyoto-garden.jpg")
console.log(restored.publicPath) // "/images/kyoto-garden.jpg"
```

## Budget

The SDK computes repo media budget from the tree (advanced export `calculateMediaBudget`):
warn at roughly 800 MB or 2 500 files; the 90 MiB single-upload cap is enforced client-side
(`isUploadSizeBlocked`, also exported). There is no LFS support in v1.

## Failure modes worth knowing

| Symptom | Cause |
|---|---|
| Old image still served after `overwrite: true` | CDN cache, not a failed save. Prefer delete + re-upload for a fresh path |
| Upload rejected instantly | A guard above (size, SVG, empty) — before any network call |
| Delete button should be disabled | `media.references()` returned locations; name them in the UI |
| Restore refuses | Target path is occupied — by design |

## Where to next

- [building-an-admin.md](./building-an-admin.md) — the media screen and image widget in the panel
- `specs/media-architecture.md` — why the bijection and the trash ladder are shaped this way
