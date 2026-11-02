/**
 * Git SHA-1 framing — ADR-0005 P2 addendum.
 *
 * WebCrypto (`crypto.subtle.digest`) so browser and Node 22 produce identical
 * results with zero dependencies. The framings here are pinned by tests against
 * the yve fixture manifest (computed independently by `sync-yve-fixtures.mjs`
 * with `node:crypto`) and by NIST vectors, so a WebCrypto regression cannot
 * silently diverge from real git.
 */

const HEX_TABLE = (() => {
  const table = new Uint8Array(128).fill(16)
  for (let index = 0; index < 16; index += 1) {
    const glyph = "0123456789ABCDEF"[index] as string
    table[glyph.charCodeAt(0)] = index
    table[glyph.toLowerCase().charCodeAt(0)] = index
  }
  return table
})()

/** Strict hex decode; undefined on malformed input (never silently corrupt). */
export function hexDecodeStrict(value: string): Uint8Array | undefined {
  if (value.length % 2 !== 0) return undefined
  const out = new Uint8Array(value.length / 2)
  for (let index = 0; index < value.length; index += 2) {
    const high = HEX_TABLE[value.charCodeAt(index)] ?? 16
    const low = HEX_TABLE[value.charCodeAt(index + 1)] ?? 16
    if (high > 15 || low > 15) return undefined
    out[index / 2] = (high << 4) | low
  }
  return out
}

/** SHA-1 hex digest over exact bytes. */
export async function sha1Hex(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(bytes)
  const digest = await crypto.subtle.digest("SHA-1", copy)
  const view = new DataView(digest)
  let hex = ""
  for (let index = 0; index < view.byteLength; index += 1) {
    hex += view.getUint8(index).toString(16).padStart(2, "0")
  }
  return hex
}

/** Git blob SHA-1: sha1("blob {byteLength}\\0" + bytes). */
export async function gitBlobSha(bytes: Uint8Array): Promise<string> {
  const header = new TextEncoder().encode(`blob ${bytes.byteLength}\0`)
  return sha1Hex(concatBytes(header, bytes))
}

/** Flat tree entry: a repo-relative POSIX path with its git mode/type/sha. */
export interface GitTreeEntry {
  readonly path: string
  readonly mode: string
  readonly type: string
  readonly sha: string
  readonly size?: number
}

/**
 * Git tree SHA-1 from a FLAT path list (recursive framing): directories are
 * hashed depth-first, names sort per-directory, and subtree SHAs hex-decode
 * into the parent frame. Equal file maps therefore hash to equal tree SHAs
 * (content addressing) — the property the zero-diff skip (INV-S02 C.1 scope)
 * and idempotent retries (INV-P03) rely on.
 */
export async function gitTreeSha(entries: readonly GitTreeEntry[]): Promise<string> {
  const encoder = new TextEncoder()
  const root = new Map<string, Map<string, unknown>>()
  const leaves = new Map<string, GitTreeEntry>()

  for (const entry of entries) {
    const segments = entry.path.split("/")
    if (segments.some((segment) => segment.length === 0)) {
      throw new Error(`gitTreeSha: malformed entry path ${entry.path}`)
    }
    const name = segments[segments.length - 1] as string
    let node: Map<string, Map<string, unknown>> = root
    for (const segment of segments.slice(0, -1)) {
      const existing = node.get(segment)
      if (existing === undefined) {
        node.set(segment, new Map())
      }
      node = node.get(segment) as Map<string, Map<string, unknown>>
    }
    if (node.has(name)) {
      throw new Error(`gitTreeSha: path collision at ${entry.path}`)
    }
    node.set(name, new Map()) // a FILE reserves an empty map; a directory is non-empty
    leaves.set(entry.path, entry)
  }

  async function hash(node: Map<string, unknown>, prefix: string): Promise<string> {
    const chunks: Uint8Array[] = []
    const names = [...node.keys()].sort()
    for (const name of names) {
      const child = node.get(name)
      const childPath = prefix.length === 0 ? name : `${prefix}/${name}`
      if (child instanceof Map && child.size > 0) {
        const childSha = await hash(child, childPath)
        const decoded = hexDecodeStrict(childSha)
        if (decoded === undefined) throw new Error(`gitTreeSha: non-hex sha for ${childPath}`)
        chunks.push(encoder.encode(`40000 ${name}\0`), decoded)
      } else {
        const leaf = leaves.get(childPath)
        if (leaf === undefined) throw new Error(`gitTreeSha: leaf missing for ${childPath}`)
        const decoded = hexDecodeStrict(leaf.sha)
        if (decoded === undefined) throw new Error(`gitTreeSha: non-hex sha for ${childPath}`)
        chunks.push(encoder.encode(`${leaf.mode} ${name}\0`), decoded)
      }
    }
    const body = concatBytes(...chunks)
    const header = encoder.encode(`tree ${body.byteLength}\0`)
    return sha1Hex(concatBytes(header, body))
  }

  return hash(root, "")
}

/** Deterministic fixture commit framing — equal content ⇒ equal sha (INV-P03). */
export interface CanonicalCommitInput {
  readonly treeSha: string
  readonly parentShas: readonly string[]
  readonly message: string
}

/** Git commit SHA-1 with a FIXED author/committer (fixture determinism). */
export async function gitCommitShaCanonical(input: CanonicalCommitInput): Promise<string> {
  const identity = "patcms (fixture) <fixture@patcms.invalid> 0 +0000"
  const lines = [
    `tree ${input.treeSha}`,
    ...input.parentShas.map((sha) => `parent ${sha}`),
    `author ${identity}`,
    `committer ${identity}`,
    "",
    input.message,
    "",
  ]
  const content = new TextEncoder().encode(lines.join("\n"))
  const header = new TextEncoder().encode(`commit ${content.byteLength}\0`)
  return sha1Hex(concatBytes(header, content))
}

function concatBytes(...arrays: readonly Uint8Array[]): Uint8Array {
  const total = arrays.reduce((sum, items) => sum + items.byteLength, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const items of arrays) {
    out.set(items, offset)
    offset += items.byteLength
  }
  return out
}
