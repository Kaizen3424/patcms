import type { ImageFieldDescriptor } from "@mycms/core"
import { useId } from "react"
import { imageSource } from "../runtime/media"
import { inputClass, WidgetFrame } from "./chrome"
import type { WidgetProps } from "./contract"

export function ImageWidget({
  value,
  onChange,
  error,
  fieldConfig,
}: WidgetProps<ImageFieldDescriptor>) {
  const id = useId()
  const pathValue = typeof value === "string" ? value : ""
  const preview = imageSource(pathValue, "/images")

  return (
    <WidgetFrame id={id} field={fieldConfig} error={error}>
      <div className="flex gap-3">
        {/* Thumbnail preview */}
        <div className="grid size-16 shrink-0 place-items-center overflow-hidden rounded-lg border border-border-soft bg-surface text-text-muted">
          {preview ? (
            <img src={preview} alt="" className="size-full object-cover" loading="lazy" />
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
    </WidgetFrame>
  )
}
