/**
 * Typed write errors (ADR-0005 P2 addendum). Status + body-CLASS mapping only:
 * response bodies never leak into messages (read-path precedent), and the admin
 * message map — never inline prose — renders founder-friendly screens (INV-A02).
 */

export type WriteErrorCode =
  /** FF guard tripped: ref moved / update is not a fast forward (INV-P01). */
  | "CAS_CONFLICT"
  /** Other 422 class: oversize tree, missing blob sha, malformed parents… */
  | "VALIDATION"
  | "AUTH_EXPIRED"
  | "SCOPE"
  | "NOT_FOUND"
  /**
   * Ref read said the repository has ZERO commits; the save path bootstraps
   * the root commit + branch instead (ADR-0011). Never surfaces as UNKNOWN.
   */
  | "EMPTY_REPO"
  | "RATE_LIMIT"
  | "NETWORK"
  | "TREE_TRUNCATED"
  | "UNKNOWN"

export class BackendWriteError extends Error {
  override readonly name = "BackendWriteError"
  readonly code: WriteErrorCode
  readonly status?: number
  /** Retry-After seconds/header value carried verbatim for the rate policy. */
  readonly retryAfter?: string
  /** X-RateLimit-Reset epoch seconds (primary exhaustion → reset countdown, INV-N01). */
  readonly resetAt?: string

  constructor(
    code: WriteErrorCode,
    message: string,
    options: { status?: number; retryAfter?: string; resetAt?: string } = {},
  ) {
    super(message)
    this.code = code
    this.status = options.status
    this.retryAfter = options.retryAfter
    this.resetAt = options.resetAt
  }
}

export function isBackendWriteError(error: unknown): error is BackendWriteError {
  return error instanceof BackendWriteError
}

/** Supplementary facts the classifier may consult (headers accessor-shaped). */
export interface WriteFailureHints {
  readonly status: number
  readonly headers: { get(name: string): string | null }
  /** Response body text — INSPECTED for error-class keywords only, never stored. */
  readonly bodyText: string
}

const FAST_FORWARD_HINTS: readonly string[] = [
  "fast forward",
  "fast-forward",
  "was expected",
  "is not at",
  "ref update",
  /**
   * A CREATE-ref collision (someone bootstrapped the branch first — the CAS
   * premise "repository is empty" just became false). Same CAS law: the loser
   * gets a typed conflict and never force-pushes (ADR-0011).
   */
  "already exists",
]

function isFastForwardBody(bodyText: string): boolean {
  const lowered = bodyText.toLowerCase()
  return FAST_FORWARD_HINTS.some((hint) => lowered.includes(hint))
}

/**
 * transport-failure → typed BackendWriteError classification (ADR-0005 P2).
 * The caller has already read the body ONCE (single response consumption);
 * this function reads no network state.
 */
export function classifyWriteResponse(hints: WriteFailureHints): BackendWriteError {
  const { status, headers } = hints
  const retryAfter = headers.get("retry-after") ?? undefined
  const remaining = headers.get("x-ratelimit-remaining")
  const resetAt = headers.get("x-ratelimit-reset") ?? undefined
  const rateExhausted = remaining === "0" || retryAfter !== undefined || resetAt !== undefined

  if (status === 401) {
    return new BackendWriteError("AUTH_EXPIRED", "GitHub rejected the write token (401)", {
      status,
    })
  }
  if (status === 403) {
    if (rateExhausted) {
      return new BackendWriteError("RATE_LIMIT", "GitHub rate limit reached for writes (403)", {
        status,
        ...(retryAfter === undefined ? {} : { retryAfter }),
        ...(resetAt === undefined ? {} : { resetAt }),
      })
    }
    return new BackendWriteError("SCOPE", "GitHub token lacks a write scope (403)", { status })
  }
  if (status === 429) {
    return new BackendWriteError("RATE_LIMIT", "GitHub rate limit reached (429)", {
      status,
      ...(retryAfter === undefined ? {} : { retryAfter }),
      ...(resetAt === undefined ? {} : { resetAt }),
    })
  }
  if (status === 404) {
    return new BackendWriteError("NOT_FOUND", "GitHub write target not found (404)", { status })
  }
  // GitHub flags non-fast-forward ref updates with 422 (sometimes 409), and
  // ref-creates that collide with an existing ref ("already exists"); body
  // class disambiguates CAS conflicts from transport validation failures.
  if (status === 422 || status === 409) {
    if (isFastForwardBody(hints.bodyText)) {
      return new BackendWriteError(
        "CAS_CONFLICT",
        `GitHub refused the fast-forward guard (422 class)`,
        { status },
      )
    }
    return new BackendWriteError("VALIDATION", "GitHub rejected the write payload (422 class)", {
      status,
    })
  }
  return new BackendWriteError("UNKNOWN", `GitHub write request failed (${status})`, { status })
}

/** Network-layer failure → typed error (fetch threw / response dropped). */
export function networkWriteError(cause: unknown): BackendWriteError {
  return new BackendWriteError(
    "NETWORK",
    cause instanceof Error ? cause.message : "network write failed",
  )
}

/** Recovery classification for unknown outcomes (INV-P09 vocabulary). */
export type ReverifyOutcome = "done" | "rebuild" | "conflict"
