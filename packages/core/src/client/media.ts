/**
 * Media — repository files under the configured media folder, addressed by
 * their public URL path.
 *
 * Guards kept from the reference admin: the path bijection (no traversal, no
 * prefix escapes), the 90 MiB client cap, SVG refusal, collision protection,
 * and referential integrity on delete (soft-delete into `_trash/`).
 */
import { gitBlobSha } from "../backend/git-sha"
import type { TreeEntryTuple, TreeRead } from "../backend/types"
import type { BackendWriteError } from "../backend/write-errors"
import type { AdminConfig, MediaFolders } from "../config/types"
import { publicPathToRepoPath, repoPathToPublicPath, resolveMediaFolders } from "../media/bijection"
import { isUploadSizeBlocked } from "../media/budget"
import { createRestoreChanges, createTrashChanges, TRASH_PREFIX } from "../media/delete-ladder"
import type { SearchableEntry } from "../media/references"
import { findReferences } from "../media/references"
import type { ReferenceLocation } from "../media/types"
import type { SaveVerdict } from "../pipeline/save-driver"
import { safePath } from "../safety/safe-path"
import type { ClientCache } from "./cache"
import { CMSError, toCMSError } from "./errors"
import type { RepoReader } from "./repo"
import type {
  MediaAPI,
  MediaBlob,
  MediaDeleteOptions,
  MediaDeleteResult,
  MediaFile,
  MediaListOptions,
  MediaUploadInput,
  UploadOptions,
} from "./types"

export interface MediaClientOptions {
  readonly config: AdminConfig
  readonly repo: RepoReader
  readonly cache: ClientCache
  readonly searchable: () => Promise<readonly SearchableEntry[]>
  readonly onAuthExpired: () => void
}

export class MediaClient implements MediaAPI {
  readonly #config: AdminConfig
  readonly #repo: RepoReader
  readonly #cache: ClientCache
  readonly #searchable: () => Promise<readonly SearchableEntry[]>
  readonly #onAuthExpired: () => void

  constructor(options: MediaClientOptions) {
    this.#config = options.config
    this.#repo = options.repo
    this.#cache = options.cache
    this.#searchable = options.searchable
    this.#onAuthExpired = options.onAuthExpired
  }

  async list(options: MediaListOptions = {}): Promise<MediaFile[]> {
    const tree = await this.#repo.tree()
    const files: MediaFile[] = []
    const seen = new Set<string>()

    for (const media of this.#folders(options.collection)) {
      const prefix = `${media.folder.replace(/\/+$/, "")}/`
      for (const entry of tree.entries) {
        if (entry.type !== "blob") continue
        if (!entry.path.startsWith(prefix) || entry.path.startsWith(TRASH_PREFIX)) continue
        if (seen.has(entry.path)) continue
        seen.add(entry.path)
        files.push({
          path: entry.path,
          publicPath:
            options.collection === undefined
              ? this.#publicPathAny(entry.path)
              : this.publicPath(entry.path, options),
          name: entry.path.slice(prefix.length),
          sha: entry.sha,
          size: entry.size ?? 0,
        })
      }
    }

    files.sort((left, right) => left.path.localeCompare(right.path))
    return files
  }

  async get(publicPath: string, options: MediaListOptions = {}): Promise<MediaBlob> {
    const repoPath = this.repoPath(publicPath, options)
    const tuple = await this.#tuple(repoPath)
    const bytes = await this.#repo.readBlob(tuple.sha)
    return { bytes, type: mimeFor(repoPath) }
  }

