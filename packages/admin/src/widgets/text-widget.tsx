import type { TextFieldDescriptor } from "@mycms/core"
import { useId } from "react"
import { describedBy, inputClass, WidgetFrame } from "./chrome"
import type { WidgetProps } from "./contract"

/** Long-form text — the multi-line textarea (yve captions, descriptions). */
export function TextWidget({
  value,
  onChange,
  error,
  fieldConfig,
}: WidgetProps<TextFieldDescriptor>) {
  const id = useId()
  const text = typeof value === "string" ? value : ""
  return (
    <WidgetFrame id={id} field={fieldConfig} error={error}>
      <textarea
        id={id}
        className={`${inputClass(error)} min-h-28 resize-y leading-6`}
        value={text}
        required={fieldConfig.required}
        aria-invalid={error !== undefined}
        aria-describedby={describedBy(id, fieldConfig, error)}
        onChange={(event) => onChange(event.target.value === "" ? undefined : event.target.value)}
      />
    </WidgetFrame>
  )
}
