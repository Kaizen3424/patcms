/**
 * Panel shell — auth gate, sidebar navigation, screen switching. The client
 * instance arrives fully constructed; this component only renders state the
 * client already exposes.
 */

import type { CMS } from "patcms"
import { useEffect, useState } from "react"
import { EntryScreen } from "./screens/EntryScreen"
import { LibraryScreen } from "./screens/LibraryScreen"
import { LoginScreen } from "./screens/LoginScreen"
import { MediaScreen } from "./screens/MediaScreen"
import { NewEntryScreen } from "./screens/NewEntryScreen"
import type { PanelView } from "./types"

export function PanelApp({ cms, title }: { cms: CMS; title: string }) {
  const [status, setStatus] = useState(cms.auth.status)
  const [view, setView] = useState<PanelView | undefined>(undefined)

  useEffect(() => cms.auth.onChange(setStatus), [cms])
  useEffect(() => {
    void cms.auth.restore()
  }, [cms])

  // Default view: the first non-divider collection, once signed in.
  useEffect(() => {
    if (status !== "signedIn") {
      setView(undefined)
      return
    }
    setView((current) => {
      if (current !== undefined) return current
      const first = cms.config.collections.find((candidate) => candidate.kind !== "divider")
      return first === undefined ? { kind: "media" } : { kind: "library", collection: first.name }
    })
  }, [cms, status])

  if (status !== "signedIn") {
    return <LoginScreen cms={cms} checking={status === "checking"} />
  }

  const session = cms.auth.session
  return (
    <div className="panel-shell">
      <aside className="panel-sidebar">
        <div className="panel-brand">{title}</div>
        <nav className="panel-nav">
          {cms.config.collections.map((collection) => {
            if (collection.kind === "divider") {
              return collection.label === undefined ? null : (
                <div key={`divider-${collection.label}`} className="panel-nav-divider">
                  {collection.label}
                </div>
              )
            }
            const active =
              (view?.kind === "library" || view?.kind === "entry" || view?.kind === "new") &&
              view.collection === collection.name
            return (
              <button
                key={collection.name}
                type="button"
                className={`panel-nav-item${active ? " panel-nav-active" : ""}`}
                onClick={() => setView({ kind: "library", collection: collection.name })}
              >
                {collection.label}
              </button>
            )
          })}
          <button
            type="button"
            className={`panel-nav-item${view?.kind === "media" ? " panel-nav-active" : ""}`}
            onClick={() => setView({ kind: "media" })}
          >
            Media
          </button>
        </nav>
        <div className="panel-session">
          <div className="panel-session-repo">
            {cms.repository.owner}/{cms.repository.repo}
            <br />
            <span className="panel-muted">{cms.repository.branch}</span>
            {session === undefined ? null : (
              <div className="panel-muted">
                rate budget: {session.rateLimit === null ? "—" : session.rateLimit.remaining}
              </div>
            )}
          </div>
          <button type="button" className="panel-btn" onClick={() => void cms.auth.signOut()}>
            Sign out
          </button>
        </div>
      </aside>
      <main className="panel-main">{renderView(cms, view, setView)}</main>
    </div>
  )
}

function renderView(cms: CMS, view: PanelView | undefined, onOpen: (view: PanelView) => void) {
  if (view === undefined) return <p className="panel-muted">Loading…</p>
  switch (view.kind) {
    case "library":
      return <LibraryScreen cms={cms} collectionName={view.collection} onOpen={onOpen} />
    case "entry":
      return <EntryScreen cms={cms} collection={view.collection} slug={view.slug} onOpen={onOpen} />
    case "new": {
      const found = cms.config.collections.find(
        (candidate) => candidate.kind !== "divider" && candidate.name === view.collection,
      )
      if (found === undefined || found.kind !== "folder") {
        return <p className="panel-muted">Unknown collection.</p>
      }
      return <NewEntryScreen cms={cms} collection={found} onOpen={onOpen} />
    }
    case "media":
      return <MediaScreen cms={cms} />
  }
}
