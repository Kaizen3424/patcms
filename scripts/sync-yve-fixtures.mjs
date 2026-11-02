#!/usr/bin/env node
import { execFileSync } from "node:child_process"
/**
 * yve fixture mirror sync — P1.12 / INV-S01.
 *
 * Copies the real yve content + media bytes into playground/fixtures/repo
 * (never hand-retyped), adds the six test-only drift fixtures, and writes a
 * manifest pinning the git-blob SHA-1, SHA-256, and byte size of every file.
 *
 * Usage:
 *   node scripts/sync-yve-fixtures.mjs            # regenerate (needs the yve mirror)
 *   node scripts/sync-yve-fixtures.mjs --check    # verify committed bytes (CI-safe)
 *
 * Source path defaults to ../yve_gallery_decap; override with YVE_REPO.
 */
import { createHash } from "node:crypto"
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { dirname, join, relative, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const WORKSPACE = resolve(HERE, "..")
const FIXTURE_ROOT = join(WORKSPACE, "playground", "fixtures", "repo")
const SOURCE_ROOT = resolve(process.env.YVE_REPO ?? join(WORKSPACE, "..", "yve_gallery_decap"))
const CHECK_ONLY = process.argv.includes("--check")
const SKIP_NAMES = new Set([
  "meta.json",
  "manifest.json",
  "mockServiceWorker.js",
  ".gitkeep",
  ".keep",
])

/** @param {Buffer|string} data */
function sha1(data) {
  return createHash("sha1").update(data).digest("hex")
}

/** @param {Buffer|string} data */
function sha256(data) {
  return createHash("sha256").update(data).digest("hex")
}

/** Git blob SHA-1 over exact bytes. @param {Buffer} bytes */
function blobSha(bytes) {
  return sha1(Buffer.concat([Buffer.from(`blob ${bytes.length}\0`), bytes]))
}

/** @param {string} dir @param {string} [base] @returns {string[]} */
function walk(dir, base = dir) {
  if (!existsSync(dir)) return []
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      out.push(...walk(full, base))
      continue
    }
    if (entry.isFile() && !SKIP_NAMES.has(entry.name)) {
      out.push(relative(base, full).split(sep).join("/"))
    }
  }
  return out.sort()
}

/** @param {string} path @param {Buffer} bytes @param {"yve"|"drift"} origin */
function manifestEntry(path, bytes, origin) {
  return {
    path,
    origin,
    bytes: bytes.length,
    sha: blobSha(bytes),
    sha256: sha256(bytes),
  }
}

/** @param {Map<string, {sha: string}>} blobs */
function treeSha(blobs) {
  /** @type {Map<string, any>} */
  const root = new Map()
  for (const [path, blob] of blobs) {
    const segments = path.split("/")
    let node = root
    for (const segment of segments.slice(0, -1)) {
      let child = node.get(segment)
      if (child === undefined) {
        child = new Map()
        node.set(segment, child)
      }
      node = child
    }
    node.set(segments[segments.length - 1], { sha: blob.sha })
  }

  /** @param {Map<string, any>} node @returns {string} */
  function hash(node) {
    const chunks = []
    const names = [...node.keys()].sort()
    for (const name of names) {
      const child = node.get(name)
      if (child instanceof Map) {
        chunks.push(
          Buffer.concat([Buffer.from(`40000 ${name}\0`), Buffer.from(hash(child), "hex")]),
        )
      } else {
        chunks.push(Buffer.concat([Buffer.from(`100644 ${name}\0`), Buffer.from(child.sha, "hex")]))
      }
    }
    const body = Buffer.concat(chunks)
    return sha1(Buffer.concat([Buffer.from(`tree ${body.length}\0`), body]))
  }

  return hash(root)
}

