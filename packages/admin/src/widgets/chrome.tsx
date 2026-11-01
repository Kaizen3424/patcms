/** Shared widget chrome — one input look, one label/hint/error pattern. */
import type { BaseFieldDescriptor } from "patcms/advanced"
import type { ReactNode } from "react"

export const INPUT_CLASS =
  "w-full rounded-lg border border-border-soft bg-surface-raised px-3 py-2 text-sm text-text-primary outline-none transition-colors placeholder:text-text-muted/60 focus-visible:border-accent/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-60"

export function inputClass(error: string | undefined): string {
  return error === undefined ? INPUT_CLASS : `${INPUT_CLASS} border-danger/60`
}

/** `aria-describedby` target list — hint and error, each present only when real. */
export function describedBy(
  id: string,
  field: BaseFieldDescriptor,
  error: string | undefined,
): string | undefined {
  const ids: string[] = []
  if (field.hint !== undefined) ids.push(`${id}-hint`)
  if (error !== undefined) ids.push(`${id}-error`)
  return ids.length === 0 ? undefined : ids.join(" ")
}

export function WidgetFrame({
  id,
  field,
  error,
  children,
}: {
  readonly id: string
  readonly field: BaseFieldDescriptor
  readonly error: string | undefined
  readonly children: ReactNode
}) {
  return (
    <div className="grid gap-1.5">
      <label htmlFor={id} className="text-xs font-medium tracking-wide text-text-muted">
        {field.label}
        {field.required ? (
          <span className="ml-1 text-danger" aria-hidden="true">
            *
          </span>
        ) : null}
      </label>
      {children}
      <FieldMessages id={id} field={field} error={error} />
    </div>
  )
}

export function FieldMessages({
  id,
  field,
  error,
}: {
  readonly id: string
  readonly field: BaseFieldDescriptor
  readonly error: string | undefined
}) {
  return (
    <>
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
    </>
  )
}
