import type { CMS, CreateCMSOptions, DraftStore, RepositoryTarget, TokenStore } from "patcms"

/** Navigation state of the panel — no router library, just a discriminated union. */
export type PanelView =
  | { readonly kind: "library"; readonly collection: string }
  | { readonly kind: "entry"; readonly collection: string; readonly slug: string }
  | { readonly kind: "new"; readonly collection: string }
  | { readonly kind: "media" }

export interface PanelOptions {
  /** Output of `defineConfig(...)`, or an already-projected `AdminConfig`. */
  readonly config: CreateCMSOptions["config"]
  readonly repository: RepositoryTarget
  /** Token persistence. Defaults to IndexedDB in the browser, memory elsewhere. */
  readonly tokenStore?: TokenStore
  /** Draft persistence. Defaults to IndexedDB in the browser, memory elsewhere. */
  readonly drafts?: DraftStore
  /** Override the HTTP transport (the harness uses this to guard the fake). */
  readonly fetch?: CreateCMSOptions["fetch"]
  readonly title?: string
}

export interface PanelHandle {
  readonly cms: CMS
  destroy(): void
}
