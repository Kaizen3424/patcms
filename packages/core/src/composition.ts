/**
 * Transport seams — DOM/node lib-free, so core imports no DOM globals. MSW and
 * test fakes satisfy `FetchLike` structurally; the GitHub client adapts
 * `globalThis.fetch` into it.
 */
export interface FetchResponseLike {
  readonly ok: boolean
  readonly status: number
  readonly statusText: string
  readonly headers: { get(name: string): string | null }
  json(): Promise<unknown>
  text(): Promise<string>
}

export interface FetchRequestInitLike {
  readonly method?: string
  readonly headers?: Record<string, string>
  readonly body?: string | Uint8Array
  /**
   * Standard fetch cache mode. The SDK sends "no-store" on branch-addressed
   * GETs (refs, contents) because GitHub answers them with `max-age=60` and a
   * browser HTTP cache would otherwise serve a stale head for up to a minute.
   * SHA-addressed reads stay cacheable; fakes may ignore the field.
   */
  readonly cache?: "no-store"
}

export type FetchLike = (input: string, init?: FetchRequestInitLike) => Promise<FetchResponseLike>
