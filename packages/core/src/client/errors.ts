/**
 * One error type for every expected operational failure.
 *
 * Rules: a save conflict is a VALUE, not an exception; a validation failure is
 * a value from `entries.validate` but an exception from `entries.save`; no
 * message ever contains a token; the original backend error rides on `cause`.
 */

import { CapabilityProbeError } from "../auth/types"
import { isBackendReadError } from "../backend/errors"
import { isBackendWriteError } from "../backend/write-errors"
import type { ParseIssue } from "../fields/parse"

export type CMSErrorCode =
  | "AUTH_REQUIRED"
  | "AUTH_EXPIRED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "RATE_LIMIT"
  | "NETWORK"
  | "VALIDATION"
  | "UNSUPPORTED"
  | "INVALID_CONFIG"
  | "UNKNOWN"

export interface CMSErrorOptions {
  readonly status?: number
  /** ISO timestamp (or GitHub's raw reset value) for a rate-limited retry. */
  readonly retryAt?: string
  readonly issues?: readonly ParseIssue[]
  readonly cause?: unknown
}

export class CMSError extends Error {
  override readonly name = "CMSError"
  readonly code: CMSErrorCode
  readonly status: number | undefined
  readonly retryAt: string | undefined
  readonly issues: readonly ParseIssue[] | undefined

  constructor(code: CMSErrorCode, message: string, options: CMSErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause })
    this.code = code
    this.status = options.status
    this.retryAt = options.retryAt
    this.issues = options.issues
  }
}

export function isCMSError(value: unknown): value is CMSError {
  return value instanceof CMSError
}

/** Normalises anything thrown inside the client into a `CMSError`. */
export function toCMSError(error: unknown): CMSError {
  if (error instanceof CMSError) return error

  if (isBackendWriteError(error) || isBackendReadError(error)) {
    return new CMSError(mapBackendCode(error.code), error.message, {
      ...(error.status === undefined ? {} : { status: error.status }),
      ...(error.resetAt === undefined ? {} : { retryAt: error.resetAt }),
      cause: error,
    })
  }

  if (error instanceof CapabilityProbeError) {
    return new CMSError(mapBackendCode(error.code), error.message, {
      ...(error.status === undefined ? {} : { status: error.status }),
      ...(error.resetAt === undefined ? {} : { retryAt: error.resetAt }),
      cause: error,
    })
  }

  if (error instanceof Error) {
    return new CMSError("UNKNOWN", error.message, { cause: error })
  }

  return new CMSError("UNKNOWN", "unknown error", { cause: error })
}

function mapBackendCode(code: string): CMSErrorCode {
  switch (code) {
    case "AUTH_EXPIRED":
      return "AUTH_EXPIRED"
    case "SCOPE":
      return "FORBIDDEN"
    case "NOT_FOUND":
      return "NOT_FOUND"
    case "RATE_LIMIT":
      return "RATE_LIMIT"
    case "NETWORK":
      return "NETWORK"
    case "VALIDATION":
      return "VALIDATION"
    case "CAS_CONFLICT":
      return "CONFLICT"
    default:
      return "UNKNOWN"
  }
}
