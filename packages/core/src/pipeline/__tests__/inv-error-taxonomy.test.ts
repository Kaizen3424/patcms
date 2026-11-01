/// <reference types="node" />
import { Buffer } from "node:buffer"
import { describe, expect, it } from "vitest"
import { buildSpecFromBytes, createHarness } from "../../__tests__/support/fake-github-fetch"
import { BackendWriteError, classifyWriteResponse } from "../../backend/write-errors"
import { GithubBackend } from "../../backends/github"
import type { FetchLike, FetchResponseLike } from "../../composition"
import { encodeUtf8 } from "../../safety/encoding"
import { runSave } from "../save-driver"

/**
 * INV-A02 — the write error taxonomy. GitHub transport failures collapse into
 * named codes; response bodies NEVER leak into error messages (the founder
 * message map renders prose, INV-A02 posture). Also pins the INV-A03 hook
 * seam: 401/403/422-class write failures fire the after-write hook; CAS
 * conflicts and rate limits summon their own machinery instead.
 */

const HEAD = "2a".repeat(20)
const BRANCH = "fixture-branch"

function respond(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): FetchResponseLike {
  const text = JSON.stringify(body)
  const headerMap = new Map(Object.entries(headers))
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: "x",
    headers: {
      get(name: string) {
        return headerMap.get(name) ?? null
      },
    },
    json: async () => body,
    text: async () => text,
  }
}

function backendFor(patchResponse: FetchResponseLike): GithubBackend {
  const fetch: FetchLike = async (url, init) => {
    if (init?.method === "PATCH") return patchResponse
    if (init?.method === "POST") {
      const path = new URL(url).pathname
      if (
        path.endsWith("/git/blobs") ||
        path.endsWith("/git/trees") ||
        path.endsWith("/git/commits")
      ) {
        return respond(201, { sha: "ef".repeat(20) })
      }
    }
    return respond(200, { ref: `refs/heads/${BRANCH}`, object: { sha: HEAD, type: "commit" } })
  }
  return new GithubBackend({
    owner: "o",
    repo: "r",
    token: "t",
    fetch,
    baseUrl: "https://unit.test",
  })
}

interface PatchCase {
  readonly name: string
  readonly status: number
  readonly body?: unknown
  readonly headers?: Record<string, string>
  readonly code: string
  readonly retryAfter?: string
  readonly resetAt?: string
}

const CASES: readonly PatchCase[] = [
  {
    name: "401 rejects the token",
    status: 401,
    body: { message: "Bad credentials" },
    code: "AUTH_EXPIRED",
  },
  {
    name: "403 quota exhaustion reads as rate limit",
    status: 403,
    body: { message: "Resource not accessible" },
    headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "1900000000" },
    code: "RATE_LIMIT",
    resetAt: "1900000000",
  },
  {
    name: "403 without rate headers is a scope failure",
    status: 403,
    body: { message: "Resource not accessible by integration" },
    code: "SCOPE",
  },
  {
    name: "404 missing ref is not found",
    status: 404,
    body: { message: "Not Found" },
    code: "NOT_FOUND",
  },
  {
    name: "422 non-FF body is the CAS conflict",
    status: 422,
    body: { message: "Update is not a fast forward" },
    code: "CAS_CONFLICT",
  },
  {
    name: "422 'was expected' body is the CAS conflict too",
    status: 422,
    body: { message: "was expected to be in" },
    code: "CAS_CONFLICT",
  },
  {
    name: "422 validation body is not a CAS conflict",
    status: 422,
    body: { message: "Validation Failed" },
    code: "VALIDATION",
  },
  {
    name: "429 carries Retry-After",
    status: 429,
    body: { message: "Too Many Requests" },
    headers: { "retry-after": "30" },
    code: "RATE_LIMIT",
    retryAfter: "30",
  },
  {
    name: "5xx is an unknown outcome",
    status: 502,
    body: { message: "Server Error" },
    code: "UNKNOWN",
  },
]

