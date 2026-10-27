/// <reference types="node" />
import { describe, expect, it } from "vitest"
import { createOneFlightQueue } from "../one-flight"

/**
 * P2.5 — the one-flight queue's own contract (INV-P04 foundation): FIFO
 * drain, a rejected tail NEVER wedges the queue, and the pending/draining
 * counters are observable.
 */
describe("createOneFlightQueue", () => {
  it("drains FIFO; a rejected tail does not wedge the next submit", async () => {
    const queue = createOneFlightQueue()
    const order: string[] = []
    const boom = queue.submit(async () => {
      order.push("a")
      throw new Error("boom")
    })
    const second = queue.submit(async () => {
      order.push("b")
      return "b"
    })

    await expect(boom).rejects.toThrow("boom")
    await expect(second).resolves.toBe("b")
    expect(order).toEqual(["a", "b"])
  })

  it("reports pending/draining across a stalled head", async () => {
    const queue = createOneFlightQueue()
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const first = queue.submit(() => gate.then(() => "x"))
    expect(queue.pending).toBe(1) // counted at submit, drained in finally
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(queue.draining).toBe(true)

    const second = queue.submit(async () => "y")
    expect(queue.pending).toBe(2)

    release()
    expect(await first).toBe("x")
    expect(await second).toBe("y")
    expect(queue.pending).toBe(0)
    expect(queue.draining).toBe(false)
  })
})
