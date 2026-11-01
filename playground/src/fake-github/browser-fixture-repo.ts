/**
 * Browser fixture loader — fetches the SAME manifest + bytes the node loader
 * uses. Vite serves /fixtures/repo/** and /images/** from the mirror.
 */
import { decodeUtf8 } from "patcms/advanced"
import type {
  FixtureRepoFile,
  FixtureRepoManifest,
  FixtureRepoMeta,
  FixtureRepoSnapshot,
} from "./fixture-repo"

export interface BrowserFixtureOptions {
  readonly baseUrl?: string
  readonly fetch?: typeof fetch
}

export async function loadFixtureRepoFromBrowser(
  options: BrowserFixtureOptions = {},
): Promise<FixtureRepoSnapshot> {
  const baseUrl = (options.baseUrl ?? "/fixtures/repo").replace(/\/+$/, "")
  const fetchLike = options.fetch ?? globalThis.fetch.bind(globalThis)

  const [meta, manifest] = await Promise.all([
    fetchJson<FixtureRepoMeta>(`${baseUrl}/meta.json`, fetchLike),
    fetchJson<FixtureRepoManifest>(`${baseUrl}/manifest.json`, fetchLike),
  ])
  if (typeof meta.defaultBranch !== "string" || !/^[0-9a-f]{40}$/.test(meta.headSha)) {
    throw new Error("fixture meta is malformed")
  }
  if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
    throw new Error("fixture manifest is malformed")
  }

  const entries = new Map<string, FixtureRepoFile>()
  const files = new Map<string, string>()
  await Promise.all(
    manifest.files.map(async (item) => {
      const response = await fetchLike(`${baseUrl}/${item.path}`)
      if (!response.ok) throw new Error(`fixture fetch failed (${response.status}): ${item.path}`)
      const bytes = new Uint8Array(await response.arrayBuffer())
      if (bytes.byteLength !== item.bytes) {
        throw new Error(`fixture byte length mismatch: ${item.path}`)
      }
      entries.set(item.path, {
        path: item.path,
        bytes,
        sha: item.sha,
        etag: `"${item.sha}"`,
      })
      files.set(item.path, decodeUtf8(bytes))
    }),
  )

  return {
    defaultBranch: meta.defaultBranch,
    headSha: meta.headSha,
    treeSha: meta.treeSha,
    files,
    entries,
    manifest,
  }
}

async function fetchJson<T>(url: string, fetchLike: typeof fetch): Promise<T> {
  const response = await fetchLike(url)
  if (!response.ok) throw new Error(`fixture fetch failed (${response.status}): ${url}`)
  return (await response.json()) as T
}
