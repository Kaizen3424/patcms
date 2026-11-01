/**
 * Media preview URLs. Previews must come from the git blob API
 * (`media.get`), never from raw.githubusercontent.com, so every image the
 * panel shows is an object URL minted from fetched bytes. The cache revokes
 * every URL it minted when the screen unmounts.
 */

import type { CMS } from "patcms"

export class MediaPreviewCache {
  readonly #cms: CMS
  readonly #urls = new Map<string, string>()

  constructor(cms: CMS) {
    this.#cms = cms
  }

  /** Object URL for a live media public path, or undefined when it cannot load. */
  async url(publicPath: string): Promise<string | undefined> {
    const cached = this.#urls.get(publicPath)
    if (cached !== undefined) return cached
    try {
      const blob = await this.#cms.media.get(publicPath)
      // Uint8Array<ArrayBufferLike> vs BlobPart: the bytes are plain ArrayBuffer
      // backed (blob API responses); the cast bridges the lib generic.
      const part = blob.bytes as unknown as BlobPart
      const url = URL.createObjectURL(new Blob([part], { type: blob.type }))
      this.#urls.set(publicPath, url)
      return url
    } catch {
      return undefined
    }
  }

  /** Drops the cached URL for a path (after upload/replace/delete). */
  invalidate(publicPath: string): void {
    const url = this.#urls.get(publicPath)
    if (url !== undefined) {
      URL.revokeObjectURL(url)
      this.#urls.delete(publicPath)
    }
  }

  dispose(): void {
    for (const url of this.#urls.values()) URL.revokeObjectURL(url)
    this.#urls.clear()
  }
}
