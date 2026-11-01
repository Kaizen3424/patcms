/**
 * Login-time capability probe — INV-A03 partial (P1).
 *
 * Reads rate_limit + repo + protection-admin + check-runs. Checks-read may be
 * missing/forbidden without blocking login (advisory). The probe result is
 * returned to the caller and NEVER persisted (only the token may be stored).
 */

import type { CapabilityProbeResult, CapabilityStatus } from "../../auth/types"
import { CapabilityProbeError } from "../../auth/types"
import type { FetchLike, FetchResponseLike } from "../../composition"
import type { JsonValue } from "../../safety/untrusted-json"
import { parseUntrustedJson } from "../../safety/untrusted-json"

export interface GithubProbeOptions {
  readonly owner: string
  readonly repo: string
  readonly token: string
  readonly branch: string
  readonly fetch: FetchLike
  readonly baseUrl?: string
}

interface ProbeResponse {
  readonly status: number
  readonly headers: FetchResponseLike["headers"]
  readonly value: JsonValue | undefined
}

const DEFAULT_BASE_URL = "https://api.github.com"
const API_VERSION = "2022-11-28"

export async function probeGithubCapabilities(
  options: GithubProbeOptions,
): Promise<CapabilityProbeResult> {
  const base = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "")
  const repoUrl = `${base}/repos/${encodeURIComponent(options.owner)}/${encodeURIComponent(options.repo)}`
  const headers = {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${options.token}`,
    "X-GitHub-Api-Version": API_VERSION,
  }

  const rate = await request(`${base}/rate_limit`, headers, options.fetch)
  if (rate.status === 401)
    throw new CapabilityProbeError("AUTH_EXPIRED", "access key expired", { status: 401 })
  if (rate.status !== 200) {
    throw classify(rate, "could not read the access-key quota")
  }
  const rateLimit = parseRateLimit(rate)
  const quotaBlockedUntil = rateLimit?.remaining === 0 ? rateLimit.resetAt : undefined
  if (quotaBlockedUntil !== undefined) {
    throw new CapabilityProbeError("RATE_LIMIT", "GitHub quota is exhausted", {
      status: 403,
      resetAt: quotaBlockedUntil,
    })
  }

  const repo = await request(repoUrl, headers, options.fetch)
  if (repo.status === 401)
    throw new CapabilityProbeError("AUTH_EXPIRED", "access key expired", { status: 401 })
  if (repo.status === 404) {
    throw new CapabilityProbeError("NOT_FOUND", "repository not found or not visible to this key", {
      status: 404,
    })
  }
  if (repo.status === 403) throw classify(repo, "access key cannot read this repository")
  if (repo.status !== 200) throw classify(repo, "repository probe failed")

  const protectionUrl = `${repoUrl}/branches/${encodeBranch(options.branch)}/protection`
  const checksUrl = `${repoUrl}/commits/${encodeBranch(options.branch)}/check-runs?per_page=1`
  const [protection, checks] = await Promise.all([
    optionalRequest(protectionUrl, headers, options.fetch),
    optionalRequest(checksUrl, headers, options.fetch),
  ])
  for (const optional of [protection, checks]) {
    if (optional instanceof CapabilityProbeError && optional.code === "AUTH_EXPIRED") throw optional
    if (!(optional instanceof CapabilityProbeError) && optional.status === 401) {
      throw new CapabilityProbeError("AUTH_EXPIRED", "access key expired", { status: 401 })
    }
  }

  return {
    repo: "ok",
    protectionAdmin: statusForOptional(protection),
    checksRead: statusForOptional(checks),
    rateLimit,
    ...(quotaBlockedUntil === undefined ? {} : { quotaBlockedUntil }),
  }
}

async function request(
  url: string,
  headers: Record<string, string>,
  fetchLike: FetchLike,
): Promise<ProbeResponse> {
  let response: FetchResponseLike
  try {
    // Branch/repo-addressed and mutable (rate quota, repo visibility,
    // protection): bypass the browser HTTP cache so a reprobe cannot be
    // answered by a cached 200 for a since-revoked token.
    response = await fetchLike(url, { method: "GET", headers, cache: "no-store" })
  } catch (error) {
    throw new CapabilityProbeError(
      "NETWORK",
      error instanceof Error ? error.message : "network request failed",
    )
  }
  const text = await response.text()
  let value: JsonValue | undefined
  if (text.length > 0) {
    const parsed = parseUntrustedJson(text, { maxBytes: 2 * 1024 * 1024 })
    if (!parsed.ok) {
      throw new CapabilityProbeError("UNKNOWN", "GitHub returned an unreadable response", {
        status: response.status,
      })
    }
    value = parsed.value
  }
  return { status: response.status, headers: response.headers, value }
}

async function optionalRequest(
  url: string,
  headers: Record<string, string>,
  fetchLike: FetchLike,
): Promise<ProbeResponse | CapabilityProbeError> {
  try {
    return await request(url, headers, fetchLike)
  } catch (error) {
    if (error instanceof CapabilityProbeError && error.code === "AUTH_EXPIRED") throw error
    return error instanceof CapabilityProbeError
      ? error
      : new CapabilityProbeError("UNKNOWN", "optional capability probe failed")
  }
}

function statusForOptional(response: ProbeResponse | CapabilityProbeError): CapabilityStatus {
  if (response instanceof CapabilityProbeError) {
    return response.code === "AUTH_EXPIRED" || response.code === "RATE_LIMIT" ? "error" : "missing"
  }
  if (response.status === 200) return "ok"
  if (response.status === 404) return "missing"
  if (response.status === 403) return "forbidden"
  return "error"
}

function classify(response: ProbeResponse, message: string): CapabilityProbeError {
  const remaining = response.headers.get("x-ratelimit-remaining")
  const reset = response.headers.get("x-ratelimit-reset")
  if (response.status === 403 && remaining === "0") {
    return new CapabilityProbeError("RATE_LIMIT", "GitHub quota is exhausted", {
      status: 403,
      ...(reset === null ? {} : { resetAt: new Date(Number(reset) * 1000).toISOString() }),
    })
  }
  if (response.status === 403) {
    return new CapabilityProbeError("SCOPE", message, { status: 403 })
  }
  if (response.status === 429) {
    return new CapabilityProbeError("RATE_LIMIT", message, { status: 429 })
  }
  return new CapabilityProbeError("UNKNOWN", message, { status: response.status })
}

function parseRateLimit(response: ProbeResponse): CapabilityProbeResult["rateLimit"] {
  const record = asRecord(response.value)
  const resources = asRecord(record?.resources)
  const core = asRecord(resources?.core) ?? asRecord(record?.rate)
  if (core === undefined) return null
  const limit = numberValue(core.limit)
  const remaining = numberValue(core.remaining)
  const reset = numberValue(core.reset)
  if (limit === undefined || remaining === undefined || reset === undefined) return null
  return { limit, remaining, resetAt: new Date(reset * 1000).toISOString() }
}

function asRecord(value: JsonValue | undefined): Record<string, JsonValue> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined
  return value as Record<string, JsonValue>
}

function numberValue(value: JsonValue | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function encodeBranch(branch: string): string {
  return branch
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/")
}
