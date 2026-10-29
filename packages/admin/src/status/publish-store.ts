/**
 * Session-only publish journal (ADR-0008 P2.8 appendix) —
 * `entryId → latestCommitSha`, filled from the `published` verdict.
 *
 * A reload starts empty; a persistent publish journal is P5.2 work and an
 * explicit non-goal of P2.8. Framework-free: plain Map + subscriber set.
 */
export interface PublishStore {
  publish(entryId: string, sha: string): void
  shaFor(entryId: string): string | undefined
  subscribe(listener: () => void): () => void
  clear(): void
}

export function createPublishStore(): PublishStore {
  const shas = new Map<string, string>()
  const listeners = new Set<() => void>()

  const notify = (): void => {
    for (const listener of listeners) listener()
  }

  return {
    publish(entryId, sha) {
      if (shas.get(entryId) === sha) return
      shas.set(entryId, sha)
      notify()
    },
    shaFor(entryId) {
      return shas.get(entryId)
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    clear() {
      if (shas.size === 0) return
      shas.clear()
      notify()
    },
  }
}
