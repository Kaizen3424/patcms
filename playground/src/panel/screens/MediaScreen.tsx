/**
 * Media screen — list, upload, delete with the reference ladder, and the
 * trash tab backed by `media.list({ includeTrash: true })` + `media.restore`.
 *
 * Delete flow: the client refuses while entries reference the file; the panel
 * then shows exactly which entries reference it and offers the tombstone move.
 */

import type { CMS, MediaFile, ReferenceLocation } from "patcms"
import { useCallback, useEffect, useMemo, useState } from "react"
import { formatBytes } from "../lib/library"
import { MediaPreviewCache } from "../lib/media"

export function MediaScreen({ cms }: { cms: CMS }) {
  const [tab, setTab] = useState<"library" | "trash">("library")
  return (
    <section>
      <header className="panel-screen-header">
        <h2>Media</h2>
        <div className="panel-toolbar">
          <button
            type="button"
            className={`panel-btn${tab === "library" ? " panel-btn-active" : ""}`}
            onClick={() => setTab("library")}
          >
            Library
          </button>
          <button
            type="button"
            className={`panel-btn${tab === "trash" ? " panel-btn-active" : ""}`}
            onClick={() => setTab("trash")}
          >
            Trash
          </button>
        </div>
      </header>
      {tab === "library" ? <MediaLibrary cms={cms} /> : <MediaTrash cms={cms} />}
    </section>
  )
}

