/**
 * Library screen — one list per collection. Folder collections list entries;
 * files collections list their named documents; dividers become group
 * headers. Search, sort, issue badges, and draft badges are client-side.
 */

import type {
  CMS,
  EntrySummary,
  FilesCollectionDescriptor,
  FolderCollectionDescriptor,
} from "patcms"
import { useEffect, useMemo, useState } from "react"
import { entryTitle, filterSummaries, sortSummaries } from "../lib/library"
import { MediaPreviewCache } from "../lib/media"
import type { PanelView } from "../types"

export function LibraryScreen(props: {
  cms: CMS
  collectionName: string
  onOpen: (view: PanelView) => void
}) {
  const found = props.cms.config.collections.find(
    (candidate) => candidate.kind !== "divider" && candidate.name === props.collectionName,
  )
  if (found === undefined) {
    return <p className="panel-muted">Unknown collection.</p>
  }

  if (found.kind === "files") {
    return <FilesList cms={props.cms} collection={found} onOpen={props.onOpen} />
  }
  if (found.kind === "folder") {
    return <FolderList cms={props.cms} collection={found} onOpen={props.onOpen} />
  }
  return <p className="panel-muted">Unknown collection.</p>
}

function FilesList(props: {
  cms: CMS
  collection: FilesCollectionDescriptor
  onOpen: (view: PanelView) => void
}) {
  return (
    <section>
      <header className="panel-screen-header">
        <h2>{props.collection.label}</h2>
      </header>
      <ul className="panel-list-rows">
        {props.collection.files.map((file) => (
          <li key={file.name}>
            <button
              type="button"
              className="panel-row"
              onClick={() =>
                props.onOpen({ kind: "entry", collection: props.collection.name, slug: file.name })
              }
            >
              <span className="panel-row-title">{file.label}</span>
              <span className="panel-row-meta">{file.file}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

function FolderList(props: {
  cms: CMS
  collection: FolderCollectionDescriptor
  onOpen: (view: PanelView) => void
}) {
  const { cms, collection } = props
  const [entries, setEntries] = useState<readonly EntrySummary[] | undefined>(undefined)
  const [draftSlugs, setDraftSlugs] = useState<readonly string[]>([])
  const [query, setQuery] = useState("")
  const [sortField, setSortField] = useState<string | undefined>(undefined)
  const [direction, setDirection] = useState<"asc" | "desc">("asc")
  const [error, setError] = useState<string | undefined>(undefined)

  const load = (): void => {
    void cms.entries
      .list(collection.name)
      .then((listed) => {
        setEntries(listed)
        setError(undefined)
      })
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : "failed to list entries")
      })
    void cms.drafts.list(collection.name).then((drafts) => {
      setDraftSlugs(drafts.map((draft) => draft.slug))
    })
  }

  useEffect(load, [cms, collection.name])

  const visible = useMemo(() => {
    if (entries === undefined) return []
    return sortSummaries(
      filterSummaries(entries, query, collection),
      sortField ?? collection.sortableFields?.[0],
      direction,
    )
  }, [entries, query, sortField, direction, collection])

  const create = (): void => {
    if (collection.create === false) return
    props.onOpen({ kind: "new", collection: collection.name })
  }

  return (
    <section>
      <header className="panel-screen-header">
        <h2>{collection.label}</h2>
        <div className="panel-toolbar">
          <input
            type="search"
            className="panel-input"
            placeholder="Search…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <select
            className="panel-input"
            value={sortField ?? ""}
            onChange={(event) =>
              setSortField(event.target.value === "" ? undefined : event.target.value)
            }
          >
            <option value="">Sort: title</option>
            {(collection.sortableFields ?? []).map((field) => (
              <option key={field} value={field}>
                Sort: {field}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="panel-btn-icon"
            aria-label="Toggle sort direction"
            onClick={() => setDirection(direction === "asc" ? "desc" : "asc")}
          >
            {direction === "asc" ? "↑" : "↓"}
          </button>
          {collection.create === false ? null : (
            <button type="button" className="panel-btn" onClick={create}>
              New {collection.labelSingular ?? "entry"}
            </button>
          )}
        </div>
      </header>
      {error === undefined ? null : <p className="panel-error">{error}</p>}
      {entries === undefined ? (
        <p className="panel-muted">Loading…</p>
      ) : visible.length === 0 ? (
        <p className="panel-muted">No entries.</p>
      ) : (
        <ul className="panel-list-rows">
          {visible.map((entry) => (
            <li key={entry.slug}>
              <button
                type="button"
                className="panel-row"
                onClick={() =>
                  props.onOpen({ kind: "entry", collection: collection.name, slug: entry.slug })
                }
              >
                {collection.thumbnail === undefined ? null : (
                  <Thumbnail cms={cms} entry={entry} field={collection.thumbnail} />
                )}
                <span className="panel-row-title">{entryTitle(entry, collection)}</span>
                <span className="panel-row-meta">{entry.slug}</span>
                {entry.issues.some((issue) => issue.severity === "error") ? (
                  <span className="panel-badge panel-badge-error">issues</span>
                ) : entry.issues.length > 0 ? (
                  <span className="panel-badge">warnings</span>
                ) : null}
                {draftSlugs.includes(entry.slug) ? (
                  <span className="panel-badge panel-badge-draft">draft</span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function Thumbnail(props: { cms: CMS; entry: EntrySummary; field: string }) {
  const [url, setUrl] = useState<string | undefined>(undefined)
  const publicPath = props.entry.value[props.field]
  useEffect(() => {
    if (typeof publicPath !== "string" || publicPath === "") {
      setUrl(undefined)
      return
    }
    const cache = new MediaPreviewCache(props.cms)
    let alive = true
    void cache.url(publicPath).then((found) => {
      if (alive) setUrl(found)
    })
    return () => {
      alive = false
      cache.dispose()
    }
  }, [publicPath, props.cms])
  if (url === undefined) return <span className="panel-thumb panel-thumb-empty" />
  return <img className="panel-thumb" src={url} alt="" />
}
