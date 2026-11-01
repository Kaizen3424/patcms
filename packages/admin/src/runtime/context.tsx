/**
 * Runtime composition for the P1 admin: PAT lifecycle, GitHub read transport,
 * immutable snapshot cache, and React Query as the ONLY UI cache (ADR-0001/0002/0004).
 */

import { useQuery, useQueryClient } from "@tanstack/react-query"
import type {
  AdminConfig,
  CapabilityProbeResult,
  DraftStore,
  FetchLike,
  LeaseCarrier,
  Logger,
  SaveCoordinator,
  SaveLease,
  TokenStore,
} from "patcms/advanced"
import {
  createLogger,
  createSaveCoordinator,
  createSaveLease,
  GithubBackend,
  MemoryTokenStore,
  PatProvider,
  probeGithubCapabilities,
  SnapshotStore,
} from "patcms/advanced"
import { createIdbDraftStore, createIdbTokenStore } from "patcms/web"
import type { ReactNode } from "react"
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react"
import type { AdminMountOptions, AdminRepository, SupportContext } from "../admin/types"
import type { StatusProviderDeps } from "../status/provider"
import { StatusProvider } from "../status/provider"
import type { PublishStore } from "../status/publish-store"
import { createPublishStore } from "../status/publish-store"
import type { DiscardStore, JournalStore, OnboardingStore } from "../storage/stores"
import {
  createAutoCarrier,
  createBroadcastCarrier,
  createIdbDiscardStore,
  createIdbJournalStore,
  createIdbOnboardingStore,
  createMemoryDiscardStore,
  createMemoryJournalStore,
  createMemoryOnboardingStore,
} from "../storage/stores"
import { BlobCacheProvider } from "./blob-cache"
import type { EntryIndex } from "./entry-index"
import { loadEntryIndex } from "./entry-index"
import { createMemoryDraftStore } from "./memory-draft-store"

type AuthStatus = "loading" | "signedOut" | "signedIn"

interface RuntimeValue {
  readonly config: AdminConfig
  readonly support: SupportContext
  readonly repository: AdminRepository
  readonly auth: PatProvider
  readonly status: AuthStatus
  readonly probe: CapabilityProbeResult | undefined
  readonly bootNotice: string | undefined
  readonly backend: GithubBackend | undefined
  readonly snapshots: SnapshotStore
  readonly epoch: number
  /** Crash-safety store for editor drafts (IDB, or memory fallback). */
  readonly drafts: DraftStore
  /** Session-only publish journal: entryId → latestCommitSha (P2.8). */
  readonly publishStore: PublishStore
  /** Persistent publish journal store (P5.2). */
  readonly journalStore: JournalStore
  /** Onboarding status store (P5.3). */
  readonly onboardingStore: OnboardingStore
  /** Discard archive store (P5.5). */
  readonly discardStore: DiscardStore
  /** Memory-only diagnostics logger (P5.10). */
  readonly logger: Logger
  /** Save orchestration for this backend generation (P2.6 editor). */
  readonly coordinator: SaveCoordinator | undefined
  /** Cross-tab UX serialization; undefined when no carrier is available. */
  readonly lease: SaveLease | undefined
  readonly signIn: (token: string, remember: boolean) => Promise<CapabilityProbeResult>
  readonly reauthenticate: (token: string, remember: boolean) => Promise<CapabilityProbeResult>
  readonly signOut: () => Promise<void>
}

const RuntimeContext = createContext<RuntimeValue | undefined>(undefined)

interface AdminRuntimeProviderProps {
  readonly options: AdminMountOptions
  readonly children: ReactNode
}