function MediaLibrary({ cms }: { cms: CMS }) {
  const [files, setFiles] = useState<readonly MediaFile[] | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)
  const [notice, setNotice] = useState<string | undefined>(undefined)
  const [references, setReferences] = useState<
    readonly { file: MediaFile; references: readonly ReferenceLocation[] }[] | undefined
  >(undefined)
  const cache = useMemo(() => new MediaPreviewCache(cms), [cms])

  // Wrapped so React invokes it bound; a bare method reference would lose `this`.
  useEffect(() => () => cache.dispose(), [cache])

  const load = useCallback(async () => {
    setReferences(undefined)
    try {
      setFiles(await cms.media.list())
      setError(undefined)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "failed to list media")
    }
  }, [cms])

  useEffect(() => {
    void load()
  }, [load])

  const upload = async (chosen: readonly File[]): Promise<void> => {
    setError(undefined)
    setNotice(undefined)
    for (const file of chosen) {
      try {
        const bytes = new Uint8Array(await file.arrayBuffer())
        await cms.media.upload({ name: file.name, bytes })
        setNotice(`Uploaded ${file.name}`)
      } catch (cause) {
        if (isConflict(cause)) {
          const overwrite = window.confirm(
            `${file.name} already exists. Replace it? This creates a commit.`,
          )
          if (!overwrite) continue
          try {
            const bytes = new Uint8Array(await file.arrayBuffer())
            await cms.media.upload({ name: file.name, bytes }, { overwrite: true })
            setNotice(`Replaced ${file.name}`)
          } catch (retryCause) {
            setError(retryCause instanceof Error ? retryCause.message : "upload failed")
          }
        } else {
          setError(cause instanceof Error ? cause.message : "upload failed")
        }
      }
    }
    cache.dispose()
    await load()
  }

  const remove = async (file: MediaFile): Promise<void> => {
    setError(undefined)
    setNotice(undefined)
    try {
      const result = await cms.media.delete(file.publicPath)
      if (result.status === "deleted") {
        setNotice(`Moved ${file.name} to trash`)
        cache.invalidate(file.publicPath)
        await load()
        return
      }
      setReferences([{ file, references: result.references }])
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "delete failed")
    }
  }

  const forceDelete = async (file: MediaFile): Promise<void> => {
    setError(undefined)
    try {
      const result = await cms.media.delete(file.publicPath, { checkReferences: false })
      if (result.status === "deleted") {
        setNotice(`Moved ${file.name} to trash`)
        cache.invalidate(file.publicPath)
        await load()
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "delete failed")
    } finally {
      setReferences(undefined)
    }
  }

  return (
    <div>
      <div className="panel-toolbar">
        <label className="panel-btn">
          Upload…
          <input
            type="file"
            multiple
            hidden
            onChange={(event) => {
              void upload(Array.from(event.target.files ?? []))
              event.target.value = ""
            }}
          />
        </label>
        {notice === undefined ? null : <span className="panel-banner-ok">{notice}</span>}
      </div>
      {error === undefined ? null : <p className="panel-error">{error}</p>}
      {references === undefined ? null : (
        <div className="panel-banner panel-banner-warn">
          <p>Referenced by entries — deleting breaks them:</p>
          <ul>
            {references.flatMap(({ references }) =>
              references.map((reference) => (
                <li key={`${reference.collection}/${reference.slug}/${reference.fieldPath}`}>
                  {reference.collection}/{reference.slug} — {reference.fieldPath}
                </li>
              )),
            )}
          </ul>
          {references.map(({ file }) => (
            <button
              key={file.path}
              type="button"
              className="panel-btn panel-btn-danger"
              onClick={() => void forceDelete(file)}
            >
              Move {file.name} to trash anyway
            </button>
          ))}
        </div>
      )}
      {files === undefined ? (
        <p className="panel-muted">Loading…</p>
      ) : files.length === 0 ? (
        <p className="panel-muted">No media yet.</p>
      ) : (
        <div className="panel-media-grid">
          {files.map((file) => (
            <MediaTile
              key={file.path}
              cache={cache}
              file={file}
              onDelete={() => void remove(file)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function MediaTrash({ cms }: { cms: CMS }) {
  const [files, setFiles] = useState<readonly MediaFile[] | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)
  const [notice, setNotice] = useState<string | undefined>(undefined)

  const load = useCallback(async () => {
    try {
      setFiles(await cms.media.list({ includeTrash: true }))
      setError(undefined)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "failed to list trash")
    }
  }, [cms])

  useEffect(() => {
    void load()
  }, [load])

  const restore = async (file: MediaFile): Promise<void> => {
    setError(undefined)
    setNotice(undefined)
    try {
      const restored = await cms.media.restore(file.path)
      setNotice(`Restored to ${restored.publicPath}`)
      await load()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "restore failed")
    }
  }

  return (
    <div>
      {notice === undefined ? null : <div className="panel-banner panel-banner-ok">{notice}</div>}
      {error === undefined ? null : <p className="panel-error">{error}</p>}
      {files === undefined ? (
        <p className="panel-muted">Loading…</p>
      ) : files.length === 0 ? (
        <p className="panel-muted">Trash is empty.</p>
      ) : (
        <ul className="panel-list-rows">
          {files.map((file) => (
            <li key={file.path} className="panel-row-static">
              <span className="panel-row-title">{file.name}</span>
              <span className="panel-row-meta">
                restores to {file.publicPath} · {formatBytes(file.size)}
              </span>
              <button type="button" className="panel-btn" onClick={() => void restore(file)}>
                Restore
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function MediaTile(props: { cache: MediaPreviewCache; file: MediaFile; onDelete: () => void }) {
  const [url, setUrl] = useState<string | undefined>(undefined)
  useEffect(() => {
    let alive = true
    void props.cache.url(props.file.publicPath).then((found) => {
      if (alive) setUrl(found)
    })
    return () => {
      alive = false
    }
  }, [props.cache, props.file.publicPath])

  return (
    <figure className="panel-media-tile">
      {url === undefined ? (
        <div className="panel-media-empty">{props.file.name}</div>
      ) : (
        <img src={url} alt={props.file.name} />
      )}
      <figcaption>
        <span className="panel-row-title">{props.file.name}</span>
        <span className="panel-row-meta">{formatBytes(props.file.size)}</span>
        <button
          type="button"
          className="panel-btn-icon panel-btn-danger"
          aria-label={`Delete ${props.file.name}`}
          onClick={props.onDelete}
        >
          ✕
        </button>
      </figcaption>
    </figure>
  )
}

function isConflict(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: unknown }).code === "CONFLICT"
  )
}
