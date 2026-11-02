#!/usr/bin/env node
/**
 * CI workflow guard — ADR-0010 §2.6 least-privilege CI law, enforced FROM P0 on
 * our own workflows: every `uses:` pinned to a full commit SHA, banned trigger
 * keys (pull_request_target), and `permissions: contents: read` at the top
 * level AND for every job. The one exception is the OIDC release shape: a job
 * may hold `contents: write` only together with `id-token: write` (npm trusted
 * publishing) plus optional `pull-requests: write` — write access never rides
 * tokenless, and no other permission scope is allowed.
 *
 * Runs BEFORE `pnpm install` in CI (fail-before-work ordering), so it MUST stay
 * dependency-free: the wf files are parsed by scripts/yaml-subset.mjs, a
 * fail-closed strict-subset parser that turns RED on any YAML outside the
 * guarded subset — the law is never silently mis-parsed.
 */
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { parseSubsetYaml } from "./yaml-subset.mjs"

const WORKFLOWS_DIR = join(process.cwd(), ".github", "workflows")
const SHA_RE = /^[0-9a-f]{40}$/
const BANNED_TRIGGERS = new Set(["pull_request_target"])
/** @type {string[]} */
const problems = []

/** @param {string} message */
function issue(message) {
  problems.push(message)
}

/** @param {string} dir @returns {string[]} */
function listWorkflows(dir) {
  const out = []
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isFile() && /\.ya?ml$/.test(entry)) out.push(path)
  }
  return out
}

/**
 * Collect `uses` leaf values from any node.
 * @param {ReturnType<typeof parseSubsetYaml> | null} node
 * @param {string[]} out
 */
function collectUses(node, out) {
  if (node == null) return
  if (node.kind === "map") {
    for (const [key, value] of node.entries) {
      if (key === "uses" && value.kind === "scalar") out.push(value.text)
      collectUses(value, out)
    }
  } else if (node.kind === "list") {
    for (const item of node.items) collectUses(item, out)
  }
}

for (const path of listWorkflows(WORKFLOWS_DIR)) {
  const text = readFileSync(path, "utf8")
  const rel = path.replace(/\\/g, "/").split("/").slice(-2).join("/")

  /** @type {ReturnType<typeof parseSubsetYaml> | null} */
  let root = null
  try {
    root = parseSubsetYaml(rel, text)
  } catch (error) {
    issue(
      `${rel}: YAML outside the guarded subset — ${error instanceof Error ? error.message : String(error)}`,
    )
    continue
  }
  if (root.kind !== "map") continue // unreachable: the subset parser only builds maps at root

  const triggers = root.entries.get("on")
  if (triggers != null && triggers.kind === "map") {
    for (const triggerName of triggers.entries.keys()) {
      if (BANNED_TRIGGERS.has(triggerName)) {
        issue(`${rel}: trigger ${JSON.stringify(triggerName)} is banned (ADR-0010 §2.6)`)
      }
    }
  }

  const topPerms = root.entries.get("permissions")
  const topContents =
    topPerms != null && topPerms.kind === "map" ? topPerms.entries.get("contents") : null
  if (topContents == null || topContents.kind !== "scalar" || topContents.text !== "read") {
    issue(`${rel}: top-level permissions must declare 'contents: read'`)
  }

  const jobs = root.entries.get("jobs")
  if (jobs != null && jobs.kind !== "map") {
    issue(`${rel}: 'jobs' must be a block mapping`)
  }
  if (jobs == null || jobs.kind !== "map") continue

  for (const [jobName, rawJob] of jobs.entries) {
    if (rawJob.kind !== "map") {
      issue(`${rel}: job ${JSON.stringify(jobName)} must be a mapping`)
      continue
    }
    const jobPerms = rawJob.entries.get("permissions")
    if (jobPerms == null || jobPerms.kind !== "map") {
      issue(`${rel}: job ${JSON.stringify(jobName)} must declare a permissions mapping`)
      continue
    }
    /** @type {Map<string, string>} */
    const perms = new Map()
    for (const [key, value] of jobPerms.entries) {
      if (value.kind !== "scalar") {
        issue(
          `${rel}: job ${JSON.stringify(jobName)} permission ${JSON.stringify(key)} must be a scalar`,
        )
        continue
      }
      perms.set(key, value.text)
    }
    const contents = perms.get("contents")
    if (contents === "read") {
      // Default shape: read-only. No other permission may ride along.
      for (const key of perms.keys()) {
        if (key !== "contents") {
          issue(
            `${rel}: job ${JSON.stringify(jobName)}: only 'contents: read' is allowed on non-release jobs`,
          )
        }
      }
    } else if (contents === "write") {
      // The OIDC release shape (ADR-0010 §2.6): the publish job may write
      // contents (version commits, tags) and pull-requests (the Version
      // Packages PR), but only together with `id-token: write` — write access
      // never rides tokenless, and no other scope is allowed.
      if (perms.get("id-token") !== "write") {
        issue(
          `${rel}: job ${JSON.stringify(jobName)}: 'contents: write' requires 'id-token: write' (the OIDC publish job shape)`,
        )
      }
      for (const key of perms.keys()) {
        if (!["contents", "pull-requests", "id-token"].includes(key)) {
          issue(
            `${rel}: job ${JSON.stringify(jobName)}: permission ${JSON.stringify(key)} is outside the release shape`,
          )
        }
      }
    } else {
      issue(
        `${rel}: job ${JSON.stringify(jobName)} must declare 'contents: read', or the release shape 'contents: write' + 'id-token: write'`,
      )
    }
    /** @type {string[]} */
    const uses = []
    collectUses(rawJob, uses)
    for (const usesRef of uses) {
      if (usesRef.startsWith("./")) continue // local reusable workflows: our own code
      const at = usesRef.lastIndexOf("@")
      const ref = at >= 0 ? usesRef.slice(at + 1).trim() : ""
      if (!SHA_RE.test(ref)) {
        issue(`${rel}: step uses ${JSON.stringify(usesRef)} must pin a 40-hex commit SHA`)
      }
    }
  }
}

if (problems.length > 0) {
  console.error(`ci-workflow-guard: FAIL — ${problems.length} violation(s):`)
  for (const problem of problems) console.error(`  - ${problem}`)
  process.exit(1)
}
console.log("ci-workflow-guard: OK — SHA-pinned, least-privilege, no banned triggers.")
