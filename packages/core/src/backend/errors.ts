/**
 * Typed read errors (ADR-0005 P1 addendum). The admin maps these codes to
 * human prose; the transport never leaks response bodies or tokens.
 */
export type ReadErrorCode =
  | "AUTH_EXPIRED"
  | "SCOPE"
  | "NOT_FOUND" /**
   * The repository has ZERO commits (a fresh repo has no branch to read).
   * GitHub answers every branch-addressed read with 409 + a body line this
   * code stands for; readers must treat it as "no content", never UNKNOWN.
   */
  | "EMPTY_REPO"
  | "RATE_LIMIT"
  | "NETWORK"
  | "TREE_TRUNCATED"
  | "UNKNOWN"

export class BackendReadError extends Error {
  override readonly name = "BackendReadError"
  readonly code: ReadErrorCode
  readonly status?: number
  readonly retryAfter?: string
  /** X-RateLimit-Reset epoch seconds (primary exhaustion → reset countdown, INV-N01). */
  readonly resetAt?: string

  constructor(
    code: ReadErrorCode,
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

export function isBackendReadError(error: unknown): error is BackendReadError {
  return error instanceof BackendReadError
}

/**
 * Gotcha (bit for real): GitHub returns **409** — not 404 — on every
 * branch-addressed read of a repository with zero commits, and other 409s
 * exist, so the STATUS ALONE cannot classify it. The response body carries the
 * discriminator line (matched case-insensitively, never surfaced verbatim).
 */
export const EMPTY_REPO_BODY_SIGNATURE = /git repository is empty/i

export function isEmptyRepoError(error: unknown): error is BackendReadError {
  return error instanceof BackendReadError && error.code === "EMPTY_REPO"
}
