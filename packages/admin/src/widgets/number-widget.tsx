import type { NumberFieldDescriptor } from "@mycms/core"
import { useId } from "react"
import { describedBy, inputClass, WidgetFrame } from "./chrome"
import type { WidgetProps } from "./contract"

/**
 * Numeric field. Empty input means "not set" (the key is removed), never `0`:
 * inventing a zero would publish a price nobody typed (default-immunity law).
 */
export function NumberWidget({
  value,
  onChange,
  error,
  fieldConfig,
}: WidgetProps<NumberFieldDescriptor>) {
  const id = useId()
  const text = typeof value === "number" && Number.isFinite(value) ? String(value) : ""
  return (
    <WidgetFrame id={id} field={fieldConfig} error={error}>
      <input
        id={id}
        type="number"
        inputMode={fieldConfig.int === true ? "numeric" : "decimal"}
        step={fieldConfig.int === true ? 1 : "any"}
        min={fieldConfig.min}
        max={fieldConfig.max}
        className={inputClass(error)}
        value={text}
        required={fieldConfig.required}
        aria-invalid={error !== undefined}
        aria-describedby={describedBy(id, fieldConfig, error)}
        onChange={(event) => {
          const raw = event.target.value
          if (raw === "") {
            onChange(undefined)
            return
          }
          const parsed = Number(raw)
          // Partial input ("1.") is not a number yet — keep the last real value
          // rather than writing NaN into the entry.
          if (Number.isFinite(parsed)) onChange(parsed)
        }}
      />
    </WidgetFrame>
  )
}
