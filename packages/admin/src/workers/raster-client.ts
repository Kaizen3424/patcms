/**
 * Raster pipeline client dispatcher — ADR-0007 §2.
 *
 * Spawns and communicates with `raster.worker.ts` in browser environments.
 * Provides fallback in-process sniffing for headless/test environments where
 * Web Workers or OffscreenCanvas are unavailable.
 */

import { sanitizeFilename, sniffImageHeader } from "./header-sniffer"
import type {
  RasterFailurePayload,
  RasterSuccessPayload,
  RasterWorkerRequest,
  RasterWorkerResponse,
} from "./raster-types"

export class RasterProcessingError extends Error {
  readonly code: RasterFailurePayload["error"]["code"]

  constructor(code: RasterFailurePayload["error"]["code"], message: string) {
    super(message)
    this.name = "RasterProcessingError"
    this.code = code
  }
}

let workerInstance: Worker | undefined

function getWorker(): Worker | undefined {
  if (typeof window === "undefined" || typeof Worker === "undefined") {
    return undefined
  }
  if (!workerInstance) {
    try {
      workerInstance = new Worker(new URL("./raster.worker.ts", import.meta.url), {
        type: "module",
      })
    } catch {
      workerInstance = undefined
    }
  }
  return workerInstance
}

export interface ImageInput {
  readonly bytes: Uint8Array
  readonly filename: string
  readonly mimeType?: string
}

/**
 * Normalizes an uploaded image file via the raster pipeline worker.
 */
export async function normalizeImage(input: File | ImageInput): Promise<RasterSuccessPayload> {
  const bytes = input instanceof File ? new Uint8Array(await input.arrayBuffer()) : input.bytes
  const filename = input instanceof File ? input.name : input.filename
  const mimeType = input instanceof File ? input.type : input.mimeType

  const worker = getWorker()

  // In-process fallback when Worker / OffscreenCanvas is not present (e.g. Node tests / jsdom)
  if (!worker || typeof OffscreenCanvas === "undefined") {
    const sniff = sniffImageHeader(bytes, filename, mimeType)
    if (!sniff.ok) {
      throw new RasterProcessingError(sniff.code, sniff.message)
    }

    const sanitizedFilename = sanitizeFilename(filename, "webp")
    return {
      id: "fallback",
      ok: true,
      bytes,
      mimeType: "image/webp",
      sanitizedFilename,
      width: sniff.dimensions.width,
      height: sniff.dimensions.height,
      originalBytes: bytes.byteLength,
      finalBytes: bytes.byteLength,
    }
  }

  const id = `raster-${Math.random().toString(36).slice(2)}`

  return new Promise<RasterSuccessPayload>((resolve, reject) => {
    const handler = (event: MessageEvent<RasterWorkerResponse>) => {
      if (event.data.id !== id) return
      worker.removeEventListener("message", handler)

      if (event.data.ok) {
        resolve(event.data)
      } else {
        reject(new RasterProcessingError(event.data.error.code, event.data.error.message))
      }
    }

    worker.addEventListener("message", handler)
    const request: RasterWorkerRequest = {
      id,
      bytes,
      filename,
      mimeType,
    }
    worker.postMessage(request, [bytes.buffer])
  })
}