export function AdminRuntimeProvider({ options, children }: AdminRuntimeProviderProps) {
  const queryClient = useQueryClient()
  const repository = options.repository
  const config = options.config
  const fetchLike = useMemo<FetchLike>(() => {
    if (options.fetch !== undefined) return options.fetch
    return globalThis.fetch.bind(globalThis) as unknown as FetchLike
  }, [options.fetch])

  const store = useMemo<TokenStore>(() => {
    if (options.tokenStore !== undefined) return options.tokenStore
    try {
      return createIdbTokenStore()
    } catch {
      return new MemoryTokenStore()
    }
  }, [options.tokenStore])

  const probe = useMemo(
    () => (token: string) =>
      probeGithubCapabilities({
        owner: repository.owner,
        repo: repository.repo,
        branch: repository.branch,
        token,
        fetch: fetchLike,
        ...(repository.baseUrl === undefined ? {} : { baseUrl: repository.baseUrl }),
      }),
    [fetchLike, repository],
  )

  const auth = useMemo(() => new PatProvider({ store, probe }), [probe, store])
  const snapshots = useMemo(
    () => new SnapshotStore(),
    [repository.owner, repository.repo, repository.branch],
  )
  const [status, setStatus] = useState<AuthStatus>("loading")
  const [probeResult, setProbeResult] = useState<CapabilityProbeResult | undefined>(undefined)
  const [bootNotice, setBootNotice] = useState<string | undefined>(undefined)
  const [epoch, setEpoch] = useState(0)

  useEffect(() => {
    let cancelled = false
    void auth
      .restore()
      .then((result) => {
        if (cancelled) return
        if (result === undefined) {
          setStatus("signedOut")
          return
        }
        setProbeResult(result)
        setStatus("signedIn")
        setEpoch((value) => value + 1)
      })
      .catch(() => {
        if (cancelled) return
        setStatus("signedOut")
        setBootNotice(
          "The access key saved on this device could not be checked. Please sign in again.",
        )
      })
    return () => {
      cancelled = true
    }
  }, [auth])

  // Publish journal (P2.8): session-only map, cleared on sign-out. The entry
  // editor populates it from the `published` verdict; status chips key reads off it.
  const publishStore = useMemo(() => createPublishStore(), [])

  // Persistent publish journal store (P5.2) and masked logger (P5.10)
  const journalStore = useMemo(
    () =>
      options.journalStore ??
      (typeof indexedDB !== "undefined" ? createIdbJournalStore() : createMemoryJournalStore()),
    [options.journalStore],
  )
  const onboardingStore = useMemo(
    () =>
      options.onboardingStore ??
      (typeof indexedDB !== "undefined"
        ? createIdbOnboardingStore()
        : createMemoryOnboardingStore()),
    [options.onboardingStore],
  )
  const discardStore = useMemo(
    () =>
      options.discardStore ??
      (typeof indexedDB !== "undefined" ? createIdbDiscardStore() : createMemoryDiscardStore()),
    [options.discardStore],
  )
  const logger = useMemo(() => options.logger ?? createLogger(), [options.logger])

  useEffect(() => {
    void discardStore.evictStale()
  }, [discardStore])

  const signIn = async (token: string, remember: boolean): Promise<CapabilityProbeResult> => {
    const result = await auth.signIn(token, { remember })
    setProbeResult(result)
    setBootNotice(undefined)
    setStatus("signedIn")
    setEpoch((value) => value + 1)
    queryClient.clear()
    return result
  }

  const reauthenticate = async (
    newToken: string,
    remember: boolean,
  ): Promise<CapabilityProbeResult> => {
    const result = await probe(newToken)
    await auth.signIn(newToken, { remember })
    backend?.setToken(newToken)
    setProbeResult(result)
    coordinator?.resumeAuth()
    return result
  }

  const signOut = async (): Promise<void> => {
    await auth.signOut()
    snapshots.clear()
    queryClient.clear()
    publishStore.clear()
    setProbeResult(undefined)
    setStatus("signedOut")
    setEpoch((value) => value + 1)
  }

  const token = status === "signedIn" ? auth.getToken() : undefined
  const backend = useMemo(
    () =>
      token === undefined
        ? undefined
        : new GithubBackend({
            owner: repository.owner,
            repo: repository.repo,
            token,
            fetch: fetchLike,
            ...(repository.baseUrl === undefined ? {} : { baseUrl: repository.baseUrl }),
          }),
    [epoch, fetchLike, repository, token],
  )

  const drafts = useMemo<DraftStore>(() => {
    if (options.draftStore !== undefined) return options.draftStore
    try {
      return createIdbDraftStore()
    } catch {
      return createMemoryDraftStore()
    }
  }, [options.draftStore])

  // One coordinator per backend generation: a sign-out/sign-in cycle bumps
  // `epoch`, so jobs never survive across credentials (ADR-0002 orthogonality).
  const coordinator = useMemo<SaveCoordinator | undefined>(
    () =>
      backend === undefined
        ? undefined
        : createSaveCoordinator({
            backend,
            branch: repository.branch,
            drafts,
            onAfterWriteFailure: (error) => {
              if (error.code === "AUTH_EXPIRED" || error.code === "SCOPE") {
                void auth.reprobe().catch(() => {
                  // Probe failure wipes persisted credentials per ADR-0002
                })
              }
            },
          }),
    [backend, drafts, repository.branch, auth],
  )

  const lease = useMemo<SaveLease | undefined>(() => {
    if (backend === undefined) return undefined
    const carrier = options.leaseCarrier ?? defaultCarrier()
    return carrier === undefined
      ? undefined
      : createSaveLease({
          carrier,
          now: () => Date.now(),
          ...(options.leaseTtlMs === undefined ? {} : { ttlMs: options.leaseTtlMs }),
        })
  }, [backend, options.leaseCarrier, options.leaseTtlMs])

  useEffect(() => {
    if (lease === undefined) return
    return () => lease.dispose()
  }, [lease])

  const statusDeps = useMemo(
    (): StatusProviderDeps => ({
      probe: probeResult,
      backend,
      branch: repository.branch,
      ...(config.deploy?.contexts === undefined ? {} : { contexts: config.deploy.contexts }),
      publishStore,
      ...(options.statusTiming === undefined ? {} : { statusTiming: options.statusTiming }),
    }),
    [backend, config.deploy?.contexts, probeResult, repository.branch, options.statusTiming],
  )

  const value: RuntimeValue = {
    config,
    support: options.support,
    repository,
    auth,
    status,
    probe: probeResult,
    bootNotice,
    backend,
    snapshots,
    epoch,
    drafts,
    publishStore,
    journalStore,
    onboardingStore,
    discardStore,
    logger,
    coordinator,
    lease,
    signIn,
    reauthenticate,
    signOut,
  }

  return (
    <RuntimeContext.Provider value={value}>
      <StatusProvider deps={statusDeps}>
        <BlobCacheProvider backend={backend}>{children}</BlobCacheProvider>
      </StatusProvider>
    </RuntimeContext.Provider>
  )
}

