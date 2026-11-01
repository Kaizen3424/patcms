import type { StringFieldDescriptor } from "patcms/advanced"
import { useId } from "react"
import { describedBy, inputClass, WidgetFrame } from "./chrome"
import type { WidgetProps } from "./contract"

/** Single-line text (email/url input types when the descriptor asks). */
export function StringWidget({
  value,
  onChange,
  error,
  fieldConfig,
}: WidgetProps<StringFieldDescriptor>) {
  const id = useId()
  const text = typeof value === "string" ? value : ""
  const type =
    fieldConfig.format === "email" ? "email" : fieldConfig.format === "url" ? "url" : "text"
  return (
    <WidgetFrame id={id} field={fieldConfig} error={error}>
      <input
        id={id}
        type={type}
        className={inputClass(error)}
        value={text}
        required={fieldConfig.required}
        minLength={fieldConfig.minLength}
        maxLength={fieldConfig.maxLength}
        pattern={fieldConfig.pattern}
        aria-invalid={error !== undefined}
        aria-describedby={describedBy(id, fieldConfig, error)}
        onChange={(event) => onChange(event.target.value === "" ? undefined : event.target.value)}
      />
    </WidgetFrame>
  )
}