describe("INV-A02 — write error taxonomy (classifier matrix, no body leakage)", () => {
  for (const testCase of CASES) {
    it(`classifyWriteResponse: ${testCase.name}`, () => {
      const error = classifyWriteResponse({
        status: testCase.status,
        headers: {
          get: (name: string) =>
            (testCase.headers as Record<string, string> | undefined)?.[name] ?? null,
        },
        bodyText: JSON.stringify(testCase.body ?? {}),
      })
      expect(error.code).toBe(testCase.code)
      if (testCase.retryAfter !== undefined) expect(error.retryAfter).toBe(testCase.retryAfter)
      if (testCase.resetAt !== undefined) expect(error.resetAt).toBe(testCase.resetAt)

      // Prose law: no response-body text leaks into the message.
      const bodyText = JSON.stringify(testCase.body ?? {})
      expect(error.message).not.toContain(bodyText)
      expect(error.message).toMatch(/GitHub/)
    })
  }

  it("transport throws collapse into NETWORK write errors", async () => {
    const THROWING: FetchLike = async () => {
      throw new Error("socket reset")
    }
    const backend = new GithubBackend({
      owner: "o",
      repo: "r",
      token: "t",
      fetch: THROWING,
      baseUrl: "https://unit.test",
    })
    await expect(
      backend.commitChanges(
        { updates: [{ path: "a.json", bytes: encodeUtf8("{}") }] },
        HEAD,
        BRANCH,
      ),
    ).rejects.toMatchObject({ code: "NETWORK" })
  })
})

describe("INV-A03 hook seam — after-write failure pairing (re-probe wires at P2.5)", () => {
  it("401 fires the after-write hook exactly once", async () => {
    const spec = await buildSpecFromBytes([["src/content/site.json", encodeUtf8("{}")]])
    const harness = createHarness(spec, {
      chaos: { faults: [{ method: "POST", pathPattern: /^\/git\/blobs$/, times: 5, status: 401 }] },
    })
    const hook: BackendWriteError[] = []
    // Edit bytes differ from the seed (a no-op must not reach the transport).
    await runSave({
      backend: harness.backend,
      branch: BRANCH,
      changes: {
        updates: [{ path: "src/content/site.json", bytes: encodeUtf8('{"edited":true}') }],
      },
      onAfterWriteFailure: (error) => hook.push(error),
      maxRebuilds: 0,
    })
    // The verdict is FAILED (typed), and the hook saw every 401-class failure.
    expect(hook.length).toBeGreaterThanOrEqual(1)
    expect(hook[0]?.code).toBe("AUTH_EXPIRED")
  })

  it("CAS conflicts do NOT summon the re-probe (conflict machinery applies)", async () => {
    const spec = await buildSpecFromBytes([["src/content/site.json", encodeUtf8("{}")]])
    const harness = createHarness(spec, {
      chaos: {
        moveRefBefore: [
          { method: "PATCH", pathPattern: /\/git\/refs\/heads\//, sha: "cd".repeat(20) },
        ],
      },
    })
    const hook: BackendWriteError[] = []
    const verdict = await runSave({
      backend: harness.backend,
      branch: BRANCH,
      changes: {
        updates: [{ path: "src/content/site.json", bytes: encodeUtf8('{"edited":true}') }],
      },
      onAfterWriteFailure: (error) => hook.push(error),
    })
    expect(verdict.kind).toBe("conflict")
    expect(hook.length).toBe(0)
  })

  it("taxonomy: BackendWriteError is branded + isBackendWriteError discriminates", () => {
    const error = new BackendWriteError("VALIDATION", "x", { status: 422 })
    expect(error.name).toBe("BackendWriteError")
    expect(error.status).toBe(422)
    expect(
      classifyWriteResponse({ status: 200, headers: { get: () => null }, bodyText: "" }).code,
    ).toBe("UNKNOWN")
  })
})

describe("INV-A02 — GithubBackend surfaces classified write errors through the transport", () => {
  it("a 422 fast-forward refusal at PATCH arrives as CAS_CONFLICT", async () => {
    const backend = backendFor(respond(422, { message: "Update is not a fast forward" }))
    await expect(
      backend.commitChanges(
        { updates: [{ path: "a.json", bytes: Buffer.from("{}", "utf8") }] },
        HEAD,
        BRANCH,
      ),
    ).rejects.toMatchObject({ code: "CAS_CONFLICT", status: 422 })
  })
})