function driftFixtures() {
  const base = {
    title: "Drift fixture",
    price: 1650,
    category: "Table Lamps",
    people: [{ name: "Ing", bio: "Hat maker and lampshade designer." }],
    contact: { email: "atelier@ingandyve.nl", phone: "+31 (0)6 12 34 56 78" },
    featured: "iris-no-7",
    images: [
      {
        image: "/images/products/iris-no-7-1.jpg",
        alt: "Iris No. 7 sculptural lamp",
        objectPosition: "center",
      },
    ],
    materialFilter: "Ceramics",
  }

  const cases = {
    "category-drift.json": { ...base, title: "Drift — unknown category", category: "Floor Lamps" },
    "people-drift.json": { ...base, title: "Drift — empty people", people: [] },
    "price-drift.json": { ...base, title: "Drift — fractional price", price: 1650.5 },
    "email-drift.json": {
      ...base,
      title: "Drift — invalid email",
      contact: { email: "not-an-email", phone: "+31 (0)6 12 34 56 78" },
    },
    "relation-drift.json": {
      ...base,
      title: "Drift — missing relation",
      featured: "missing-product",
    },
    "untouched-drift.json": (() => {
      const { materialFilter: _default, ...rest } = base
      return {
        ...rest,
        title: "Drift — untouched key + default immunity",
        devNote: "This key is preserved verbatim and never rendered as markup.",
      }
    })(),
  }

  return Object.entries(cases).map(([name, value]) => ({
    path: `src/content/drift/${name}`,
    bytes: Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8"),
  }))
}

function readManifest() {
  const path = join(FIXTURE_ROOT, "manifest.json")
  if (!existsSync(path)) throw new Error(`missing manifest: ${path} (run fixtures sync first)`)
  return JSON.parse(readFileSync(path, "utf8"))
}

