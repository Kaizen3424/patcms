import type { DatetimeFieldDescriptor } from "@mycms/core"
import { useId } from "react"
import { describedBy, inputClass, WidgetFrame } from "./chrome"
import type { WidgetProps } from "./contract"

/**
 * Date / date-time field. `dateOnly` stores `YYYY-MM-DD`; otherwise the field
 * round-trips through the browser-local input value and writes a UTC ISO
 * string on edit (the stored shape the site expects).
 */
export function DatetimeWidget({
  value,
  onChange,
  error,
  fieldConfig,
}: WidgetProps<DatetimeFieldDescriptor>) {
  const id = useId()
  const stored = typeof value === "string" ? value : ""
  const dateOnly = fieldConfig.dateOnly === true
  return (
    <WidgetFrame id={id} field={fieldConfig} error={error}>
      <input
        id={id}
        type={dateOnly ? "date" : "datetime-local"}
        className={inputClass(error)}
        value={dateOnly ? toDateInput(stored) : toLocalInput(stored)}
        required={fieldConfig.required}
        aria-invalid={error !== undefined}
        aria-describedby={describedBy(id, fieldConfig, error)}
        onChange={(event) => {
          const raw = event.target.value
          if (raw === "") {
            onChange(undefined)
            return
          }
          onChange(dateOnly ? raw : fromLocalInput(raw))
        }}
      />
    </WidgetFrame>
  )
}

/** `2024-05-01T10:00:00.000Z` → `2024-05-01` (accepts a plain date unchanged). */
export function toDateInput(stored: string): string {
  return stored.length >= 10 ? stored.slice(0, 10) : stored
}

/** Stored ISO → the `YYYY-MM-DDTHH:mm` a datetime-local input expects (local). */
export function toLocalInput(stored: string): string {
  if (stored === "") return ""
  const date = new Date(stored)
  if (Number.isNaN(date.getTime())) return stored
  const pad = (part: number): string => String(part).padStart(2, "0")
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`
}

/** Local input value → UTC ISO string (what the entry stores). */
export function fromLocalInput(local: string): string {
  const date = new Date(local)
  if (Number.isNaN(date.getTime())) return local
  return date.toISOString()
}
