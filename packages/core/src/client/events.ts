/** Small typed event bus. Listeners are UI notifications, never a second cache. */
export type EventListener<T> = (payload: T) => void
export type Unsubscribe = () => void

export class EventBus<M extends object> {
  readonly #listeners = new Map<keyof M, Set<EventListener<never>>>()

  on<K extends keyof M>(event: K, handler: EventListener<M[K]>): Unsubscribe {
    let listeners = this.#listeners.get(event)
    if (listeners === undefined) {
      listeners = new Set()
      this.#listeners.set(event, listeners)
    }
    const stored = handler as EventListener<never>
    listeners.add(stored)
    return () => {
      listeners.delete(stored)
    }
  }

  emit<K extends keyof M>(event: K, payload: M[K]): void {
    const listeners = this.#listeners.get(event)
    if (listeners === undefined) return
    // Snapshot so a handler that unsubscribes cannot disturb this dispatch.
    for (const handler of [...listeners]) {
      ;(handler as EventListener<M[K]>)(payload)
    }
  }

  clear(): void {
    this.#listeners.clear()
  }
}
