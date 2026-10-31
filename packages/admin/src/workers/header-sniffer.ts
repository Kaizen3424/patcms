/**
 * Binary header dimension sniffer and decompression bomb guard — ADR-0007 §2 (INV-T04, INV-T05).
 *
 * Inspects raw bytes to extract image dimensions from JPEG, PNG, and WebP files
 * BEFORE bitmap decoding, preventing decompression bombs from exhausting browser memory.
 *
 * Pure TypeScript, zero DOM/Canvas dependencies — runs safely in both Web Workers and Node.
 */

import type { RasterErrorCode } from "./raster-types"

export const MAX_FILE_SIZE = 15 * 1024 * 1024 // 15MB
export const MAX_PIXELS = 24_000_000 // 24 Megapixels (~4898 x 4898)
export const MAX_DIMENSION = 8_192 // 8192px max width or height

export interface ImageDimensions {
  readonly width: number
  readonly height: number
  readonly format: "jpeg" | "png" | "webp"
}

export type SniffResult =
  | { readonly ok: true; readonly dimensions: ImageDimensions }
  | { readonly ok: false; readonly code: RasterErrorCode; readonly message: string }

/**
 * Sniffs image format and natural dimensions from binary headers.
 */
export function sniffImageHeader(
  bytes: Uint8Array,
  filename?: string,
  mimeType?: string,
): SniffResult {
  // 1. Check file size cap
  if (bytes.byteLength > MAX_FILE_SIZE) {
    return {
      ok: false,
      code: "FILE_TOO_LARGE",
      message: `File size (${(bytes.byteLength / (1024 * 1024)).toFixed(1)}MB) exceeds the 15MB maximum.`,
    }
  }

  // 2. Reject SVGs explicitly (INV-T04)
  if (isSvg(bytes, filename, mimeType)) {
    return {
      ok: false,
      code: "SVG_REJECTED",
      message: "SVG uploads are not permitted. Please upload WebP, PNG, or JPEG files.",
    }
  }

  // 3. Inspect headers by format
  let dims: ImageDimensions | undefined

  if (isPng(bytes)) {
    dims = parsePngDimensions(bytes)
  } else if (isJpeg(bytes)) {
    dims = parseJpegDimensions(bytes)
  } else if (isWebp(bytes)) {
    dims = parseWebpDimensions(bytes)
  }

  if (dims === undefined) {
    return {
      ok: false,
      code: "UNSUPPORTED_FORMAT",
      message: "The uploaded file is not a supported raster image (JPEG, PNG, or WebP).",
    }
  }

  // 4. Decompression bomb guard
  const totalPixels = dims.width * dims.height
  if (totalPixels > MAX_PIXELS || dims.width > MAX_DIMENSION || dims.height > MAX_DIMENSION) {
    return {
      ok: false,
      code: "DIMENSIONS_TOO_LARGE",
      message: `Image dimensions (${dims.width} × ${dims.height}) exceed the safe limit (${MAX_DIMENSION}px).`,
    }
  }

  return { ok: true, dimensions: dims }
}

/**
 * Detects whether the payload represents an SVG file (by filename, MIME, or magic bytes).
 */
export function isSvg(bytes: Uint8Array, filename?: string, mimeType?: string): boolean {
  if (filename !== undefined && /\.svg$/i.test(filename.trim())) {
    return true
  }
  if (mimeType?.toLowerCase().includes("svg")) {
    return true
  }
  // Sniff leading magic bytes (up to 512 bytes)
  const header = new TextDecoder().decode(bytes.subarray(0, Math.min(bytes.length, 512))).trim()
  return (
    header.startsWith("<svg") ||
    header.includes("<svg") ||
    (header.startsWith("<?xml") && header.includes("<svg"))
  )
}

function isPng(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  )
}

function parsePngDimensions(bytes: Uint8Array): ImageDimensions | undefined {
  if (bytes.length < 24) return undefined
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const width = view.getUint32(16, false)
  const height = view.getUint32(20, false)
  if (width === 0 || height === 0) return undefined
  return { width, height, format: "png" }
}

function isJpeg(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8
}

function parseJpegDimensions(bytes: Uint8Array): ImageDimensions | undefined {
  let offset = 2
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)

  while (offset < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1
      continue
    }

    const marker = bytes[offset + 1]
    if (marker === undefined) break

    // Variable length marker
    if (
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf)
    ) {
      if (offset + 9 > bytes.length) return undefined
      const height = view.getUint16(offset + 5, false)
      const width = view.getUint16(offset + 7, false)
      if (width === 0 || height === 0) return undefined
      return { width, height, format: "jpeg" }
    }

    // Skip to next segment
    if (offset + 4 > bytes.length) break
    const segmentLength = view.getUint16(offset + 2, false)
    offset += 2 + segmentLength
  }

  return undefined
}

function isWebp(bytes: Uint8Array): boolean {
  if (bytes.length < 12) return false
  const riff = String.fromCharCode(...bytes.subarray(0, 4))
  const webp = String.fromCharCode(...bytes.subarray(8, 12))
  return riff === "RIFF" && webp === "WEBP"
}

function parseWebpDimensions(bytes: Uint8Array): ImageDimensions | undefined {
  if (bytes.length < 30) return undefined
  const chunkType = String.fromCharCode(...bytes.subarray(12, 16))
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)

  if (chunkType === "VP8 ") {
    // Lossy WebP: frame tag at offset 23
    const width = view.getUint16(26, true) & 0x3fff
    const height = view.getUint16(28, true) & 0x3fff
    if (width === 0 || height === 0) return undefined
    return { width, height, format: "webp" }
  }

  if (chunkType === "VP8L") {
    // Lossless WebP
    if (bytes[20] !== 0x2f) return undefined
    const b0 = bytes[21] ?? 0
    const b1 = bytes[22] ?? 0
    const b2 = bytes[23] ?? 0
    const b3 = bytes[24] ?? 0
    const width = 1 + (((b1 & 0x3f) << 8) | b0)
    const height = 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6))
    return { width, height, format: "webp" }
  }

  if (chunkType === "VP8X") {
    // Extended WebP: 24-bit width at bytes 24-26, height at bytes 27-29
    const width = 1 + ((bytes[24] ?? 0) | ((bytes[25] ?? 0) << 8) | ((bytes[26] ?? 0) << 16))
    const height = 1 + ((bytes[27] ?? 0) | ((bytes[28] ?? 0) << 8) | ((bytes[29] ?? 0) << 16))
    return { width, height, format: "webp" }
  }

  return undefined
}

/**
 * Sanitizes a raw uploaded filename visibly (ADR-0007 §2).
 *
 * Example:
 *   "écu bad & sample!.JPG" -> "ecu-bad-sample.webp"
 */
export function sanitizeFilename(filename: string, targetExt = "webp"): string {
  const withoutExt = filename.replace(/\.[^/.]+$/, "")
  const normalized = withoutExt
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // Strip diacritics
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-") // Convert non-alphanumeric to hyphen
    .replace(/-+/g, "-") // Collapse consecutive hyphens
    .replace(/^-|-$/g, "") // Trim hyphens

  const base = normalized.length > 0 ? normalized : "image"
  const ext = targetExt.startsWith(".") ? targetExt.slice(1) : targetExt
  return `${base}.${ext}`
}
