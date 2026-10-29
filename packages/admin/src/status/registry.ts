/**
 * Sha-keyed refcounted status registry (ADR-0008 P2.8 appendix).
 *
 * One watcher per sha; `acquire(sha) → lease` refcounts it so N consumers
 * published in one sweep share a single poller. Terminal watchers stop
 * themselves; the last release stops the watcher and drops the snapshot.
 *
 * Framework-free: no React, no globals. Timing/randomness enter through the
 * same injected seams the core watcher uses.
 */

import type { DeployStatusSnapshot, StatusReads, StatusTiming } from "@mycms/core"
import { createStatusWatcher, type StatusWatcher } from "@mycms/core"

export interface StatusRegistryOptions {
  readonly reads: StatusReads
  readonly contexts?: readonly string[]
  readonly timing?: Partial<StatusTiming>
  readonly now: () => number
  readonly schedulePoll: (delayMs: number, task: () => void) => () => void
  readonly random: () => number
}

export interface StatusLease {
  getSnapshot(): DeployStatusSnapshot
  subscribe(listener: () => void): () => void
  release(): void
}

export interface StatusRegistry {
  acquire(sha: string): StatusLease
  dispose(): void
}

interface Entry {
  readonly watcher: StatusWatcher
  readonly listeners: Set<() => void>
  refs: number
}

export function createStatusRegistry(options: StatusRegistryOptions): StatusRegistry {
  const entries = new Map<string, Entry>()

  function acquire(sha: string): StatusLease {
    let entry = entries.get(sha)
    if (entry === undefined) {
      const listeners = new Set<() => void>()
      const watcher = createStatusWatcher({
        sha,
        reads: options.reads,
        ...(options.contexts === undefined || options.contexts.length === 0
          ? {}
          : { contexts: options.contexts }),
        ...(options.timing === undefined ? {} : { timing: options.timing }),
        now: options.now,
        schedulePoll: options.schedulePoll,
        random: options.random,
        onChange: () => {
          for (const listener of listeners) listener()
        },
      })
      entry = { watcher, listeners, refs: 0 }
      entries.set(sha, entry)
      watcher.start()
    }
    entry.refs += 1
    const current = entry
    let released = false
    return {
      getSnapshot: () => current.watcher.getSnapshot(),
      subscribe: (listener) => {
        current.listeners.add(listener)
        return () => {
          current.listeners.delete(listener)
        }
      },
      release: () => {
        if (released) return
        released = true
        current.refs -= 1
        if (current.refs <= 0) {
          current.watcher.stop()
          entries.delete(sha)
        }
      },
    }
  }

  return {
    acquire,
    dispose() {
      for (const entry of entries.values()) entry.watcher.stop()
      entries.clear()
    },
  }
}