  async upload(input: MediaUploadInput, options: UploadOptions = {}): Promise<MediaFile> {
    const media = resolveMediaFolders(this.#config, options.collection)
    const name = sanitizeFileName(input.name)

    if (input.bytes.byteLength === 0) {
      throw new CMSError("VALIDATION", "cannot upload an empty file")
    }
    if (isUploadSizeBlocked(input.bytes.byteLength)) {
      throw new CMSError("VALIDATION", "file exceeds the 90 MiB upload limit")
    }
    if (isSvg(name) && options.allowSvg !== true) {
      throw new CMSError("VALIDATION", "SVG uploads are disabled; pass allowSvg to override")
    }

    const publicPath = joinPublic(media.publicFolder, name)
    const repoPath = this.repoPath(publicPath, options)
    const tree = await this.#repo.tree()
    const existing = findTreeEntry(tree, repoPath)
    if (existing !== undefined && options.overwrite !== true) {
      throw new CMSError("CONFLICT", `"${publicPath}" already exists; pass overwrite to replace it`)
    }

    const sha = await gitBlobSha(input.bytes)
    const verdict = await this.#repo.save(
      existing === undefined
        ? { adds: [{ path: repoPath, bytes: input.bytes }] }
        : { updates: [{ path: repoPath, bytes: input.bytes }] },
      options.message,
      this.#afterWriteFailure,
    )
    if (verdict.kind !== "published" && verdict.kind !== "noop") throw verdictError(verdict)

    this.#cache.putBlob(sha, input.bytes)
    return {
      path: repoPath,
      publicPath,
      name,
      sha,
      size: input.bytes.byteLength,
    }
  }

