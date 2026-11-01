/**
 * `createCMS()` — the one entry point a host needs.
 *
 * Construction is offline: a `token` seeds the client without a probe, and no
 * network call happens until an entry or media operation runs. Signing in with
 * `auth.signIn(token)` probes capabilities first and throws `CMSError` when the
 * token cannot write to the repository.
 */

import type { TokenStore } from "../auth"
import { GithubBackend } from "../backends/github"
import type { FetchLike } from "../composition"
import { toAdminConfig } from "../config/document"
import type { AdminConfig, ConfigDefinition } from "../config/types"
import type { DraftStore } from "../drafts"
import { createMemoryDraftStore } from "../drafts/memory-store"
import { AuthController, defaultTokenStore } from "./auth"
import { ClientCache } from "./cache"
import { DraftsClient } from "./drafts"
import { EntriesClient } from "./entries"
import { CMSError, toCMSError } from "./errors"
import { EventBus } from "./events"
import { MediaClient } from "./media"
import { RepoReader } from "./repo"
import type { CMS, CMSEventMap, EntriesAPI, MediaAPI, RepositoryTarget } from "./types"

export interface CreateCMSOptions {
  /** Output of `defineConfig(...)`, or an already-projected `AdminConfig`. */
  readonly config: ConfigDefinition | AdminConfig
  readonly repository: RepositoryTarget
  /** Pre-set PAT. No probe runs until `auth.verify()`; useful for scripts. */
  readonly token?: string
  /** Token persistence. Defaults to memory-only. */
  readonly tokenStore?: TokenStore
  /** Draft persistence. Defaults to memory-only; `patcms/web` adds IndexedDB. */
  readonly drafts?: DraftStore
  /** Custom transport (tests, proxies). Defaults to `globalThis.fetch`. */
  readonly fetch?: FetchLike
  /** Called after a 401 write wiped the session. */
  readonly onAuthExpired?: () => void
}

export function createCMS(options: CreateCMSOptions): CMS {
  const config = isAdminConfig(options.config) ? options.config : toAdminConfig(options.config)
  const repository = options.repository
  const fetch = resolveFetch(options.fetch)
  const cache = new ClientCache()
  const bus = new EventBus<CMSEventMap>()

  const auth = new AuthController({
    repository,
    tokenStore: options.tokenStore ?? defaultTokenStore(),
    fetch,
  })
  if (options.token !== undefined) auth.seed(options.token)

  const backend = new GithubBackend({
    owner: repository.owner,
    repo: repository.repo,
    token: () => auth.currentToken,
    fetch,
    ...(repository.baseUrl === undefined ? {} : { baseUrl: repository.baseUrl }),
  })

  const requireToken = (): void => {
    if (!auth.isSignedIn) {
      throw new CMSError("AUTH_REQUIRED", "sign in with a GitHub token first")
    }
  }
  const onAuthExpired = (): void => {
    auth.markExpired()
    options.onAuthExpired?.()
  }

  const repo = new RepoReader(backend, repository.branch, cache, requireToken)
  const entriesClient = new EntriesClient({ config, repo, cache, onAuthExpired })
  const mediaClient = new MediaClient({
    config,
    repo,
    cache,
    searchable: () => entriesClient.searchable(),
    onAuthExpired,
  })
  const draftsClient = new DraftsClient({
    store: options.drafts ?? createMemoryDraftStore(),
    namespace: `${repository.owner}/${repository.repo}`,
  })

  auth.onChange((status) => {
    bus.emit("auth:change", { status })
  })

  return {
    config,
    repository,
    auth,
    entries: withEntryEvents(entriesClient, bus),
    media: withMediaEvents(mediaClient, bus),
    drafts: draftsClient,
    events: {
      on: (event, handler) => bus.on(event, handler),
    },
    async refresh(): Promise<void> {
      cache.clear()
      if (auth.isSignedIn) await repo.tree()
    },
    clearCache(): void {
      cache.clear()
    },
    destroy(): void {
      cache.clear()
      bus.clear()
    },
  }
}

// ---- event decorators ----------------------------------------------------

function withEntryEvents(inner: EntriesAPI, bus: EventBus<CMSEventMap>): EntriesAPI {
  return {
    list: (collection, options) => inner.list(collection, options),
    listPaths: (collection) => inner.listPaths(collection),
    get: (collection, slug) => inner.get(collection, slug),
    create: async (collection, value, options) => {
      try {
        const result = await inner.create(collection, value, options)
        if (result.status === "conflict") {
          bus.emit("save:conflict", { entry: result.current, current: result.current })
        } else {
          bus.emit("save:success", { entry: result.entry, result })
        }
        return result
      } catch (error) {
        throw toCMSError(error)
      }
    },
    save: async (entry, value, options) => {
      bus.emit("save:start", { entry })
      try {
        const result = await inner.save(entry, value, options)
        if (result.status === "conflict") {
          bus.emit("save:conflict", { entry, current: result.current })
        } else {
          bus.emit("save:success", { entry: result.entry, result })
        }
        return result
      } catch (error) {
        const cmsError = toCMSError(error)
        bus.emit("save:error", { entry, error: cmsError })
        throw cmsError
      }
    },
    delete: (entry, options) => inner.delete(entry, options),
    validate: (entry, value) => inner.validate(entry, value),
    path: (collection, slug) => inner.path(collection, slug),
    slugFromValue: (collection, value) => inner.slugFromValue(collection, value),
  }
}

function withMediaEvents(inner: MediaAPI, bus: EventBus<CMSEventMap>): MediaAPI {
  return {
    list: (options) => inner.list(options),
    get: (publicPath, options) => inner.get(publicPath, options),
    upload: async (input, options) => {
      const file = await inner.upload(input, options)
      bus.emit("media:upload", { file })
      return file
    },
    delete: async (publicPath, options) => {
      const result = await inner.delete(publicPath, options)
      if (result.status === "deleted") bus.emit("media:delete", { path: publicPath })
      return result
    },
    restore: (trashPath, options) => inner.restore(trashPath, options),
    references: (publicPath, options) => inner.references(publicPath, options),
    publicPath: (repoPath, options) => inner.publicPath(repoPath, options),
    repoPath: (publicPath, options) => inner.repoPath(publicPath, options),
  }
}

// ---- helpers -------------------------------------------------------------

function isAdminConfig(config: ConfigDefinition | AdminConfig): config is AdminConfig {
  for (const collection of config.collections) {
    if (collection.kind === "divider") continue
    return "fields" in collection
  }
  return true
}

function resolveFetch(provided?: FetchLike): FetchLike {
  if (provided !== undefined) return provided
  const candidate = (globalThis as { fetch?: unknown }).fetch
  if (typeof candidate !== "function") {
    throw new CMSError("INVALID_CONFIG", "global fetch is unavailable; pass options.fetch")
  }
  // Browsers throw "Illegal invocation" when fetch runs unbound; Node is
  // unaffected. Bind so a host can rely on the default transport directly.
  return (candidate as (...args: unknown[]) => unknown).bind(globalThis) as FetchLike
}
