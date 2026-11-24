/// <reference types="node" />
import { Buffer } from "node:buffer"
import { createHash, randomBytes } from "node:crypto"
import { readFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import {
  GIT_EMPTY_TREE_SHA1,
  gitBlobSha,
  gitCommitShaCanonical,
  gitTreeSha,
  sha1Hex,
} from "../git-sha"

const HERE = dirname(fileURLToPath(import.meta.url))
const FIXTURE_ROOT = resolve(HERE, "../../../../..", "playground", "fixtures", "repo")

/** Independent reference — node:crypto must agree with WebCrypto framing. */
function refSha1(data: Buffer): string {
  return createHash("sha1").update(data).digest("hex")
}

function refBlobSha(bytes: Uint8Array): string {
  return refSha1(Buffer.concat([Buffer.from(`blob ${bytes.length}\0`), Buffer.from(bytes)]))
}

describe("git-sha framing (ADR-0005 P2 addendum)", () => {
  it("matches NIST SHA-1 vectors via WebCrypto", async () => {
    expect(await sha1Hex(new TextEncoder().encode("abc"))).toBe(
      "a9993e364706816aba3e25717850c26c9cd0d89d",
    )
    expect(await sha1Hex(new Uint8Array(0))).toBe("da39a3ee5e6b4b0d3255bfef95601890afd80709")
  })

  it("blobs frame identically to real git (node:crypto differential)", async () => {
    const samples = ["yves", "café électricité", "", "multi\nline\n".repeat(99)]
    for (const text of samples) {
      const bytes = Buffer.from(text, "utf8")
      expect(await gitBlobSha(bytes)).toBe(refBlobSha(bytes))
      // Framing comment asserts byte-meaning: `blob <len>\0` prefix is load-bearing.
      expect(await gitBlobSha(bytes)).not.toBe(refSha1(Buffer.from(text, "utf8")))
    }
    for (let round = 0; round < 8; round += 1) {
      const bytes = randomBytes(1 + round * 313)
      expect(await gitBlobSha(bytes)).toBe(refBlobSha(bytes))
    }
  })

  it("reproduces every yve fixture blob SHA pinned by the sync script", async () => {
    const manifest = JSON.parse(readFileSync(join(FIXTURE_ROOT, "manifest.json"), "utf8")) as {
      files: readonly { path: string; sha: string }[]
    }
    expect(manifest.files.length).toBeGreaterThan(0)
    for (const entry of manifest.files) {
      const bytes = readFileSync(join(FIXTURE_ROOT, entry.path))
      expect(await gitBlobSha(bytes)).toBe(entry.sha)
    }
  })

  it("equal file maps give equal tree SHAs; content changes change the SHA", async () => {
    const encode = (text: string): Uint8Array => new TextEncoder().encode(text)
    const alpha = { path: "src/content/site.json", mode: "100644", type: "blob" }
    const first = await gitTreeSha([
      { ...alpha, sha: await gitBlobSha(encode('{"a":1}\n')) },
      { path: "public/images/logo.png", mode: "100644", type: "blob", sha: "b1".repeat(20) },
    ])
    const second = await gitTreeSha([
      { ...alpha, sha: await gitBlobSha(encode('{"a":1}\n')) },
      { path: "public/images/logo.png", mode: "100644", type: "blob", sha: "b1".repeat(20) },
    ])
    expect(first).toBe(second)
    const changed = await gitTreeSha([
      { ...alpha, sha: await gitBlobSha(encode('{"a":2}\n')) },
      { path: "public/images/logo.png", mode: "100644", type: "blob", sha: "b1".repeat(20) },
    ])
    expect(changed).not.toBe(first)
  })

  it("frames nested directories like git mktree (sync-script parity)", async () => {
    // Independent node:crypto reference of the nested framing from sync-yve-fixtures.
    const blobA = refBlobSha(Buffer.from("a", "utf8"))
    const blobB = refBlobSha(Buffer.from("b", "utf8"))
    const refTreeSha = (flat: Array<{ path: string; sha: string }>): string => {
      const root = new Map<string, unknown>()
      for (const { path, sha } of flat) {
        const segments = path.split("/")
        let node = root as Map<string, unknown>
        for (const segment of segments.slice(0, -1)) {
          const next = (node.get(segment) as Map<string, unknown> | undefined) ?? new Map()
          node.set(segment, next)
          node = next
        }
        node.set(segments[segments.length - 1] as string, { sha })
      }
      function hash(node: Map<string, unknown>): string {
        const chunks: Buffer[] = []
        for (const name of [...node.keys()].sort()) {
          const child = node.get(name)
          if (child instanceof Map) {
            chunks.push(
              Buffer.concat([Buffer.from(`40000 ${name}\0`), Buffer.from(hash(child), "hex")]),
            )
          } else {
            chunks.push(
              Buffer.concat([
                Buffer.from(`100644 ${name}\0`),
                Buffer.from((child as { sha: string }).sha, "hex"),
              ]),
            )
          }
        }
        const body = Buffer.concat(chunks)
        return refSha1(Buffer.concat([Buffer.from(`tree ${body.length}\0`), body]))
      }
      return hash(root)
    }
    const flat = [
      { path: "src/content/site.json", sha: blobA },
      { path: "src/content/dir/deep.json", sha: blobB },
      { path: "public/images/logo.png", sha: blobB },
    ]
    const entries = await Promise.all(
      flat.map(async ({ path, sha }) => ({ path, mode: "100644", type: "blob", sha })),
    )
    expect(await gitTreeSha(entries)).toBe(refTreeSha(flat))
  })

  it("canonical commit framing is deterministic across repeated computation", async () => {
    const input = {
      treeSha: "c0".repeat(20),
      parentShas: ["2a".repeat(20)],
      message: "chore(cms): save 1 file(s)",
    }
    const first = await gitCommitShaCanonical(input)
    expect(await gitCommitShaCanonical(input)).toBe(first)
    expect(
      await gitCommitShaCanonical({ ...input, message: "chore(cms): save 2 file(s)" }),
    ).not.toBe(first)
    expect(refSha1(Buffer.from(first, "utf8"))).toBeTypeOf("string") // hex-40 sanity input
    expect(first).toMatch(/^[0-9a-f]{40}$/)
  })

  it("rejects malformed paths and colliding file/dir prefixes loudly", async () => {
    await expect(
      gitTreeSha([{ path: "src//x.json", mode: "100644", type: "blob", sha: "a1".repeat(20) }]),
    ).rejects.toThrow(/malformed entry path/)
    await expect(
      gitTreeSha([
        { path: "src/content/site.json", mode: "100644", type: "blob", sha: "a1".repeat(20) },
        { path: "src/content", mode: "100644", type: "blob", sha: "b1".repeat(20) },
      ]),
    ).rejects.toThrow(/path collision/)
  })

  it("pins the canonical empty tree to the constant the empty-repo cache keys on", async () => {
    // GIT_EMPTY_TREE_SHA1 keys the zero-commit repository snapshot (ADR-0011);
    // a WebCrypto convergence regression would silently fork the cache key.
    expect(GIT_EMPTY_TREE_SHA1).toBe("4b825dc642cb6eb9a060e54bf8d69288fbee4904")
    expect(await gitTreeSha([])).toBe(GIT_EMPTY_TREE_SHA1)
  })
})