  async delete(publicPath: string, options: MediaDeleteOptions = {}): Promise<MediaDeleteResult> {
    const repoPath = this.repoPath(publicPath, options)
    const tuple = await this.#tuple(repoPath)

    if (options.checkReferences !== false) {
      const references = await this.references(publicPath, options)
      if (references.length > 0) return { status: "referenced", references }
    }

    const bytes = await this.#repo.readBlob(tuple.sha)
    const verdict = await this.#repo.save(
      createTrashChanges(repoPath, bytes),
      options.message,
      this.#afterWriteFailure,
    )
    if (verdict.kind === "published") {
      return { status: "deleted", commitSha: verdict.commitSha }
    }
    if (verdict.kind === "noop") {
      throw new CMSError("CONFLICT", `"${publicPath}" moved while it was being deleted`)
    }
    throw verdictError(verdict)
  }

  async restore(trashPath: string, options: { message?: string } = {}): Promise<MediaFile> {
    const normalized = normalizeTrashPath(trashPath)
    const tuple = await this.#tuple(normalized)
    const bytes = await this.#repo.readBlob(tuple.sha)
    const tree = await this.#repo.tree()
    const changes = createRestoreChanges(normalized, bytes, tree.entries)
    if (!changes.ok) {
      throw new CMSError("CONFLICT", `"${changes.destination}" is occupied; cannot restore`)
    }

    const verdict = await this.#repo.save(changes.changes, options.message, this.#afterWriteFailure)
    if (verdict.kind !== "published" && verdict.kind !== "noop") throw verdictError(verdict)

    this.#cache.putBlob(tuple.sha, bytes)
    return {
      path: changes.destination,
      publicPath: this.#publicPathAny(changes.destination),
      name: changes.destination.slice(changes.destination.lastIndexOf("/") + 1),
      sha: tuple.sha,
      size: bytes.byteLength,
    }
  }

  async references(
    publicPath: string,
    options: MediaListOptions = {},
  ): Promise<readonly ReferenceLocation[]> {
    const media = resolveMediaFolders(this.#config, options.collection)
    const repoPath = this.repoPath(publicPath, options)
    const canonical = repoPathToPublicPath(repoPath, media)
    const targetPath = canonical.ok ? canonical.value : publicPath
    const entries = await this.#searchable()
    return findReferences({ targetPath }, entries, this.#config)
  }

  publicPath(repoPath: string, options: MediaListOptions = {}): string {
    const media = resolveMediaFolders(this.#config, options.collection)
    const result = repoPathToPublicPath(repoPath, media)
    if (!result.ok) {
      throw new CMSError(
        "VALIDATION",
        `"${repoPath}" is not inside the media folder "${media.folder}"`,
      )
    }
    return result.value
  }

  repoPath(publicPath: string, options: MediaListOptions = {}): string {
    const media = resolveMediaFolders(this.#config, options.collection)
    const result = publicPathToRepoPath(publicPath, media)
    if (!result.ok) {
      throw new CMSError(
        "VALIDATION",
        `"${publicPath}" is not inside the public folder "${media.publicFolder}"`,
      )
    }
    return result.value
  }

  // ---- helpers -----------------------------------------------------------

  #folders(collection?: string): readonly MediaFolders[] {
    if (collection !== undefined) return [resolveMediaFolders(this.#config, collection)]

    const folders: MediaFolders[] = [this.#config.media]
    const seen = new Set([this.#config.media.folder])
    for (const candidate of this.#config.collections) {
      if (candidate.kind === "divider" || candidate.media === undefined) continue
      if (seen.has(candidate.media.folder)) continue
      seen.add(candidate.media.folder)
      folders.push(candidate.media)
    }
    return folders
  }

  #publicPathAny(repoPath: string): string {
    for (const media of this.#folders()) {
      const result = repoPathToPublicPath(repoPath, media)
      if (result.ok) return result.value
    }
    throw new CMSError("VALIDATION", `"${repoPath}" is not inside any configured media folder`)
  }

  async #tuple(path: string): Promise<TreeEntryTuple> {
    const checked = safePath(path)
    if (!checked.ok) throw new CMSError("VALIDATION", `invalid media path "${path}"`)
    const tree = await this.#repo.tree()
    const tuple = findTreeEntry(tree, path)
    if (tuple === undefined) throw new CMSError("NOT_FOUND", `"${path}" does not exist`)
    return tuple
  }

  #afterWriteFailure = (error: BackendWriteError): void => {
    if (error.code === "AUTH_EXPIRED") this.#onAuthExpired()
  }
}

// ---- helpers -------------------------------------------------------------

const MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  ".avif": "image/avif",
  ".gif": "image/gif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
}

function mimeFor(path: string): string | undefined {
  const dot = path.lastIndexOf(".")
  if (dot < 0) return undefined
  return MIME_BY_EXTENSION[path.slice(dot).toLowerCase()]
}

function isSvg(name: string): boolean {
  return name.toLowerCase().endsWith(".svg")
}

function joinPublic(folder: string, name: string): string {
  const base = folder.endsWith("/") ? folder.slice(0, -1) : folder
  return `${base}/${name}`
}

function normalizeTrashPath(path: string): string {
  const clean = path.replace(/^\/+/, "")
  return clean.startsWith(TRASH_PREFIX) ? clean : `${TRASH_PREFIX}${clean}`
}

/**
 * Strips directory parts and characters that are illegal or ambiguous in a
 * repository path. Case and extension are preserved; the result is never empty.
 */
function sanitizeFileName(input: string): string {
  const base = input.normalize("NFKC").replace(/\\/g, "/").split("/").pop() ?? ""
  const cleaned = stripControlCharacters(base)
    .replace(/[<>:"|?*]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[.\-\s]+|[.\-\s]+$/g, "")
  if (cleaned.length === 0) {
    throw new CMSError("VALIDATION", "file name is empty after sanitising")
  }
  return cleaned.slice(0, 120)
}

function stripControlCharacters(value: string): string {
  let out = ""
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0
    if (code > 0x1f && code !== 0x7f) out += character
  }
  return out
}

function findTreeEntry(tree: TreeRead, path: string): TreeEntryTuple | undefined {
  return tree.entries.find((entry) => entry.path === path)
}

function verdictError(verdict: SaveVerdict): CMSError {
  switch (verdict.kind) {
    case "parked":
      return new CMSError("RATE_LIMIT", "GitHub rate limit reached; retry later", {
        ...(verdict.error.resetAt === undefined ? {} : { retryAt: verdict.error.resetAt }),
        cause: verdict.error,
      })
    case "conflict":
      return new CMSError("CONFLICT", "the repository changed during the write; retry")
    case "failed":
      return toCMSError(verdict.error)
    case "cancelled":
      return new CMSError("UNKNOWN", "save was cancelled")
    default:
      return new CMSError("UNKNOWN", `unexpected save verdict "${verdict.kind}"`)
  }
}
