/**
 * Entry editor — the screen that proves the client's core flows: parse, save
 * with untouched preservation, conflicts as values, drafts, and delete.
 *
 * Save flow: validate → save → render the result. A conflict is not an error;
 * it is a value (`{ current, local }`) that becomes a per-field decision UI.
 */

import type {
  CMS,
  Entry,
  EntryValue,
  FilesCollectionDescriptor,
  FolderCollectionDescriptor,
  ParseIssue,
} from "patcms"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  type ConflictFieldRow,
  defaultPicks,
  type FieldPick,
  mergePickedFields,
  pairConflictFields,
} from "../lib/conflict"
import { type DraftOffer, evaluateDraft } from "../lib/draft"
import type { PanelView } from "../types"
import { FieldList } from "../widgets/FieldList"
import { PanelScopeContext } from "../widgets/scope"

type SaveState =
  | { readonly kind: "idle" }
  | { readonly kind: "saving" }
  | { readonly kind: "saved"; readonly commitSha: string }
  | { readonly kind: "noop" }
  | { readonly kind: "error"; readonly message: string }
  | {
      readonly kind: "conflict"
      readonly current: Entry
      readonly local: EntryValue
      readonly picks: Readonly<Record<string, FieldPick>>
    }

const DRAFT_DEBOUNCE_MS = 600

