import type { SelectFieldDescriptor } from "patcms/advanced"
import { useId } from "react"
import { describedBy, inputClass, WidgetFrame } from "./chrome"
import type { WidgetProps } from "./contract"

/**
 * Choice field. Single → native `<select>` (empty option = not set);
 * multiple → a checkbox group writing a string array in option order.
 * Labels come from the descriptor, never from the raw stored value.
 */
export function SelectWidget({
  value,
  onChange,
  error,
  fieldConfig,
}: WidgetProps<SelectFieldDescriptor>) {
  const id = useId()
  if (fieldConfig.multiple === true) {
    return (
      <MultiSelect id={id} value={value} onChange={onChange} error={error} field={fieldConfig} />
    )
  }
  const current = typeof value === "string" ? value : ""
  return (
    <WidgetFrame id={id} field={fieldConfig} error={error}>
      <select
        id={id}
        className={inputClass(error)}
        value={current}
        required={fieldConfig.required}
        aria-invalid={error !== undefined}
        aria-describedby={describedBy(id, fieldConfig, error)}
        onChange={(event) => onChange(event.target.value === "" ? undefined : event.target.value)}
      >
        <option value="">Not set</option>
        {fieldConfig.options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </WidgetFrame>
  )
}

function MultiSelect({
  id,
  value,
  onChange,
  error,
  field,
}: {
  readonly id: string
  readonly value: unknown
  readonly onChange: (value: unknown) => void
  readonly error: string | undefined
  readonly field: SelectFieldDescriptor
}) {
  const selected = new Set(Array.isArray(value) ? value.filter(isString) : [])
  const toggle = (optionValue: string, checked: boolean): void => {
    const next = new Set(selected)
    if (checked) next.add(optionValue)
    else next.delete(optionValue)
    // Preserve descriptor order so the written bytes are stable (INV-S01).
    const ordered = field.options.map((option) => option.value).filter((entry) => next.has(entry))
    onChange(ordered.length === 0 ? undefined : ordered)
  }
  return (
    <fieldset className="grid gap-1.5" aria-invalid={error !== undefined}>
      <legend className="text-xs font-medium tracking-wide text-text-muted">
        {field.label}
        {field.required ? (
          <span className="ml-1 text-danger" aria-hidden="true">
            *
          </span>
        ) : null}
      </legend>
      <div className="grid gap-1.5">
        {field.options.map((option, index) => {
          const optionId = `${id}-${index}`
          return (
            <label
              key={option.value}
              htmlFor={optionId}
              className="flex items-center gap-2.5 text-sm text-text-primary"
            >
              <input
                id={optionId}
                type="checkbox"
                className="size-4 rounded border-border-strong accent-accent"
                checked={selected.has(option.value)}
                onChange={(event) => toggle(option.value, event.target.checked)}
              />
              {option.label}
            </label>
          )
        })}
      </div>
      {field.hint === undefined ? null : (
        <p id={`${id}-hint`} className="text-[11px] leading-4 text-text-muted">
          {field.hint}
        </p>
      )}
      {error === undefined ? null : (
        <p id={`${id}-error`} role="alert" className="text-[11px] leading-4 text-danger">
          {error}
        </p>
      )}
    </fieldset>
  )
}

function isString(value: unknown): value is string {
  return typeof value === "string"
}
