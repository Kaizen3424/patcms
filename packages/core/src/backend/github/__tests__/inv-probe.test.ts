import { describe, expect, it } from "vitest"
import { CapabilityProbeError } from "../../../auth/types"
import type { FetchLike, FetchRequestInitLike, FetchResponseLike } from "../../../composition"
import { probeGithubCapabilities } from "../probe"

const TOKEN = "github_pat_probe_secret"
const OWNER = "owner"
const REPO = "repo"
const BRANCH = "feature/a+b"

interface Call {
  readonly url: string
  readonly init: FetchRequestInitLike | undefined
}

function response(
  status: number,
  body: unknown = {},
  headers: Record<string, string> = {},
): FetchResponseLike {
  const text = typeof body === "string" ? body : JSON.stringify(body)
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: "probe",
    headers: {
      get(name: string) {
        return headers[name.toLowerCase()] ?? null
      },
    },
    json: async () => JSON.parse(text),
    text: async () => text,
  }
}

function probeFetch(handler: (url: string) => FetchResponseLike) {
  const calls: Call[] = []
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, init })
    return handler(url)
  }
  return { fetch, calls }
}

function options(fetch: FetchLike) {
  return { owner: OWNER, repo: REPO, token: TOKEN, branch: BRANCH, fetch }
}

describe("probeGithubCapabilities (INV-A03 partial)", () => {
  it("probes all four capabilities and keeps the token out of URLs", async () => {
    const { fetch, calls } = probeFetch((url) => {
      if (url.endsWith("/rate_limit")) {
        return response(200, {
          resources: { core: { limit: 5000, remaining: 4999, reset: 1_800_000_000 } },
        })
      }
      if (url.endsWith(`/repos/${OWNER}/${REPO}`)) return response(200, { private: true })
      if (url.includes("/branches/")) return response(200, {})
      if (url.includes("/check-runs")) return response(403, { message: "Resource not accessible" })
      return response(404)
    })
    const result = await probeGithubCapabilities(options(fetch))
    expect(result).toMatchObject({
      repo: "ok",
      protectionAdmin: "ok",
      checksRead: "forbidden",
      rateLimit: { limit: 5000, remaining: 4999 },
    })
    expect(result.rateLimit?.resetAt).toBe("2027-01-15T08:00:00.000Z")
    expect(calls).toHaveLength(4)
    for (const call of calls) {
      expect(call.url).not.toContain(TOKEN)
      expect(call.init?.headers?.Authorization).toBe(`Bearer ${TOKEN}`)
      // INV-N06: a cached 200 must never answer a reprobe for a revoked token.
      expect(call.init?.cache).toBe("no-store")
    }
    expect(calls.some((call) => call.url.includes("feature/a%2Bb"))).toBe(true)
    // 404 for check-runs is advisory (missing), never a login blocker.
  })

  it("treats missing protection/checks as advisory statuses", async () => {
    const { fetch } = probeFetch((url) => {
      if (url.endsWith("/rate_limit"))
        return response(200, { rate: { limit: 60, remaining: 42, reset: 1 } })
      if (url.endsWith(`/repos/${OWNER}/${REPO}`)) return response(200, {})
      return response(404)
    })
    const result = await probeGithubCapabilities(options(fetch))
    expect(result.protectionAdmin).toBe("missing")
    expect(result.checksRead).toBe("missing")
    expect(result.rateLimit).toEqual({
      limit: 60,
      remaining: 42,
      resetAt: "1970-01-01T00:00:01.000Z",
    })
  })

  it("fails login on 401, scope, and repo-not-found", async () => {
    const cases: Array<[number, string, string]> = [
      [401, "AUTH_EXPIRED", "/rate_limit"],
      [403, "SCOPE", `/repos/${OWNER}/${REPO}`],
      [404, "NOT_FOUND", `/repos/${OWNER}/${REPO}`],
      [500, "UNKNOWN", `/repos/${OWNER}/${REPO}`],
    ]
    for (const [status, code, path] of cases) {
      const { fetch } = probeFetch((url) => {
        if (url.endsWith(path)) return response(status, { message: "nope" })
        return response(200, { resources: { core: { limit: 1, remaining: 1, reset: 1 } } })
      })
      const caught = await probeGithubCapabilities(options(fetch)).catch((error: unknown) => error)
      expect(caught).toBeInstanceOf(CapabilityProbeError)
      expect((caught as CapabilityProbeError).code).toBe(code)
    }
  })

  it("blocks login inside an exhausted quota window (no further requests)", async () => {
    const { fetch, calls } = probeFetch((url) => {
      if (url.endsWith("/rate_limit")) {
        return response(200, {
          resources: { core: { limit: 5000, remaining: 0, reset: 1_800_000_000 } },
        })
      }
      return response(200, {})
    })
    const caught = await probeGithubCapabilities(options(fetch)).catch((error: unknown) => error)
    expect(caught).toBeInstanceOf(CapabilityProbeError)
    expect((caught as CapabilityProbeError).code).toBe("RATE_LIMIT")
    expect((caught as CapabilityProbeError).resetAt).toBe("2027-01-15T08:00:00.000Z")
    expect(calls).toHaveLength(1)
  })

  it("maps network failures and unreadable JSON to typed errors", async () => {
    const offline = await probeGithubCapabilities(
      options(async () => {
        throw new Error("offline")
      }),
    ).catch((error: unknown) => error)
    expect((offline as CapabilityProbeError).code).toBe("NETWORK")

    const { fetch } = probeFetch((url) =>
      url.endsWith("/rate_limit") ? response(200, "{bad-json") : response(200, {}),
    )
    const malformed = await probeGithubCapabilities(options(fetch)).catch((error: unknown) => error)
    expect((malformed as CapabilityProbeError).code).toBe("UNKNOWN")
  })

  it("rethrows a 401 from an optional capability instead of hiding it", async () => {
    const { fetch } = probeFetch((url) => {
      if (url.endsWith("/rate_limit"))
        return response(200, { resources: { core: { limit: 1, remaining: 1, reset: 1 } } })
      if (url.endsWith(`/repos/${OWNER}/${REPO}`)) return response(200, {})
      return response(401, {})
    })
    const caught = await probeGithubCapabilities(options(fetch)).catch((error: unknown) => error)
    expect((caught as CapabilityProbeError).code).toBe("AUTH_EXPIRED")
  })
})
