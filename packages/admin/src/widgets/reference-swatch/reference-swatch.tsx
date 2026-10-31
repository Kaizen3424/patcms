/**
 * Reference Swatch Widget Exemplar (ADR-0009 §3)
 *
 * This exemplar demonstrates how custom widgets extend MyCMS without modifying
 * core types or bypassing the architectural boundary laws.
 *
 * ## The Four Seams of the Custom Widget Contract:
 *
 * 1. CONFIG:
 *    Host schemas define custom fields using either a standard factory (e.g.,
 *    `fields.select({ label: "Swatch", ... })` or a custom descriptor) joined
 *    to the widget BY NAME via `WidgetTypeName = FieldDescriptor["type"] | (string & {})`.
 *    In yve, product option values use:
 *    `swatch: z.enum(["accent", "muted", "secondary"]).default("accent")`
 *
 * 2. VALIDATE:
 *    Validation is strictly pure and isolated in `@mycms/core` (ADR-0003).
 *    The core validator ensures values match enum bounds, types, or custom rules.
 *    Widgets NEVER execute network I/O during validation.
 *
 * 3. SERIALIZE:
 *    Data remains canonical JSON on disk (ADR-0003, INV-S01). The swatch widget
 *    serializes clean scalar strings (`"accent" | "muted" | "secondary"`).
 *    Ephemeral UI state (such as focus or hover) is never persisted.
 *
 * 4. RENDER:
 *    The widget component is a pure React function of `WidgetProps<F>`.
 *    - It consumes `{ value, onChange, error, fieldConfig }`.
 *    - It strictly avoids receiving `backend`, PAT tokens, or raw fetch instances
 *      (standing panel veto, ADR-0009 §1).
 *    - It uses accessible semantic markup (`role="radiogroup"`, `aria-checked`,
 *      clear labels, keyboard navigation) and sanitizes any injected styles.
 */
import type { SelectFieldDescriptor } from "@mycms/core"
import { useId } from "react"
import { FieldMessages } from "../chrome"
import type { WidgetProps } from "../contract"

export interface SwatchOption {
  readonly label: string
  readonly value: string
  readonly color: string
}

export const DEFAULT_SWATCH_OPTIONS: readonly SwatchOption[] = [
  { label: "Gold (accent)", value: "accent", color: "#c29547" },
  { label: "Neutral (muted)", value: "muted", color: "#d9d4d0" },
  { label: "Deep blue (secondary)", value: "secondary", color: "#2b3a4a" },
]

export function ReferenceSwatchWidget({
  value,
  onChange,
  error,
  fieldConfig,
}: WidgetProps<SelectFieldDescriptor>) {
  const id = useId()
  const configuredOptions = fieldConfig.options

  // Map descriptor options or fall back to default yve swatches
  const options: readonly SwatchOption[] =
    Array.isArray(configuredOptions) && configuredOptions.length > 0
      ? configuredOptions.map((opt) => {
          const match = DEFAULT_SWATCH_OPTIONS.find((d) => d.value === opt.value)
          return {
            label: opt.label,
            value: opt.value,
            color: match?.color ?? "#888888",
          }
        })
      : DEFAULT_SWATCH_OPTIONS

  const currentValue = typeof value === "string" ? value : undefined

  return (
    <fieldset id={id} className="space-y-1.5" data-testid={`swatch-widget-${fieldConfig.name}`}>
      <legend className="block text-xs font-medium text-text-primary">
        {fieldConfig.label}
        {fieldConfig.required ? (
          <span className="ml-1 text-danger" aria-hidden="true">
            *
          </span>
        ) : null}
      </legend>

      <FieldMessages id={id} field={fieldConfig} error={error} />

      <div className="flex flex-wrap items-center gap-3 pt-1">
        {options.map((opt) => {
          const isSelected = currentValue === opt.value
          return (
            <button
              key={opt.value}
              type="button"
              aria-pressed={isSelected}
              onClick={() => {
                if (isSelected && !fieldConfig.required) {
                  onChange(undefined)
                } else {
                  onChange(opt.value)
                }
              }}
              className={`group flex items-center gap-2 rounded-full border px-2.5 py-1 text-xs transition-all focus-visible:outline-2 focus-visible:outline-accent ${
                isSelected
                  ? "border-accent bg-accent/10 font-medium text-text-primary shadow-xs ring-1 ring-accent"
                  : "border-border-soft bg-surface text-text-muted hover:border-border hover:text-text-primary"
              }`}
              title={opt.label}
              data-testid={`swatch-option-${opt.value}`}
            >
              <span
                className="size-3.5 rounded-full border border-black/20 shadow-inner"
                style={{ backgroundColor: opt.color }}
                aria-hidden="true"
              />
              <span>{opt.label}</span>
            </button>
          )
        })}
      </div>
    </fieldset>
  )
}