export function useRuntime(): RuntimeValue {
  const value = useContext(RuntimeContext)
  if (value === undefined) throw new Error("useRuntime must be used inside AdminRuntimeProvider")
  return value
}

export function useRuntimeSafe(): RuntimeValue | undefined {
  return useContext(RuntimeContext)
}

export function useJournalStore(): JournalStore {
  return useRuntime().journalStore
}

export function useOnboardingStore(): OnboardingStore {
  return useRuntime().onboardingStore
}

export function useDiscardStore(): DiscardStore {
  return useRuntime().discardStore
}

export function useLogger(): Logger {
  return useRuntime().logger
}

export interface PublishEntryMeta {
  readonly title?: string
  readonly collectionName?: string
  readonly author?: string
  readonly publicUrl?: string
}

/**
 * Captures the `published` verdict's `commitSha` into both the session publish
 * store (for live chips) and the persistent IDB journal (P5.2).
 */
export function usePublishEntry(): (
  entryId: string,
  commitSha: string,
  meta?: PublishEntryMeta,
) => void {
  const { publishStore, journalStore, onboardingStore, support } = useRuntime()
  return useCallback(
    (entryId: string, commitSha: string, meta?: PublishEntryMeta) => {
      publishStore.publish(entryId, commitSha)
      void onboardingStore.update({ firstPublishCompleted: true })
      void journalStore.append({
        commitSha,
        entryId,
        collectionName: meta?.collectionName ?? "content",
        entryTitle: meta?.title ?? entryId,
        path: entryId,
        publishedAt: new Date().toISOString(),
        author: meta?.author ?? "You",
        ...(meta?.publicUrl ? { publicUrl: meta.publicUrl } : {}),
      })
    },
    [publishStore, journalStore, onboardingStore, support.name],
  )
}

/**
 * Lease carrier choice (ADR-0004): BroadcastChannel primary, storage-event
 * fallback for engines without it. No carrier (SSR/exotic) degrades to
 * single-tab editing — the CAS remains the correctness mechanism either way.
 */
function defaultCarrier(): LeaseCarrier | undefined {
  try {
    if (typeof globalThis.BroadcastChannel === "function") return createBroadcastCarrier()
    if (typeof globalThis.localStorage !== "undefined") return createAutoCarrier()
    return undefined
  } catch {
    return undefined
  }
}

export function useSnapshot() {
  const runtime = useRuntimeSafe()
  const backend = runtime?.backend
  const repository = runtime?.repository
  const snapshots = runtime?.snapshots
  const epoch = runtime?.epoch
  return useQuery({
    queryKey: ["snapshot", epoch, repository?.owner, repository?.repo, repository?.branch],
    enabled: backend !== undefined && repository !== undefined && snapshots !== undefined,
    staleTime: 30_000,
    retry: false,
    queryFn: async () => {
      if (backend === undefined || repository === undefined || snapshots === undefined) {
        throw new Error("not signed in")
      }
      const ref = await backend.getRef(repository.branch)
      const head = ref.object.sha
      const cached = snapshots.getTree(head)
      const result = await backend.readTree(
        repository.branch,
        head,
        cached?.etag === undefined ? {} : { etag: cached.etag },
      )
      if (result.kind === "not-modified") {
        if (cached === undefined) throw new Error("tree cache miss on a 304 response")
        snapshots.advance(snapshots.headSha, head)
        return { head, tree: cached.tree }
      }
      snapshots.putTree(head, {
        tree: result.tree,
        ...(result.etag === undefined ? {} : { etag: result.etag }),
      })
      snapshots.advance(snapshots.headSha, head)
      return { head, tree: result.tree }
    },
  })
}

export function useEntryIndex() {
  const { config, backend, repository, epoch } = useRuntime()
  const snapshot = useSnapshot()
  const head = snapshot.data?.head
  const tree = snapshot.data?.tree
  return useQuery({
    queryKey: ["entries", epoch, repository.owner, repository.repo, repository.branch, head],
    enabled: backend !== undefined && tree !== undefined,
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
    queryFn: async (): Promise<EntryIndex> => {
      if (backend === undefined || tree === undefined) throw new Error("snapshot not ready")
      return loadEntryIndex({ config, tree, backend, branch: repository.branch })
    },
  })
}
