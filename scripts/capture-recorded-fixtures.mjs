#!/usr/bin/env node
/**
 * Recorded HTTP fixture capture script — ADR-0005 P2.11 addendum.
 *
 * Records deterministic HTTP interactions from either:
 *   1. --seed / --synthetic: FakeGithubServer in-memory model (zero network, offline CI-safe).
 *   2. Live GitHub sandbox repository via fine-grained PAT.
 *
 * Enforces:
 *   - Zero raw tokens in committed fixtures (INV-A04 / INV-A05).
 *   - Author/committer email PII masking to cms-contract-bot@example.com.
 *   - Response header allowlist (keeps etag, content-type, x-ratelimit-*, retry-after; strips tracking/infrastructure).
 *   - Canonical parameterization to test-owner / test-repo and contract-fixture branch (INV-P14).
 *   - Fail-closed security validation before writing to disk.
 *
 * Usage:
 *   node scripts/capture-recorded-fixtures.mjs --seed          # generate offline golden tape
 *   node scripts/capture-recorded-fixtures.mjs --check         # validate tape on disk
 *   node scripts/capture-recorded-fixtures.mjs --token=<pat>   # capture live from sandbox
 */

import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const WORKSPACE = resolve(HERE, "..")
const CORE_DIR = join(WORKSPACE, "packages", "core")
const DIST_FILE = join(CORE_DIR, "dist", "index.js")
const DEFAULT_OUT = join(
  CORE_DIR,
  "src",
  "backends",
  "github",
  "__tests__",
  "fixtures",
  "recorded-contract-tape.json",
)

const ALLOWED_HEADERS = new Set([
  "etag",
  "content-type",
  "x-ratelimit-limit",
  "x-ratelimit-remaining",
  "x-ratelimit-reset",
  "x-ratelimit-resource",
  "retry-after",
])

function parseArgs() {
  const args = process.argv.slice(2)
  const isSeed = args.includes("--seed") || args.includes("--synthetic")
  const isCheck = args.includes("--check")
  const isDryRun = args.includes("--dry-run")

  function getArg(name) {
    const prefix = `--${name}=`
    const found = args.find((a) => a.startsWith(prefix))
    if (found) return found.slice(prefix.length)
    const idx = args.indexOf(`--${name}`)
    if (idx !== -1 && idx + 1 < args.length) return args[idx + 1]
    return undefined
  }

  const owner =
    getArg("owner") ?? process.env.MYCMS_RECORD_OWNER ?? process.env.GITHUB_OWNER ?? "test-owner"
  const repo =
    getArg("repo") ?? process.env.MYCMS_RECORD_REPO ?? process.env.GITHUB_REPO ?? "test-repo"
  const branch = getArg("branch") ?? process.env.MYCMS_RECORD_BRANCH ?? "contract-fixture"
  const token = getArg("token") ?? process.env.MYCMS_RECORD_TOKEN ?? process.env.GITHUB_TOKEN ?? ""
  const outPath = getArg("out") ?? DEFAULT_OUT

  return { isSeed, isCheck, isDryRun, owner, repo, branch, token, outPath }
}

function ensureCoreBuilt() {
  if (!existsSync(DIST_FILE)) {
    console.log("[capture] packages/core dist not found. Building @mycms/core...")
    execFileSync("pnpm", ["--filter", "@mycms/core", "build"], {
      cwd: WORKSPACE,
      stdio: "inherit",
    })
  }
}

function filterHeaders(headers) {
  const result = {}
  if (!headers) return result
  for (const [k, v] of Object.entries(headers)) {
    const lower = k.toLowerCase()
    if (ALLOWED_HEADERS.has(lower)) {
      result[lower] = String(v)
    }
  }
  return result
}

function redactPii(obj) {
  if (obj === null || typeof obj !== "object") return obj
  if (Array.isArray(obj)) return obj.map(redactPii)
  const out = {}
  for (const [key, value] of Object.entries(obj)) {
    if (key === "author" || key === "committer") {
      if (typeof value === "object" && value !== null) {
        out[key] = {
          ...value,
          name: "MyCMS Contract Runner",
          email: "cms-contract-bot@example.com",
        }
        continue
      }
    }
    out[key] = redactPii(value)
  }
  return out
}

