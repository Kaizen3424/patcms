import type { CMS, MediaFolders } from "patcms"
import { createContext, useContext } from "react"

/**
 * Everything a widget needs beyond its own value: the client instance, the
 * collection being edited, and the media folders that apply to it.
 */
export interface PanelScope {
  readonly cms: CMS
  readonly collection: string
  readonly media: MediaFolders
}

export const PanelScopeContext = createContext<PanelScope | undefined>(undefined)

export function usePanelScope(): PanelScope {
  const scope = useContext(PanelScopeContext)
  if (scope === undefined) throw new Error("panel widget rendered outside PanelScopeContext")
  return scope
}