function verify() {
  const manifest = readManifest()
  const expected = new Map(manifest.files.map((entry) => [entry.path, entry]))
  const actualPaths = [
    ...walk(join(FIXTURE_ROOT, "src", "content")).map((path) => `src/content/${path}`),
    ...walk(join(FIXTURE_ROOT, "public", "images")).map((path) => `public/images/${path}`),
  ].map((path) => path.replace(/\\/g, "/"))

  const problems = []
  const actualSet = new Set(actualPaths)
  for (const path of expected.keys()) {
    if (!actualSet.has(path)) problems.push(`missing fixture file: ${path}`)
  }
  for (const path of actualPaths) {
    if (!expected.has(path)) problems.push(`unmanifested fixture file: ${path}`)
  }

  for (const [path, entry] of expected) {
    const abs = join(FIXTURE_ROOT, path)
    if (!existsSync(abs)) continue
    const bytes = readFileSync(abs)
    if (bytes.length !== entry.bytes)
      problems.push(`${path}: byte size ${bytes.length} ≠ ${entry.bytes}`)
    if (blobSha(bytes) !== entry.sha) problems.push(`${path}: git blob SHA changed`)
    if (sha256(bytes) !== entry.sha256) problems.push(`${path}: SHA-256 changed`)
  }

  const blobs = new Map(manifest.files.map((entry) => [entry.path, { sha: entry.sha }]))
  const computedTree = treeSha(blobs)
  if (computedTree !== manifest.treeSha)
    problems.push("manifest treeSha does not match file blob SHAs")
  if (manifest.headSha !== sha1(Buffer.from(`patcms fixture head\n${computedTree}\n`))) {
    problems.push("manifest headSha does not derive from treeSha")
  }

  const meta = JSON.parse(readFileSync(join(FIXTURE_ROOT, "meta.json"), "utf8"))
  if (meta.defaultBranch !== manifest.defaultBranch) problems.push("meta/defaultBranch mismatch")
  if (meta.headSha !== manifest.headSha) problems.push("meta/headSha mismatch")
  if (meta.treeSha !== manifest.treeSha) problems.push("meta/treeSha mismatch")

  if (existsSync(SOURCE_ROOT)) {
    const sourceFiles = [
      ...walk(join(SOURCE_ROOT, "src", "content")).map((path) => `src/content/${path}`),
      ...walk(join(SOURCE_ROOT, "public", "images")).map((path) => `public/images/${path}`),
    ]
    const sourceSet = new Set(sourceFiles)
    const yveEntries = manifest.files.filter((entry) => entry.origin === "yve")
    if (yveEntries.length !== sourceFiles.length) {
      problems.push(
        `source has ${sourceFiles.length} yve files, manifest pins ${yveEntries.length}`,
      )
    }
    for (const entry of yveEntries) {
      if (!sourceSet.has(entry.path)) {
        problems.push(`source no longer contains ${entry.path}`)
        continue
      }
      const sourceAbs = join(SOURCE_ROOT, entry.path)
      const bytes = readFileSync(sourceAbs)
      if (sha256(bytes) !== entry.sha256) problems.push(`${entry.path}: source bytes drifted`)
    }
    const sourceCommit = execFileSync("git", ["-C", SOURCE_ROOT, "rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim()
    if (manifest.sourceCommit !== sourceCommit) {
      problems.push(
        `source commit ${sourceCommit.slice(0, 7)} ≠ manifest ${manifest.sourceCommit.slice(0, 7)}`,
      )
    }
  }

  const counts = manifest.files.reduce(
    (acc, entry) => {
      acc[entry.origin] += 1
      return acc
    },
    { yve: 0, drift: 0 },
  )

  if (problems.length > 0) {
    console.error("fixture verification FAILED:")
    for (const problem of problems) console.error(`  - ${problem}`)
    process.exitCode = 1
    return
  }
  console.log(
    `fixtures OK: ${manifest.files.length} files (${counts.yve} yve @ ${manifest.sourceCommit.slice(0, 7)}, ${counts.drift} drift)`,
  )
}

function sync() {
  if (!existsSync(SOURCE_ROOT)) {
    throw new Error(
      `yve source not found at ${SOURCE_ROOT}. Set YVE_REPO or clone yve_gallery_decap beside the workspace.`,
    )
  }

  rmSync(join(FIXTURE_ROOT, "src", "content"), { recursive: true, force: true })
  rmSync(join(FIXTURE_ROOT, "public", "images"), { recursive: true, force: true })
  mkdirSync(join(FIXTURE_ROOT, "src", "content"), { recursive: true })
  mkdirSync(join(FIXTURE_ROOT, "public", "images"), { recursive: true })

  const entries = []
  const sourceContent = walk(join(SOURCE_ROOT, "src", "content"))
  for (const path of sourceContent) {
    const repoPath = `src/content/${path}`
    const target = join(FIXTURE_ROOT, repoPath)
    mkdirSync(dirname(target), { recursive: true })
    copyFileSync(join(SOURCE_ROOT, "src", "content", path), target)
    entries.push(manifestEntry(repoPath, readFileSync(target), "yve"))
  }

  const sourceImages = walk(join(SOURCE_ROOT, "public", "images"))
  for (const path of sourceImages) {
    const repoPath = `public/images/${path}`
    const target = join(FIXTURE_ROOT, repoPath)
    mkdirSync(dirname(target), { recursive: true })
    copyFileSync(join(SOURCE_ROOT, "public", "images", path), target)
    entries.push(manifestEntry(repoPath, readFileSync(target), "yve"))
  }

  for (const drift of driftFixtures()) {
    const target = join(FIXTURE_ROOT, drift.path)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, drift.bytes)
    entries.push(manifestEntry(drift.path, drift.bytes, "drift"))
  }

  const workerSource = join(WORKSPACE, "playground", "public", "mockServiceWorker.js")
  if (existsSync(workerSource)) {
    copyFileSync(workerSource, join(FIXTURE_ROOT, "public", "mockServiceWorker.js"))
  }

  entries.sort((a, b) => a.path.localeCompare(b.path))
  const blobs = new Map(entries.map((entry) => [entry.path, { sha: entry.sha }]))
  const tree = treeSha(blobs)
  const headSha = sha1(Buffer.from(`patcms fixture head\n${tree}\n`))
  const sourceCommit = execFileSync("git", ["-C", SOURCE_ROOT, "rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim()

  const manifest = {
    source: "yve_gallery_decap",
    sourceRepo: "https://github.com/Kaizen3424/yve_gallery_decap",
    sourceCommit,
    defaultBranch: "main",
    headSha,
    treeSha: tree,
    files: entries,
  }
  writeFileSync(join(FIXTURE_ROOT, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`)
  writeFileSync(
    join(FIXTURE_ROOT, "meta.json"),
    `${JSON.stringify({ defaultBranch: "main", headSha, treeSha: tree }, null, 2)}\n`,
  )

  console.log(
    `fixtures synced: ${entries.length} files (${sourceContent.length + sourceImages.length} yve, ${entries.length - sourceContent.length - sourceImages.length} drift) @ ${sourceCommit.slice(0, 7)}`,
  )
}

try {
  if (CHECK_ONLY) verify()
  else sync()
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
}