function failClosedSecurityScan(tapeString, rawToken) {
  if (rawToken && rawToken.length > 8 && tapeString.includes(rawToken)) {
    throw new Error(
      "[capture:FAIL-CLOSED] Raw authentication token detected in serialized tape output!",
    )
  }
  const tokenPatterns = [/gh[pousr]_[A-Za-z0-9]{20,}/, /github_pat_[A-Za-z0-9_]{30,}/]
  for (const pattern of tokenPatterns) {
    if (pattern.test(tapeString)) {
      throw new Error(`[capture:FAIL-CLOSED] GitHub access token pattern matched: ${pattern}`)
    }
  }
}

async function recordFromFake(core, options) {
  const {
    FakeGithubServer,
    GithubBackend,
    CORE_CONTRACT_SUITE,
    runContractSuite,
    gitBlobSha,
    gitTreeSha,
    gitCommitShaCanonical,
  } = core

  console.log(
    `[capture] Generating synthetic fixture tape using FakeGithubServer on branch '${options.branch}'...`,
  )

  const baselineBytes = new TextEncoder().encode('{\n  "title": "fixture site"\n}\n')
  const siteBlobSha = await gitBlobSha(baselineBytes)
  const treeSha = await gitTreeSha([
    { path: "src/content/site.json", mode: "100644", type: "blob", sha: siteBlobSha },
  ])
  const headSha = await gitCommitShaCanonical({
    treeSha,
    parentShas: [],
    message: "seed contract fixture",
  })

  const server = new FakeGithubServer({
    defaultBranch: options.branch,
    headSha,
    treeSha,
    files: new Map([["src/content/site.json", { sha: siteBlobSha, bytes: baselineBytes }]]),
  })

  // Attach status models for the seed commit so STATUS_READ_CHECK passes truthfully
  server.setCheckRuns(headSha, [
    { id: 1, name: "build", status: "completed", conclusion: "success" },
  ])
  server.setStatuses(headSha, [{ context: "ci/deploy", state: "success" }])

  const recordedInteractions = []

  const interceptFetch = async (url, init) => {
    const method = (init?.method ?? "GET").toUpperCase()
    const prefix = `https://api.github.com/repos/${options.owner}/${options.repo}`
    let relPath = url.split("?")[0]
    if (relPath.startsWith(prefix)) {
      relPath = relPath.slice(prefix.length)
    }

    const reqHeaders = {}
    if (init?.headers) {
      for (const [k, v] of Object.entries(init.headers)) {
        const lower = k.toLowerCase()
        if (lower === "authorization") {
          reqHeaders[lower] = "Bearer [token]"
        } else if (lower === "if-none-match" || lower === "content-type" || lower === "accept") {
          reqHeaders[lower] = v
        }
      }
    }

    let parsedBody
    if (typeof init?.body === "string") {
      try {
        parsedBody = JSON.parse(init.body)
      } catch {
        parsedBody = init.body
      }
    }

    // ETag conditional check (returns 304 if ETag matches current tree/blob)
    const ifNoneMatch = reqHeaders["if-none-match"]
    if (method === "GET" && ifNoneMatch) {
      const treeMatch = /^\/git\/trees\/([^/]+)$/.exec(relPath)
      if (treeMatch && ifNoneMatch === `"tree-${treeMatch[1]}"`) {
        const respHeaders = { etag: ifNoneMatch }
        recordedInteractions.push({
          request: {
            method,
            url,
            ...(Object.keys(reqHeaders).length > 0 ? { headers: reqHeaders } : {}),
            ...(parsedBody !== undefined ? { body: parsedBody } : {}),
          },
          response: {
            status: 304,
            statusText: "Not Modified",
            headers: respHeaders,
          },
        })
        return {
          ok: false,
          status: 304,
          statusText: "Not Modified",
          headers: { get: (name) => (name.toLowerCase() === "etag" ? ifNoneMatch : null) },
          json: async () => null,
          text: async () => "",
        }
      }

      const contentsMatch = /^\/contents\/(.+)$/.exec(relPath)
      if (contentsMatch) {
        const decoded = decodeURIComponent(contentsMatch[1])
        const found = server.contents(options.branch, decoded)
        if (found && ifNoneMatch === `"blob-${found.sha}"`) {
          const respHeaders = { etag: ifNoneMatch }
          recordedInteractions.push({
            request: {
              method,
              url,
              ...(Object.keys(reqHeaders).length > 0 ? { headers: reqHeaders } : {}),
              ...(parsedBody !== undefined ? { body: parsedBody } : {}),
            },
            response: {
              status: 304,
              statusText: "Not Modified",
              headers: respHeaders,
            },
          })
          return {
            ok: false,
            status: 304,
            statusText: "Not Modified",
            headers: { get: (name) => (name.toLowerCase() === "etag" ? ifNoneMatch : null) },
            json: async () => null,
            text: async () => "",
          }
        }
      }
    }

    const fakeResp = await server.handle({
      method,
      path: relPath,
      headers: reqHeaders,
      body: parsedBody,
    })

    const respHeaders = filterHeaders(fakeResp.headers)
    const status = fakeResp.status
    const ok = status >= 200 && status < 300
    const body = fakeResp.json

    recordedInteractions.push({
      request: {
        method,
        url,
        ...(Object.keys(reqHeaders).length > 0 ? { headers: reqHeaders } : {}),
        ...(parsedBody !== undefined ? { body: parsedBody } : {}),
      },
      response: {
        status,
        statusText: ok ? "OK" : status === 422 ? "Unprocessable Entity" : "Error",
        headers: respHeaders,
        ...(body !== undefined ? { body: redactPii(body) } : {}),
      },
    })

    const text = body !== undefined ? JSON.stringify(body) : ""
    return {
      ok,
      status,
      statusText: ok ? "OK" : "Error",
      headers: {
        get: (name) => respHeaders[name.toLowerCase()] ?? null,
      },
      json: async () => (body !== undefined ? body : {}),
      text: async () => text,
    }
  }

  const backend = new GithubBackend({
    owner: options.owner,
    repo: options.repo,
    token: "token-placeholder",
    fetch: interceptFetch,
  })

  const report = await runContractSuite(backend, CORE_CONTRACT_SUITE, {
    branch: options.branch,
    expectedPaths: ["src/content/site.json"],
    expectedFileBytes: baselineBytes,
  })

  if (!report.ok) {
    console.error("[capture] Contract suite run failed on FakeGithubServer:", report.failures)
    throw new Error(`Contract suite run failed with ${report.failures.length} failures`)
  }

  console.log(
    `[capture] Contract suite passed: ${report.passed}/${CORE_CONTRACT_SUITE.checks.length} checks. Recorded ${recordedInteractions.length} interactions.`,
  )

  return {
    schemaVersion: 1,
    meta: {
      schemaVersion: 1,
      recordedAt: new Date().toISOString(),
      owner: options.owner,
      repo: options.repo,
      branch: options.branch,
      source: "synthetic",
      description: "Golden contract suite recorded HTTP fixture tape (deterministic seed)",
    },
    interactions: recordedInteractions,
  }
}

