/// <reference lib="dom" />
/**
 * IndexedDB Onboarding store (P5.3).
 * Persists onboarding status (pactDismissed, tourCompleted, firstPublishCompleted)
 * in the shared "mycms" database under the "onboarding" store.
 */
import { get, set } from "idb-keyval"
import { createSharedStore } from "patcms/web"

export interface OnboardingState {
  readonly pactDismissed: boolean
  readonly tourCompleted: boolean
  readonly firstPublishCompleted: boolean
}

export interface OnboardingStore {
  get(): Promise<OnboardingState>
  update(patch: Partial<OnboardingState>): Promise<OnboardingState>
  reset(): Promise<void>
  subscribe(listener: () => void): () => void
}

export interface IdbOnboardingStoreOptions {
  readonly dbName?: string
  readonly storeName?: string
}

const DEFAULT_STATE: OnboardingState = {
  pactDismissed: false,
  tourCompleted: false,
  firstPublishCompleted: false,
}

const STATE_KEY = "status"

export function createIdbOnboardingStore(options: IdbOnboardingStoreOptions = {}): OnboardingStore {
  const store = createSharedStore(options.dbName ?? "mycms", options.storeName ?? "onboarding")
  const listeners = new Set<() => void>()

  const notify = (): void => {
    for (const listener of listeners) {
      try {
        listener()
      } catch {
        // observer immunity
      }
    }
  }

  return {
    async get(): Promise<OnboardingState> {
      try {
        const raw = await get<unknown>(STATE_KEY, store)
        if (typeof raw === "object" && raw !== null) {
          const r = raw as Partial<OnboardingState>
          return {
            pactDismissed: Boolean(r.pactDismissed),
            tourCompleted: Boolean(r.tourCompleted),
            firstPublishCompleted: Boolean(r.firstPublishCompleted),
          }
        }
      } catch {
        // fallback
      }
      return { ...DEFAULT_STATE }
    },

    async update(patch: Partial<OnboardingState>): Promise<OnboardingState> {
      const current = await this.get()
      const next: OnboardingState = {
        pactDismissed: patch.pactDismissed ?? current.pactDismissed,
        tourCompleted: patch.tourCompleted ?? current.tourCompleted,
        firstPublishCompleted: patch.firstPublishCompleted ?? current.firstPublishCompleted,
      }
      try {
        await set(STATE_KEY, next, store)
      } catch {
        // fail-soft
      }
      notify()
      return next
    },

    async reset(): Promise<void> {
      try {
        await set(STATE_KEY, { ...DEFAULT_STATE }, store)
      } catch {
        // fail-soft
      }
      notify()
    },

    subscribe(listener: () => void): () => void {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}

export function createMemoryOnboardingStore(initial?: Partial<OnboardingState>): OnboardingStore {
  let state: OnboardingState = {
    ...DEFAULT_STATE,
    ...initial,
  }
  const listeners = new Set<() => void>()

  const notify = (): void => {
    for (const listener of listeners) {
      try {
        listener()
      } catch {
        // observer immunity
      }
    }
  }

  return {
    async get(): Promise<OnboardingState> {
      return { ...state }
    },

    async update(patch: Partial<OnboardingState>): Promise<OnboardingState> {
      state = {
        pactDismissed: patch.pactDismissed ?? state.pactDismissed,
        tourCompleted: patch.tourCompleted ?? state.tourCompleted,
        firstPublishCompleted: patch.firstPublishCompleted ?? state.firstPublishCompleted,
      }
      notify()
      return { ...state }
    },

    async reset(): Promise<void> {
      state = { ...DEFAULT_STATE }
      notify()
    },

    subscribe(listener: () => void): () => void {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}
