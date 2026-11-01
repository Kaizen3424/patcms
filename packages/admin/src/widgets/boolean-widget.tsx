import type { BooleanFieldDescriptor } from "patcms/advanced"
import { useId } from "react"
import { FieldMessages } from "./chrome"
import type { WidgetProps } from "./contract"

/** On/off field. A false value is real data (it is written as `false`). */
export function BooleanWidget({
  value,
  onChange,
  error,
  fieldConfig,
}: WidgetProps<BooleanFieldDescriptor>) {
  const id = useId()
  const checked = value === true
  return (
    <div className="grid gap-1.5">
      <div className="flex items-center gap-2.5">
        <input
          id={id}
          type="checkbox"
          className="size-4 rounded border-border-strong accent-accent outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          checked={checked}
          aria-invalid={error !== undefined}
          aria-describedby={error === undefined ? undefined : `${id}-error`}
          onChange={(event) => onChange(event.target.checked)}
        />
        <label htmlFor={id} className="text-sm text-text-primary">
          {fieldConfig.label}
          {fieldConfig.required ? (
            <span className="ml-1 text-danger" aria-hidden="true">
              *
            </span>
          ) : null}
        </label>
      </div>
      <FieldMessages id={id} field={fieldConfig} error={error} />
    </div>
  )
}