async function recordFromLive(core, options) {
  const { GithubBackend, CORE_CONTRACT_SUITE, runContractSuite } = core

  console.log(
    `[capture] Recording live against GitHub repository '${options.owner}/${options.repo}' branch '${options.branch}'...`,
  )

  const recordedInteractions = []
  const nativeFetch = globalThis.fetch

  const interceptFetch = async (url, init) => {
    const method = (init?.method ?? "GET").toUpperCase()

    const reqHeaders = {}
    if (init?.headers) {
      for (const [k, v] of Object.entries(init.headers)) {
        const lower = k.toLowerCase()
        if (lower === "authorization") {
          reqHeaders[lower] = "Bearer [token]"
        } else if (lower === "if-none-match" || lower === "content-type" || lower === "accept") {
          reqHeaders[lower] = v
        }
      }
    }

    let parsedBody
    if (typeof init?.body === "string") {
      try {
        parsedBody = JSON.parse(init.body)
      } catch {
        parsedBody = init.body
      }
    }

    const response = await nativeFetch(url, init)
    const status = response.status
    const ok = response.ok
    const respHeaders = filterHeaders(Object.fromEntries(response.headers.entries()))

    const text = await response.text()
    let body
    try {
      body = JSON.parse(text)
    } catch {
      body = text
    }

    // Redact real token from body/urls
    let cleanUrl = url
    if (options.token) {
      cleanUrl = cleanUrl.replaceAll(options.token, "[token]")
    }

    recordedInteractions.push({
      request: {
        method,
        url: cleanUrl,
        ...(Object.keys(reqHeaders).length > 0 ? { headers: reqHeaders } : {}),
        ...(parsedBody !== undefined ? { body: parsedBody } : {}),
      },
      response: {
        status,
        statusText: response.statusText,
        headers: respHeaders,
        ...(body !== undefined ? { body: redactPii(body) } : {}),
      },
    })

    return {
      ok,
      status,
      statusText: response.statusText,
      headers: {
        get: (name) => respHeaders[name.toLowerCase()] ?? null,
      },
      json: async () => (typeof body === "object" ? body : JSON.parse(text)),
      text: async () => text,
    }
  }

  const backend = new GithubBackend({
    owner: options.owner,
    repo: options.repo,
    token: options.token,
    fetch: interceptFetch,
  })

  const report = await runContractSuite(backend, CORE_CONTRACT_SUITE, {
    branch: options.branch,
    expectedPaths: ["src/content/site.json"],
  })

  if (!report.ok) {
    console.error("[capture] Contract suite run failed on live GitHub:", report.failures)
    throw new Error(`Contract suite run failed with ${report.failures.length} failures`)
  }

  return {
    schemaVersion: 1,
    meta: {
      schemaVersion: 1,
      recordedAt: new Date().toISOString(),
      owner: options.owner,
      repo: options.repo,
      branch: options.branch,
      source: "sandbox",
      description: "Live sandbox repository contract suite recorded tape",
    },
    interactions: recordedInteractions,
  }
}

