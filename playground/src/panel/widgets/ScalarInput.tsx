/**
 * Scalar input for list items — the single field a `itemMode: "scalar"` list
 * declares. Rendered directly (not via the primitive widgets, whose descriptor
 * types are exact) so a scalar list of strings, numbers, selects, or dates
 * behaves like the standalone field would.
 */

import type { FieldDescriptor } from "patcms"
import { fromLocalInput, toDateInput, toLocalInput } from "./primitives"

export function ScalarInput(props: {
  field: FieldDescriptor
  value: unknown
  onChange: (next: unknown) => void
  id: string
}) {
  const { field, value, onChange, id } = props
  switch (field.type) {
    case "number":
      return (
        <input
          id={id}
          type="number"
          className="panel-input"
          min={field.min}
          max={field.max}
          step={field.int === true ? 1 : "any"}
          value={typeof value === "number" && Number.isFinite(value) ? String(value) : ""}
          onChange={(event) => {
            const raw = event.target.value
            if (raw === "") {
              onChange(undefined)
              return
            }
            const parsed = Number(raw)
            onChange(Number.isNaN(parsed) ? undefined : parsed)
          }}
        />
      )
    case "boolean":
      return (
        <label className="panel-check" htmlFor={id}>
          <input
            id={id}
            type="checkbox"
            checked={value === true}
            onChange={(event) => onChange(event.target.checked)}
          />
          <span>{field.label}</span>
        </label>
      )
    case "select": {
      const options = field.options
      if (field.multiple === true) {
        const selected = Array.isArray(value)
          ? value.filter((item): item is string => typeof item === "string")
          : []
        return (
          <div className="panel-check-group">
            {options.map((option) => (
              <label key={option.value} className="panel-check">
                <input
                  type="checkbox"
                  checked={selected.includes(option.value)}
                  onChange={(event) => {
                    const next = event.target.checked
                      ? [...selected, option.value]
                      : selected.filter((item) => item !== option.value)
                    onChange(next.length === 0 ? undefined : next)
                  }}
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
          value={typeof value === "string" ? value : ""}
          onChange={(event) => onChange(event.target.value === "" ? undefined : event.target.value)}
        >
          <option value="">—</option>
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      )
    }
    case "datetime": {
      const stored = typeof value === "string" ? value : ""
      const dateOnly = field.dateOnly === true
      return (
        <input
          id={id}
          type={dateOnly ? "date" : "datetime-local"}
          className="panel-input"
          value={dateOnly ? toDateInput(stored) : toLocalInput(stored)}
          onChange={(event) => {
            const raw = event.target.value
            if (raw === "") {
              onChange(undefined)
              return
            }
            onChange(dateOnly ? raw : fromLocalInput(raw))
          }}
        />
      )
    }
    default:
      // string, text, and anything scalar-shaped edits as plain text.
      return (
        <input
          id={id}
          type="text"
          className="panel-input"
          value={typeof value === "string" ? value : ""}
          onChange={(event) => onChange(event.target.value === "" ? undefined : event.target.value)}
        />
      )
  }
}
