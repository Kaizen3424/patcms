/**
 * React composition for deploy-status (ADR-0008 P2.8 appendix).
 *
 * `StatusProvider` owns ONE sha-keyed refcounted registry for the signed-in
 * backend generation. Per-entry chips key reads to the session publish
 * journal; the top-bar banner watches whole-site truth for the current head.
 *
 * Status checking is off when the backend capability or the login probe says
 * so: no watcher is created and the UI renders the off copy (never a spinner
 * loop). Reads degrade to `unavailable`, never to `failed`.
 */

import type {
  CapabilityProbeResult,
  DeployStatusSnapshot,
  GitBackend,
  StatusTiming,
} from "patcms/advanced"
import { createStatusReads } from "patcms/advanced"
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react"
import type { PublishStore } from "./publish-store"
import { createStatusRegistry, type StatusLease, type StatusRegistry } from "./registry"

export interface StatusProviderDeps {
  /** undefined until the login probe answers. */
  readonly probe: CapabilityProbeResult | undefined
  readonly backend: GitBackend | undefined
  readonly branch: string
  /** `deploy.contexts`; empty means the statuses fallback stays off. */
  readonly contexts?: readonly string[]
  /** Session publish journal: `entryId -> latestCommitSha`. */
  readonly publishStore: PublishStore
  /** Host/e2e cadence overrides (ADR-0008 P2.8). */
  readonly statusTiming?: Partial<StatusTiming>
}

export interface UseStatusResult {
  /** undefined before a lease exists or while status checking is off. */
  readonly snapshot: DeployStatusSnapshot | undefined
  /** Support is off (capability or probe) — render the off copy. */
  readonly isDisabled: boolean
}

interface StatusContextValue {
  readonly registry: StatusRegistry | undefined
  readonly publishStore: PublishStore
  /** Whole-site head the banner watches; advances when a save moves it. */
  readonly head: string
  readonly watchHead: (sha: string) => void
  /** False until the login probe has answered. */
  readonly ready: boolean
}

const StatusContext = createContext<StatusContextValue | undefined>(undefined)

const NOOP = (): void => {}

/** Stable seams: the registry memo must not churn on every render. */
const NOW = (): number => Date.now()
const RANDOM = (): number => Math.random()
const SCHEDULE_POLL = (delayMs: number, task: () => void): (() => void) => {
  const id = globalThis.setTimeout(task, delayMs)
  return () => globalThis.clearTimeout(id)
}

export function StatusProvider({
  deps,
  children,
}: {
  readonly deps: StatusProviderDeps
  readonly children: ReactNode
}) {
  const backend = deps.backend
  const branch = deps.branch
  const contexts = deps.contexts
  const timing = deps.statusTiming
  const enabled = backend?.capabilities.commitStatus === true && deps.probe?.checksRead === "ok"

  const registry = useMemo<StatusRegistry | undefined>(() => {
    if (!enabled || backend === undefined) return undefined
    return createStatusRegistry({
      reads: createStatusReads(backend, branch),
      ...(contexts === undefined || contexts.length === 0 ? {} : { contexts }),
      ...(timing === undefined ? {} : { timing }),
      now: NOW,
      schedulePoll: SCHEDULE_POLL,
      random: RANDOM,
    })
  }, [backend, branch, contexts, enabled, timing])

  useEffect(() => {
    if (registry === undefined) return
    return () => registry.dispose()
  }, [registry])

  // Whole-site key: one head read per signed-in generation. A failed read
  // leaves the banner hidden (per-entry chips still prove their own commits).
  const [head, setHead] = useState("")
  useEffect(() => {
    if (!enabled || backend === undefined) {
      setHead("")
      return
    }
    let cancelled = false
    void backend
      .getRef(branch)
      .then((ref) => {
        if (!cancelled) setHead(ref.object.sha)
      })
      .catch(() => {
        // Never a spinner; nothing to key the banner to yet.
      })
    return () => {
      cancelled = true
    }
  }, [backend, branch, enabled])

  const watchHead = useCallback((sha: string) => {
    if (sha.length > 0) setHead(sha)
  }, [])

  const ready = deps.probe !== undefined
  const publishStore = deps.publishStore
  const value = useMemo<StatusContextValue>(
    () => ({ registry, publishStore, head, watchHead, ready }),
    [head, publishStore, ready, registry, watchHead],
  )

  return <StatusContext.Provider value={value}>{children}</StatusContext.Provider>
}

/** Per-entry truth, keyed to the entry's latest published sha. */
export function useEntryStatus(sha: string): UseStatusResult {
  return useShaStatus(useContext(StatusContext), sha)
}

/** Whole-site truth; follows the head forward when a newer save supersedes it. */
export function useSiteStatus(): UseStatusResult {
  const context = useContext(StatusContext)
  const result = useShaStatus(context, context?.head ?? "")
  const supersededBy = result.snapshot?.supersededBy
  useEffect(() => {
    if (context !== undefined && supersededBy !== undefined) context.watchHead(supersededBy)
  }, [context, supersededBy])
  return result
}

/** The entry's latest published sha from the session journal (P2.8). */
export function usePublishedSha(entryId: string): string | undefined {
  const store = useContext(StatusContext)?.publishStore
  const subscribe = useCallback(
    (listener: () => void) => (store === undefined ? NOOP : store.subscribe(listener)),
    [store],
  )
  const getSnapshot = useCallback(() => store?.shaFor(entryId), [entryId, store])
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

function useShaStatus(context: StatusContextValue | undefined, sha: string): UseStatusResult {
  const registry = context?.registry
  const [held, setHeld] = useState<{ readonly sha: string; readonly lease: StatusLease } | null>(
    null,
  )

  useEffect(() => {
    if (registry === undefined || sha.length === 0) {
      setHeld(null)
      return
    }
    const acquired = registry.acquire(sha)
    setHeld({ sha, lease: acquired })
    return () => {
      acquired.release()
    }
  }, [registry, sha])

  // A lease for a DIFFERENT sha must never paint under this key (INV-D03):
  // the one render between a sha change and the effect shows no snapshot.
  const lease = held !== null && held.sha === sha ? held.lease : null
  const subscribe = useCallback(
    (listener: () => void) => (lease === null ? NOOP : lease.subscribe(listener)),
    [lease],
  )
  const getSnapshot = useCallback(() => (lease === null ? undefined : lease.getSnapshot()), [lease])
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)

  if (context === undefined) return { snapshot: undefined, isDisabled: true }
  if (!context.ready) return { snapshot: undefined, isDisabled: false }
  return { snapshot, isDisabled: registry === undefined }
}