async function main() {
  const options = parseArgs()

  if (options.isCheck) {
    console.log(`[capture] Checking recorded tape at '${options.outPath}'...`)
    if (!existsSync(options.outPath)) {
      console.error(`[capture] Tape file does not exist at '${options.outPath}'`)
      process.exit(1)
    }
    const content = readFileSync(options.outPath, "utf8")
    const parsed = JSON.parse(content)
    if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.interactions)) {
      console.error("[capture] Tape failed schema validation: invalid structure")
      process.exit(1)
    }
    failClosedSecurityScan(content, options.token)
    console.log(
      `[capture:OK] Tape is valid (${parsed.interactions.length} interactions, source: ${parsed.meta.source}).`,
    )
    return
  }

  ensureCoreBuilt()
  const core = await import(pathToFileURL(DIST_FILE).href)

  let tape
  if (options.isSeed || !options.token) {
    if (!options.isSeed) {
      console.log(
        "[capture] No live GITHUB_TOKEN or --token provided; defaulting to synthetic seed mode (--seed).",
      )
    }
    tape = await recordFromFake(core, options)
  } else {
    tape = await recordFromLive(core, options)
  }

  // Canonical parameterization of URLs
  const rawTapeStr = JSON.stringify(tape, null, 2)
  let cleanTapeStr = rawTapeStr
  if (options.owner !== "test-owner" || options.repo !== "test-repo") {
    cleanTapeStr = cleanTapeStr.replaceAll(
      `/repos/${options.owner}/${options.repo}`,
      "/repos/test-owner/test-repo",
    )
  }
  if (options.token) {
    cleanTapeStr = cleanTapeStr.replaceAll(options.token, "[token]")
  }

  // Enforce pre-write fail-closed security scan
  failClosedSecurityScan(cleanTapeStr, options.token)

  if (options.isDryRun) {
    console.log(
      `[capture:DRY-RUN] Clean tape verified (${tape.interactions.length} interactions). Writing omitted.`,
    )
    return
  }

  const outDir = dirname(options.outPath)
  if (!existsSync(outDir)) {
    mkdirSync(outDir, { recursive: true })
  }
  writeFileSync(options.outPath, `${cleanTapeStr}\n`, "utf8")
  console.log(
    `[capture:DONE] Recorded tape written to '${options.outPath}' (${tape.interactions.length} interactions).`,
  )
}

main().catch((err) => {
  console.error("[capture:FATAL]", err)
  process.exit(1)
})
