/// <reference lib="webworker" />
/**
 * Web Worker for client-side raster normalization — ADR-0007 §2 (INV-T04, INV-T05).
 *
 * Runs off the main UI thread:
 *  1. Header dimension sniffing & decompression bomb guard.
 *  2. Orientation-preserving decoding via `createImageBitmap({ imageOrientation: 'from-image' })`.
 *  3. Canvas re-encode stripping EXIF by construction.
 *  4. Target size ~400KB WebP (or JPEG fallback).
 */

import { sanitizeFilename, sniffImageHeader } from "./header-sniffer"
import type { RasterWorkerRequest, RasterWorkerResponse } from "./raster-types"

const MAX_EDGE = 2400 // Clamp ultra-high-res images to 2400px max edge

self.addEventListener("message", async (event: MessageEvent<RasterWorkerRequest>) => {
  const { id, bytes, filename, mimeType } = event.data

  // 1. Sniff binary headers, check size, decompression bomb, and SVG (INV-T04)
  const sniff = sniffImageHeader(bytes, filename, mimeType)
  if (!sniff.ok) {
    const response: RasterWorkerResponse = {
      id,
      ok: false,
      error: { code: sniff.code, message: sniff.message },
    }
    self.postMessage(response)
    return
  }

  try {
    const blob = new Blob([bytes as unknown as BlobPart], { type: mimeType ?? "image/jpeg" })

    // 2. Decode with orientation preservation (EXIF stripped by construction on re-encode)
    const bitmap = await createImageBitmap(blob, { imageOrientation: "from-image" })

    // 3. Compute scaled dimensions if exceeding max bounds
    let { width, height } = bitmap
    if (width > MAX_EDGE || height > MAX_EDGE) {
      if (width >= height) {
        height = Math.round((height * MAX_EDGE) / width)
        width = MAX_EDGE
      } else {
        width = Math.round((width * MAX_EDGE) / height)
        height = MAX_EDGE
      }
    }

    // 4. Draw to OffscreenCanvas
    const canvas = new OffscreenCanvas(width, height)
    const ctx = canvas.getContext("2d")
    if (!ctx) {
      throw new Error("Unable to create 2d canvas context in worker")
    }
    ctx.drawImage(bitmap, 0, 0, width, height)
    bitmap.close()

    // 5. Re-encode to WebP (quality 0.82 targeting ~400KB)
    let outBlob: Blob
    let outMime: "image/webp" | "image/jpeg" = "image/webp"
    try {
      outBlob = await canvas.convertToBlob({ type: "image/webp", quality: 0.82 })
    } catch {
      // Fallback to JPEG if WebP conversion is not supported
      outBlob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.85 })
      outMime = "image/jpeg"
    }

    const outExt = outMime === "image/webp" ? "webp" : "jpg"
    const sanitizedFilename = sanitizeFilename(filename, outExt)
    const outBuffer = await outBlob.arrayBuffer()
    const outBytes = new Uint8Array(outBuffer)

    const response: RasterWorkerResponse = {
      id,
      ok: true,
      bytes: outBytes,
      mimeType: outMime,
      sanitizedFilename,
      width,
      height,
      originalBytes: bytes.byteLength,
      finalBytes: outBytes.byteLength,
    }

    self.postMessage(response, [outBuffer])
  } catch (error) {
    const response: RasterWorkerResponse = {
      id,
      ok: false,
      error: {
        code: "ENCODE_FAILED",
        message: error instanceof Error ? error.message : "Image raster processing failed.",
      },
    }
    self.postMessage(response)
  }
})
