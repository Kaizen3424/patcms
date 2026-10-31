/**
 * Raster pipeline worker protocol and error codes — ADR-0007 §2 (INV-T04, INV-T05).
 */

export type RasterErrorCode =
  | "FILE_TOO_LARGE" // > 15MB
  | "SVG_REJECTED" // INV-T04: SVG uploads strictly prohibited in v1
  | "DIMENSIONS_TOO_LARGE" // Decompression bomb defense: > 24M pixels or > 8192px
  | "UNSUPPORTED_FORMAT" // Unrecognized or corrupted image format
  | "ENCODE_FAILED"

export interface RasterWorkerRequest {
  readonly id: string
  readonly bytes: Uint8Array
  readonly filename: string
  readonly mimeType?: string
  readonly targetBytes?: number // Target size, defaults to 400KB (409,600 bytes)
}

export interface RasterSuccessPayload {
  readonly id: string
  readonly ok: true
  readonly bytes: Uint8Array
  readonly mimeType: "image/webp" | "image/jpeg"
  readonly sanitizedFilename: string
  readonly width: number
  readonly height: number
  readonly originalBytes: number
  readonly finalBytes: number
}

export interface RasterFailurePayload {
  readonly id: string
  readonly ok: false
  readonly error: {
    readonly code: RasterErrorCode
    readonly message: string
  }
}

export type RasterWorkerResponse = RasterSuccessPayload | RasterFailurePayload
