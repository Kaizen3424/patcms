/**
 * One-flight queue — INV-P04 (ADR-0004 C.3 pins): overlapping saves for a
 * repo+branch drain FIFO; each drained job funnels through exactly ONE
 * `updateRef`; the next job's fresh `getRef` (inside runSave) re-bases it on
 * its predecessor's commit, so a queued save never false-conflicts against
 * the save that preceded it.
 */

export interface OneFlightQueue {
  submit<T>(task: () => Promise<T>): Promise<T>
  /** Jobs waiting for their turn (excludes the running one). */
  readonly pending: number
  /** True while a job is in flight. */
  readonly draining: boolean
}

export function createOneFlightQueue(): OneFlightQueue {
  let tail: Promise<unknown> = Promise.resolve()
  let pending = 0
  let running = false

  return {
    submit<T>(task: () => Promise<T>): Promise<T> {
      pending += 1
      const run = tail.then(
        () => {
          running = true
          return task()
        },
        () => {
          running = true
          return task()
        },
      )
      tail = run.then(
        () => undefined,
        () => undefined,
      )
      return run.finally(() => {
        pending -= 1
        running = false
      })
    },
    get pending(): number {
      return pending
    },
    get draining(): boolean {
      return running
    },
  }
}
