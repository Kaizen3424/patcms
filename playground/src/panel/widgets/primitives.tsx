/**
 * Primitive widgets: string, text, number, boolean, select, datetime.
 * Each one maps a field descriptor onto a plain controlled input — no form
 * library, no widget framework. Validation is the client's job
 * (`entries.validate`); the widgets only shape values.
 */

import type {
  BooleanFieldDescriptor,
  DatetimeFieldDescriptor,
  NumberFieldDescriptor,
  SelectFieldDescriptor,
  StringFieldDescriptor,
  TextFieldDescriptor,
} from "patcms"
import { useId } from "react"
import type { WidgetProps } from "./contract"

export function StringWidget(props: WidgetProps<StringFieldDescriptor>) {
  const id = props.id ?? useId()
  return (
    <input
      id={id}
      type="text"
      className="panel-input"
      value={typeof props.value === "string" ? props.value : ""}
      onChange={(event) =>
        props.onChange(event.target.value === "" ? undefined : event.target.value)
      }
    />
  )
}

export function TextWidget(props: WidgetProps<TextFieldDescriptor>) {
  const id = props.id ?? useId()
  return (
    <textarea
      id={id}
      className="panel-input panel-textarea"
      rows={4}
      value={typeof props.value === "string" ? props.value : ""}
      onChange={(event) =>
        props.onChange(event.target.value === "" ? undefined : event.target.value)
      }
    />
  )
}

export function NumberWidget(props: WidgetProps<NumberFieldDescriptor>) {
  const id = props.id ?? useId()
  return (
    <input
      id={id}
      type="number"
      className="panel-input"
      min={props.field.min}
      max={props.field.max}
      step={props.field.int === true ? 1 : "any"}
      value={
        typeof props.value === "number" && Number.isFinite(props.value) ? String(props.value) : ""
      }
      onChange={(event) => {
        const raw = event.target.value
        if (raw === "") {
          props.onChange(undefined)
          return
        }
        const parsed = Number(raw)
        props.onChange(Number.isNaN(parsed) ? undefined : parsed)
      }}
    />
  )
}

export function BooleanWidget(props: WidgetProps<BooleanFieldDescriptor>) {
  const id = props.id ?? useId()
  return (
    <label className="panel-check" htmlFor={id}>
      <input
        id={id}
        type="checkbox"
        checked={props.value === true}
        onChange={(event) => props.onChange(event.target.checked)}
      />
      <span>{props.field.label}</span>
    </label>
  )
}

export function SelectWidget(props: WidgetProps<SelectFieldDescriptor>) {
  const id = props.id ?? useId()
  if (props.field.multiple === true) {
    const selected = Array.isArray(props.value)
      ? props.value.filter((item): item is string => typeof item === "string")
      : []
    const toggle = (optionValue: string, checked: boolean): void => {
      const next = checked
        ? [...selected, optionValue]
        : selected.filter((item) => item !== optionValue)
      props.onChange(next.length === 0 ? undefined : next)
    }
    return (
      <div className="panel-check-group">
        {props.field.options.map((option) => (
          <label key={option.value} className="panel-check">
            <input
              type="checkbox"
              checked={selected.includes(option.value)}
              onChange={(event) => toggle(option.value, event.target.checked)}
            />
            <span>{option.label}</span>
          </label>
        ))}
      </div>
    )
  }
  return (
    <select
      id={id}
      className="panel-input"
      value={typeof props.value === "string" ? props.value : ""}
      onChange={(event) =>
        props.onChange(event.target.value === "" ? undefined : event.target.value)
      }
    >
      <option value="">—</option>
      {props.field.options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  )
}

export function DatetimeWidget(props: WidgetProps<DatetimeFieldDescriptor>) {
  const id = props.id ?? useId()
  const stored = typeof props.value === "string" ? props.value : ""
  const dateOnly = props.field.dateOnly === true
  return (
    <input
      id={id}
      type={dateOnly ? "date" : "datetime-local"}
      className="panel-input"
      value={dateOnly ? toDateInput(stored) : toLocalInput(stored)}
      onChange={(event) => {
        const raw = event.target.value
        if (raw === "") {
          props.onChange(undefined)
          return
        }
        props.onChange(dateOnly ? raw : fromLocalInput(raw))
      }}
    />
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
