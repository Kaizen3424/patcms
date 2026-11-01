/**
 * Image widget — previews through the git blob API (never raw.githubusercontent),
 * picks from the collection's media library, and can upload in place.
 */

import type { ImageFieldDescriptor, MediaFile } from "patcms"
import { useEffect, useState } from "react"
import type { WidgetProps } from "./contract"
import { usePanelScope } from "./scope"

export function ImageWidget({ field, value, onChange }: WidgetProps<ImageFieldDescriptor>) {
  const scope = usePanelScope()
  const [files, setFiles] = useState<readonly MediaFile[]>([])
  const [preview, setPreview] = useState<string | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)

  useEffect(() => {
    let alive = true
    void scope.cms.media
      .list({ collection: scope.collection })
      .then((listed) => {
        if (alive) setFiles(listed)
      })
      .catch(() => {
        if (alive) setFiles([])
      })
    return () => {
      alive = false
    }
  }, [scope.cms, scope.collection])

  useEffect(() => {
    if (typeof value !== "string" || value === "") {
      setPreview(undefined)
      return
    }
    let alive = true
    let created: string | undefined
    void scope.cms.media
      .get(value)
      .then((blob) => {
        if (!alive) return
        const part = blob.bytes as unknown as BlobPart
        created = URL.createObjectURL(new Blob([part], { type: blob.type }))
        setPreview(created)
      })
      .catch(() => {
        if (alive) setPreview(undefined)
      })
    return () => {
      alive = false
      if (created !== undefined) URL.revokeObjectURL(created)
    }
  }, [value, scope.cms])

  const upload = async (file: File): Promise<void> => {
    setError(undefined)
    try {
      const bytes = new Uint8Array(await file.arrayBuffer())
      const uploaded = await scope.cms.media.upload(
        { name: file.name, bytes },
        { collection: scope.collection },
      )
      setFiles((current) => [...current, uploaded])
      onChange(uploaded.publicPath)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "upload failed")
    }
  }

  const current = typeof value === "string" ? value : ""
  return (
    <div className="panel-image">
      {preview === undefined ? null : (
        <img className="panel-image-preview" src={preview} alt={field.label} />
      )}
      <select
        className="panel-input"
        value={current}
        onChange={(event) => onChange(event.target.value === "" ? undefined : event.target.value)}
      >
        <option value="">— no image —</option>
        {files.map((file) => (
          <option key={file.path} value={file.publicPath}>
            {file.name}
          </option>
        ))}
        {current !== "" && files.every((file) => file.publicPath !== current) ? (
          <option value={current}>{current} (missing)</option>
        ) : null}
      </select>
      <label className="panel-btn panel-btn-secondary">
        Upload new…
        <input
          type="file"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (file !== undefined) void upload(file)
            event.target.value = ""
          }}
        />
      </label>
      {error === undefined ? null : <p className="panel-error">{error}</p>}
    </div>
  )
}
