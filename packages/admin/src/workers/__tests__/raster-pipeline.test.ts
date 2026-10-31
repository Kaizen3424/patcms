/**
 * Tests for the raster pipeline, binary header sniffer, decompression bomb guard,
 * SVG rejection, and filename sanitizer — ADR-0007 §2 (INV-T04, INV-T05).
 */

import { describe, expect, it } from "vitest"
import { MAX_FILE_SIZE, sanitizeFilename, sniffImageHeader } from "../header-sniffer"
import { normalizeImage, RasterProcessingError } from "../raster-client"

function createPngBytes(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(24)
  // Magic bytes: \x89PNG\r\n\x1a\n
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0)
  // IHDR length 13
  bytes.set([0x00, 0x00, 0x00, 0x0d], 8)
  // Chunk type 'IHDR'
  bytes.set([0x49, 0x48, 0x44, 0x52], 12)
  // Width & Height (32-bit big-endian)
  new DataView(bytes.buffer).setUint32(16, width, false)
  new DataView(bytes.buffer).setUint32(20, height, false)
  return bytes
}

function createJpegBytes(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(18)
  // SOI: 0xFF, 0xD8
  bytes.set([0xff, 0xd8], 0)
  // SOF0 marker: 0xFF, 0xC0
  bytes.set([0xff, 0xc0], 2)
  // Length: 11
  bytes.set([0x00, 0x0b], 4)
  // Precision: 8
  bytes[6] = 8
  // Height & Width (16-bit big-endian)
  new DataView(bytes.buffer).setUint16(7, height, false)
  new DataView(bytes.buffer).setUint16(9, width, false)
  // Components: 1
  bytes[11] = 1
  return bytes
}

function createWebpBytes(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(30)
  // 'RIFF'
  bytes.set([0x52, 0x49, 0x46, 0x46], 0)
  // Size: 22
  bytes.set([0x16, 0x00, 0x00, 0x00], 4)
  // 'WEBP'
  bytes.set([0x57, 0x45, 0x42, 0x50], 8)
  // 'VP8X'
  bytes.set([0x56, 0x50, 0x38, 0x58], 12)
  // Chunk size: 10
  bytes.set([0x0a, 0x00, 0x00, 0x00], 16)
  // Flags (4 bytes)
  bytes.set([0x00, 0x00, 0x00, 0x00], 20)
  // Canvas width - 1 (24-bit little endian)
  const w = width - 1
  bytes[24] = w & 0xff
  bytes[25] = (w >> 8) & 0xff
  bytes[26] = (w >> 16) & 0xff
  // Canvas height - 1 (24-bit little endian)
  const h = height - 1
  bytes[27] = h & 0xff
  bytes[28] = (h >> 8) & 0xff
  bytes[29] = (h >> 16) & 0xff
  return bytes
}

describe("Binary header dimension sniffer (INV-T05)", () => {
  it("sniffs dimensions from PNG binary headers", () => {
    const png = createPngBytes(1200, 800)
    const result = sniffImageHeader(png, "test.png", "image/png")
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.dimensions).toEqual({ width: 1200, height: 800, format: "png" })
    }
  })

  it("sniffs dimensions from JPEG binary headers", () => {
    const jpeg = createJpegBytes(1920, 1080)
    const result = sniffImageHeader(jpeg, "photo.jpg", "image/jpeg")
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.dimensions).toEqual({ width: 1920, height: 1080, format: "jpeg" })
    }
  })

  it("sniffs dimensions from WebP binary headers", () => {
    const webp = createWebpBytes(800, 600)
    const result = sniffImageHeader(webp, "graphic.webp", "image/webp")
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.dimensions).toEqual({ width: 800, height: 600, format: "webp" })
    }
  })

  it("rejects decompression bombs with dimensions exceeding 24M pixels", () => {
    // 50,000 x 50,000 = 2.5 Billion pixels
    const bombPng = createPngBytes(50000, 50000)
    const result = sniffImageHeader(bombPng, "bomb.png")
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe("DIMENSIONS_TOO_LARGE")
      expect(result.message).toMatch(/exceed the safe limit/)
    }
  })

  it("rejects images with a dimension exceeding 8192px", () => {
    const wideJpeg = createJpegBytes(8200, 100)
    const result = sniffImageHeader(wideJpeg, "panorama.jpg")
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe("DIMENSIONS_TOO_LARGE")
    }
  })

  it("rejects payloads exceeding the 15MB file size cap", () => {
    const oversized = new Uint8Array(MAX_FILE_SIZE + 1)
    const result = sniffImageHeader(oversized, "huge.png")
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe("FILE_TOO_LARGE")
      expect(result.message).toMatch(/exceeds the 15MB maximum/)
    }
  })

  it("rejects unparseable or corrupted formats", () => {
    const corrupted = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])
    const result = sniffImageHeader(corrupted, "corrupted.bin")
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe("UNSUPPORTED_FORMAT")
    }
  })
})

describe("SVG upload rejection (INV-T04)", () => {
  it("rejects files with .svg filename extension", () => {
    const svgBytes = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>')
    const result = sniffImageHeader(svgBytes, "icon.svg", "image/svg+xml")
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe("SVG_REJECTED")
      expect(result.message).toMatch(/SVG uploads are not permitted/)
    }
  })

  it("rejects disguised SVG files renamed to .png", () => {
    const disguisedBytes = new TextEncoder().encode(
      '<?xml version="1.0"?><svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="40"/></svg>',
    )
    const result = sniffImageHeader(disguisedBytes, "disguised-logo.png", "image/png")
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe("SVG_REJECTED")
    }
  })
})

describe("Visible filename sanitizer (ADR-0007 §2)", () => {
  it("strips diacritics, normalizes spaces and special characters, and appends webp", () => {
    expect(sanitizeFilename("écu bad & sample!.JPG")).toBe("ecu-bad-sample.webp")
    expect(sanitizeFilename("UPPERCASE_NAME.PNG")).toBe("uppercase_name.webp")
    expect(sanitizeFilename("product--photo---01.jpeg")).toBe("product-photo-01.webp")
    expect(sanitizeFilename("---leading-and-trailing---.png")).toBe("leading-and-trailing.webp")
  })

  it("handles empty or purely symbolic filenames with safe fallback", () => {
    expect(sanitizeFilename("!@#$%^.jpg")).toBe("image.webp")
  })
})

describe("normalizeImage client dispatcher", () => {
  it("processes a valid PNG and returns normalized metadata", async () => {
    const validPng = createPngBytes(1024, 768)
    const normalized = await normalizeImage({
      bytes: validPng,
      filename: "ring foto.png",
      mimeType: "image/png",
    })

    expect(normalized.ok).toBe(true)
    expect(normalized.sanitizedFilename).toBe("ring-foto.webp")
    expect(normalized.width).toBe(1024)
    expect(normalized.height).toBe(768)
  })

  it("throws RasterProcessingError when an SVG is uploaded", async () => {
    const svgBytes = new TextEncoder().encode("<svg></svg>")
    await expect(
      normalizeImage({ bytes: svgBytes, filename: "logo.svg", mimeType: "image/svg+xml" }),
    ).rejects.toThrow(RasterProcessingError)
  })
})
