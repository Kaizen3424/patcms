import type { ImageFieldDescriptor } from "@mycms/core"
import { useId, useMemo, useRef, useState } from "react"
import { MEDIA_COPY } from "../editor/copy"
import { useBlobPreview } from "../runtime/blob-cache"
import { MediaPickerModal } from "../screens/media-library-screen"
import { inputClass, WidgetFrame } from "./chrome"
import type { WidgetProps } from "./contract"

export function ImageWidget({
  value,
  onChange,
  error,
  fieldConfig,
  services,
}: WidgetProps<ImageFieldDescriptor>) {
  const id = useId()
  const pathValue = typeof value === "string" ? value : ""

  const [pickerOpen, setPickerOpen] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | undefined>(undefined)
  const [failedFile, setFailedFile] = useState<File | undefined>(undefined)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Resolve SHA for the current pathValue (INV-N03)
  const imageSha = useMemo(() => {
    if (!pathValue || !services?.resolveMediaSha) return undefined
    return services.resolveMediaSha(pathValue)
  }, [pathValue, services])

  const { url: previewUrl, loading: previewLoading } = useBlobPreview(imageSha)

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    await processUpload(file)
  }

  const processUpload = async (file: File) => {
    if (!services?.stageMedia) return
    setUploading(true)
    setUploadError(undefined)
    setFailedFile(undefined)

    try {
      const result = await services.stageMedia(file)
      onChange(result.publicPath)
      if (fileInputRef.current) fileInputRef.current.value = ""
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Failed to process image")
      setFailedFile(file)
    } finally {
      setUploading(false)
    }
  }

  const retryUpload = () => {
    if (failedFile) {
      void processUpload(failedFile)
    }
  }

  return (
    <WidgetFrame id={id} field={fieldConfig} error={error}>
      <div className="flex flex-col gap-3">
        <div className="flex gap-3">
          {/* Thumbnail preview */}
          <div className="grid size-16 shrink-0 place-items-center overflow-hidden rounded-lg border border-border-soft bg-surface text-text-muted">
            {previewLoading ? (
              <span className="size-4 animate-spin rounded-full border-2 border-accent border-t-transparent" />
            ) : previewUrl ? (
              <img
                src={previewUrl}
                alt=""
                className="size-full object-cover"
                loading="lazy"
                data-testid="image-widget-preview"
              />
            ) : (
              <span className="text-[10px] uppercase tracking-wider text-text-muted/60">
                No image
              </span>
            )}
          </div>

          {/* Path input */}
          <div className="flex-1 space-y-1.5">
            <input
              id={id}
              type="text"
              value={pathValue}
              onChange={(e) => onChange(e.target.value || undefined)}
              placeholder="/images/products/example.jpg"
              className={inputClass(error)}
            />
            <p className="text-[11px] text-text-muted">
              File path relative to site images folder (e.g.{" "}
              <code className="text-text-primary">/images/...</code>)
            </p>
          </div>
        </div>

        {/* Upload / Choose Library Actions */}
        <div className="flex flex-wrap items-center gap-2">
          {services?.stageMedia && (
            <>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={handleFileChange}
                className="hidden"
                data-testid="image-widget-file-input"
              />
              <button
                type="button"
                disabled={uploading}
                onClick={() => fileInputRef.current?.click()}
                className="rounded border border-border-soft bg-surface px-2.5 py-1 text-xs font-medium text-text-muted hover:border-border-strong hover:text-text-primary transition-colors disabled:opacity-50"
              >
                {uploading ? MEDIA_COPY.uploading : MEDIA_COPY.uploadButton}
              </button>
            </>
          )}

          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            className="rounded border border-border-soft bg-surface px-2.5 py-1 text-xs font-medium text-text-muted hover:border-border-strong hover:text-text-primary transition-colors"
          >
            {MEDIA_COPY.chooseFromLibrary}
          </button>
        </div>

        {/* Upload Error & Retry */}
        {uploadError && (
          <div className="flex items-center justify-between rounded bg-red-500/10 p-2 text-xs text-red-400 border border-red-500/20">
            <span>{uploadError}</span>
            {failedFile && (
              <button
                type="button"
                onClick={retryUpload}
                className="font-medium text-accent underline hover:text-accent/80"
              >
                {MEDIA_COPY.retryUpload}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Library Picker Modal */}
      {pickerOpen && (
        <MediaPickerModal
          open={pickerOpen}
          onClose={() => setPickerOpen(false)}
          onSelect={(publicPath) => {
            onChange(publicPath)
          }}
        />
      )}
    </WidgetFrame>
  )
}
