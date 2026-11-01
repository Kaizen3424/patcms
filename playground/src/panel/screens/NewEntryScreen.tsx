/**
 * New-entry screen — defaults materialise here (and only here):
 * `createBlankEntryValue` folds declared defaults and pads required lists.
 * The slug stays virtual: `entries.create` derives it from the identifier
 * field unless the host passes one.
 */

import type { CMS, EntryValue, FolderCollectionDescriptor, ParseIssue } from "patcms"
import { createBlankEntryValue, isCMSError } from "patcms"
import { useMemo, useState } from "react"
import type { PanelView } from "../types"
import { FieldList } from "../widgets/FieldList"
import { PanelScopeContext } from "../widgets/scope"

export function NewEntryScreen(props: {
  cms: CMS
  collection: FolderCollectionDescriptor
  onOpen: (view: PanelView) => void
}) {
  const { cms, collection } = props
  const [value, setValue] = useState<Record<string, unknown>>(() =>
    createBlankEntryValue(collection.fields),
  )
  const [issues, setIssues] = useState<readonly ParseIssue[]>([])
  const [error, setError] = useState<string | undefined>(undefined)
  const [busy, setBusy] = useState(false)

  const scope = useMemo(
    () => ({
      cms,
      collection: collection.name,
      media: collection.media ?? cms.config.media,
    }),
    [cms, collection],
  )

  const slugPreview = useMemo(() => {
    try {
      return cms.entries.slugFromValue(collection.name, value)
    } catch {
      return undefined
    }
  }, [cms, collection.name, value])

  const create = async (): Promise<void> => {
    setBusy(true)
    setError(undefined)
    try {
      const result = await cms.entries.create(collection.name, value as EntryValue)
      if (result.status === "saved") {
        props.onOpen({ kind: "entry", collection: collection.name, slug: result.entry.slug })
        return
      }
      if (result.status === "conflict") {
        props.onOpen({ kind: "entry", collection: collection.name, slug: result.current.slug })
        return
      }
      setError("The entry could not be created.")
    } catch (cause) {
      if (isCMSError(cause) && cause.issues !== undefined) {
        setIssues(cause.issues)
      } else {
        setError(cause instanceof Error ? cause.message : "create failed")
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <PanelScopeContext.Provider value={scope}>
      <section>
        <header className="panel-screen-header">
          <h2>
            New {collection.labelSingular ?? "entry"} in {collection.label}
          </h2>
          <div className="panel-toolbar">
            <button
              type="button"
              className="panel-btn"
              disabled={busy}
              onClick={() => void create()}
            >
              {busy ? "Creating…" : "Create"}
            </button>
            <button
              type="button"
              className="panel-btn"
              onClick={() => props.onOpen({ kind: "library", collection: collection.name })}
            >
              Cancel
            </button>
          </div>
        </header>
        <p className="panel-muted">
          File:{" "}
          <code>
            {slugPreview === undefined || slugPreview === ""
              ? collection.folder
              : cms.entries.path(collection.name, slugPreview)}
          </code>
        </p>
        {error === undefined ? null : <p className="panel-error">{error}</p>}
        {issues.length > 0 ? (
          <div className="panel-issues">
            {issues.map((issue, index) => (
              <p key={index} className={`panel-issue-${issue.severity}`}>
                {issue.path}: {issue.message}
              </p>
            ))}
          </div>
        ) : null}
        <FieldList fields={collection.fields} value={value} onChange={setValue} />
      </section>
    </PanelScopeContext.Provider>
  )
}
