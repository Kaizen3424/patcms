/**
 * `mountPanel` — the example's one mount call, mirroring how a host adopts
 * `createCMS()`: build the client, pick the persistence stores, render.
 *
 * The panel imports ONLY `patcms`, `patcms/web`, `react`, and `react-dom`;
 * an import-rule test fails the suite when that ever drifts.
 */

import { createCMS } from "patcms"
import { createIdbDraftStore, createIdbTokenStore } from "patcms/web"
import { createRoot } from "react-dom/client"
import { PanelApp } from "./App"
import "./panel.css"
import type { PanelHandle, PanelOptions } from "./types"

export function mountPanel(element: HTMLElement, options: PanelOptions): PanelHandle {
  const browser = typeof indexedDB !== "undefined"
  const tokenStore = options.tokenStore ?? (browser ? createIdbTokenStore() : undefined)
  const drafts = options.drafts ?? (browser ? createIdbDraftStore() : undefined)

  const cms = createCMS({
    config: options.config,
    repository: options.repository,
    ...(tokenStore === undefined ? {} : { tokenStore }),
    ...(drafts === undefined ? {} : { drafts }),
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
  })

  const root = createRoot(element)
  root.render(<PanelApp cms={cms} title={options.title ?? "patcms panel"} />)

  return {
    cms,
    destroy(): void {
      root.unmount()
      cms.destroy()
    },
  }
}