export function EntryScreen(props: {
  cms: CMS
  collection: string
  slug: string
  onOpen: (view: PanelView) => void
}) {
  const { cms } = props
  const [entry, setEntry] = useState<Entry | undefined>(undefined)
  const [value, setValue] = useState<EntryValue | undefined>(undefined)
  const [draft, setDraft] = useState<DraftOffer | undefined>(undefined)
  const [issues, setIssues] = useState<readonly ParseIssue[]>([])
  const [saveState, setSaveState] = useState<SaveState>({ kind: "idle" })
  const [loadError, setLoadError] = useState<string | undefined>(undefined)
  const dirtyRef = useRef(false)

  useEffect(() => {
    let alive = true
    setEntry(undefined)
    setValue(undefined)
    setDraft(undefined)
    setSaveState({ kind: "idle" })
    dirtyRef.current = false
    void (async () => {
      try {
        const loaded = await cms.entries.get(props.collection, props.slug)
        if (!alive) return
        const stored = await cms.drafts.get(loaded)
        if (!alive) return
        setEntry(loaded)
        setValue(stored === undefined ? loaded.value : stored.value)
        setDraft(evaluateDraft(loaded, stored))
      } catch (cause) {
        if (alive) {
          setLoadError(cause instanceof Error ? cause.message : "failed to load entry")
        }
      }
    })()
    return () => {
      alive = false
    }
  }, [cms, props.collection, props.slug])

  // Draft autosave — debounced, only for user edits.
  useEffect(() => {
    if (entry === undefined || value === undefined || !dirtyRef.current) return
    const handle = setTimeout(() => {
      void cms.drafts.save(entry, value).then(async () => {
        const stored = await cms.drafts.get(entry)
        setDraft(evaluateDraft(entry, stored))
      })
    }, DRAFT_DEBOUNCE_MS)
    return () => {
      clearTimeout(handle)
    }
  }, [cms, entry, value])

  const collection = useMemo(():
    | FolderCollectionDescriptor
    | FilesCollectionDescriptor
    | undefined => {
    const found = cms.config.collections.find(
      (candidate) => candidate.kind !== "divider" && candidate.name === props.collection,
    )
    return found?.kind === "folder" || found?.kind === "files" ? found : undefined
  }, [cms, props.collection])
  const scope = useMemo(() => {
    if (collection === undefined) return undefined
    return { cms, collection: collection.name, media: collection.media ?? cms.config.media }
  }, [cms, collection])

  const edit = useCallback((next: EntryValue): void => {
    dirtyRef.current = true
    setValue(next)
  }, [])

  const save = async (): Promise<void> => {
    if (entry === undefined || value === undefined) return
    setIssues([])
    const check = await cms.entries.validate(entry, value)
    if (!check.ok) {
      setIssues(check.issues)
      return
    }
    setSaveState({ kind: "saving" })
    try {
      const result = await cms.entries.save(entry, value)
      applySaveResult(result, value)
    } catch (cause) {
      setSaveState({
        kind: "error",
        message: cause instanceof Error ? cause.message : "save failed",
      })
    }
  }

  const applySaveResult = (
    result: Awaited<ReturnType<CMS["entries"]["save"]>>,
    attempted: EntryValue,
  ): void => {
    if (result.status === "saved") {
      dirtyRef.current = false
      setEntry(result.entry)
      setValue(result.entry.value)
      setDraft(undefined)
      setSaveState({ kind: "saved", commitSha: result.commitSha })
      return
    }
    if (result.status === "noop") {
      dirtyRef.current = false
      setSaveState({ kind: "noop" })
      return
    }
    dirtyRef.current = true
    setSaveState({
      kind: "conflict",
      current: result.current,
      local: attempted,
      picks: defaultPicks(
        pairConflictFields(result.current.value, attempted, result.current.fields),
      ),
    })
  }

  const resolveConflict = async (): Promise<void> => {
    if (saveState.kind !== "conflict") return
    const merged = mergePickedFields(
      saveState.current,
      saveState.local,
      saveState.current.fields,
      saveState.picks,
    )
    setSaveState({ kind: "saving" })
    try {
      const result = await cms.entries.save(saveState.current, merged)
      applySaveResult(result, merged)
    } catch (cause) {
      setSaveState({
        kind: "error",
        message: cause instanceof Error ? cause.message : "save failed",
      })
    }
  }

  const discardLocal = async (): Promise<void> => {
    if (saveState.kind !== "conflict") return
    dirtyRef.current = false
    setEntry(saveState.current)
    setValue(saveState.current.value)
    setSaveState({ kind: "idle" })
    await cms.drafts.delete(saveState.current)
    setDraft(undefined)
  }

  const discardDraft = async (): Promise<void> => {
    if (entry === undefined) return
    await cms.drafts.delete(entry)
    setValue(entry.value)
    setDraft(undefined)
    dirtyRef.current = false
  }

  const remove = async (): Promise<void> => {
    if (entry === undefined) return
    if (!window.confirm(`Delete "${props.slug}"? This creates a commit.`)) return
    setSaveState({ kind: "saving" })
    try {
      const result = await cms.entries.delete(entry)
      if (result.status === "deleted" || result.status === "noop") {
        props.onOpen({ kind: "library", collection: props.collection })
        return
      }
      setSaveState({
        kind: "error",
        message: "The entry changed on the branch; reload and try again.",
      })
    } catch (cause) {
      setSaveState({
        kind: "error",
        message: cause instanceof Error ? cause.message : "delete failed",
      })
    }
  }

  if (loadError !== undefined) {
    return (
      <section>
        <p className="panel-error">{loadError}</p>
        <button
          type="button"
          className="panel-btn"
          onClick={() => props.onOpen({ kind: "library", collection: props.collection })}
        >
          Back to library
        </button>
      </section>
    )
  }
  if (entry === undefined || value === undefined || scope === undefined) {
    return <p className="panel-muted">Loading…</p>
  }

  return (
    <PanelScopeContext.Provider value={scope}>
      <section>
        <header className="panel-screen-header">
          <h2>{entry.title}</h2>
          <div className="panel-toolbar">
            <button
              type="button"
              className="panel-btn"
              disabled={saveState.kind === "saving"}
              onClick={() => void save()}
            >
              {saveState.kind === "saving" ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              className="panel-btn panel-btn-danger"
              disabled={saveState.kind === "saving"}
              onClick={() => void remove()}
            >
              Delete
            </button>
          </div>
        </header>

        {draft === undefined ? null : (
          <div className="panel-banner">
            <span>
              Unsaved draft from {new Date(draft.draft.savedAt).toLocaleString()}
              {draft.freshness === "stale"
                ? " — the branch moved since it was started; saving will offer the conflict."
                : ""}
            </span>
            <button type="button" className="panel-btn-icon" onClick={() => void discardDraft()}>
              Discard draft
            </button>
          </div>
        )}

        {saveState.kind === "saved" ? (
          <div className="panel-banner panel-banner-ok">
            Saved — commit {saveState.commitSha.slice(0, 7)}
          </div>
        ) : null}
        {saveState.kind === "noop" ? <div className="panel-banner">No changes to save.</div> : null}
        {saveState.kind === "error" ? <p className="panel-error">{saveState.message}</p> : null}

        {issues.length > 0 ? (
          <div className="panel-issues">
            {issues.map((issue, index) => (
              <p key={index} className={`panel-issue-${issue.severity}`}>
                {issue.path}: {issue.message}
              </p>
            ))}
          </div>
        ) : null}

        {saveState.kind === "conflict" ? (
          <ConflictPanel
            rows={pairConflictFields(saveState.current.value, saveState.local, entry.fields)}
            picks={saveState.picks}
            onPick={(name, pick) =>
              setSaveState({ ...saveState, picks: { ...saveState.picks, [name]: pick } })
            }
            onAllMine={() =>
              setSaveState({
                ...saveState,
                picks: allPicks(
                  pairConflictFields(saveState.current.value, saveState.local, entry.fields),
                  "mine",
                ),
              })
            }
            onAllCurrent={() =>
              setSaveState({
                ...saveState,
                picks: allPicks(
                  pairConflictFields(saveState.current.value, saveState.local, entry.fields),
                  "current",
                ),
              })
            }
            onSaveSelected={() => void resolveConflict()}
            onDiscard={() => void discardLocal()}
          />
        ) : (
          <FieldList
            fields={entry.fields}
            value={value as Record<string, unknown>}
            onChange={(next) => edit(next as EntryValue)}
          />
        )}
      </section>
    </PanelScopeContext.Provider>
  )
}

function allPicks(rows: readonly ConflictFieldRow[], pick: FieldPick): Record<string, FieldPick> {
  const picks: Record<string, FieldPick> = {}
  for (const row of rows) picks[row.name] = pick
  return picks
}

function ConflictPanel(props: {
  rows: readonly ConflictFieldRow[]
  picks: Readonly<Record<string, FieldPick>>
  onPick: (name: string, pick: FieldPick) => void
  onAllMine: () => void
  onAllCurrent: () => void
  onSaveSelected: () => void
  onDiscard: () => void
}) {
  return (
    <div className="panel-conflict">
      <h3>Conflict — someone saved first</h3>
      <p className="panel-muted">
        The file on the branch changed while you were editing. Choose per field what to keep, then
        save; the untouched keys of the current version are preserved either way.
      </p>
      <div className="panel-toolbar">
        <button type="button" className="panel-btn" onClick={props.onAllMine}>
          All mine
        </button>
        <button type="button" className="panel-btn" onClick={props.onAllCurrent}>
          All current
        </button>
        <button type="button" className="panel-btn" onClick={props.onSaveSelected}>
          Save selected
        </button>
        <button type="button" className="panel-btn panel-btn-danger" onClick={props.onDiscard}>
          Discard my changes
        </button>
      </div>
      <table className="panel-conflict-table">
        <thead>
          <tr>
            <th>Field</th>
            <th>Current on branch</th>
            <th>Your edit</th>
            <th>Keep</th>
          </tr>
        </thead>
        <tbody>
          {props.rows.map((row) => (
            <tr key={row.name} className={row.equal ? "panel-row-equal" : undefined}>
              <td>{row.label}</td>
              <td className="panel-conflict-value">{row.current}</td>
              <td className="panel-conflict-value">{row.mine}</td>
              <td>
                {row.equal ? (
                  <span className="panel-muted">same</span>
                ) : (
                  <span className="panel-pick">
                    <label className="panel-check">
                      <input
                        type="radio"
                        name={`pick-${row.name}`}
                        checked={props.picks[row.name] === "mine"}
                        onChange={() => props.onPick(row.name, "mine")}
                      />
                      <span>mine</span>
                    </label>
                    <label className="panel-check">
                      <input
                        type="radio"
                        name={`pick-${row.name}`}
                        checked={props.picks[row.name] === "current"}
                        onChange={() => props.onPick(row.name, "current")}
                      />
                      <span>current</span>
                    </label>
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** A draft the editor just autosaved re-reads from the store; no fake shapes. */
