/**
 * Bounded parallel map — the one pool used by read and write paths.
 *
 * GitHub's secondary rate limits penalise request bursts, so callers never
 * fan out with an unbounded `Promise.all`. Order of results matches the input.
 */
export async function mapConcurrent<T, R>(
  items: readonly T[],
  limit: number,
  task: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return []
  const width = Math.max(1, Math.min(Math.trunc(limit), items.length))
  const results = new Array<R>(items.length)
  let cursor = 0
  const workers = Array.from({ length: width }, async () => {
    for (;;) {
      const index = cursor
      if (index >= items.length) return
      cursor += 1
      results[index] = await task(items[index] as T, index)
    }
  })
  await Promise.all(workers)
  return results
}
