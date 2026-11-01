import type { FieldDescriptor, HiddenFieldDescriptor } from "patcms/advanced"
import { useState } from "react"

export interface BehindTheScenesProps {
  readonly fields: readonly FieldDescriptor[]
  readonly value: Record<string, unknown>
  readonly supportName?: string
}

export function BehindTheScenesDrawer({
  fields,
  value,
  supportName = "your web partner",
}: BehindTheScenesProps) {
  const [isOpen, setIsOpen] = useState(false)

  const hiddenFields = fields.filter(
    (field): field is HiddenFieldDescriptor => field.type === "hidden",
  )

  if (hiddenFields.length === 0) {
    return null
  }

  return (
    <div
      className="mt-8 rounded-card border border-border-soft bg-surface/40 p-4 transition-colors"
      data-testid="behind-the-scenes-drawer"
    >
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        aria-expanded={isOpen}
        className="flex w-full items-center justify-between text-left text-xs font-semibold uppercase tracking-wider text-text-muted hover:text-text-primary focus-visible:outline-2 focus-visible:outline-accent"
      >
        <span>Behind the scenes — managed by {supportName}</span>
        <span className="text-sm font-normal text-text-muted transition-transform">
          {isOpen ? "▲" : "▼"}
        </span>
      </button>

      {isOpen ? (
        <div className="mt-4 space-y-3 border-t border-border-soft/60 pt-3">
          <p className="text-xs text-text-muted">
            These settings work quietly behind the scenes to keep your website looking sharp.
          </p>

          <div className="divide-y divide-border-soft/50">
            {hiddenFields.map((field) => {
              const rawValue = value[field.name]
              const displayVal = formatDisplayValue(rawValue)
              const siteEffect = field.siteEffect || "Not shown on your site right now"

              return (
                <div key={field.name} className="py-2.5 first:pt-0 last:pb-0">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="text-xs font-medium text-text-primary">{field.label}</span>
                    <span className="font-mono text-xs text-text-muted">{displayVal}</span>
                  </div>
                  <p className="mt-0.5 text-[11px] text-text-muted/80">{siteEffect}</p>
                </div>
              )
            })}
          </div>
        </div>
      ) : null}
    </div>
  )
}

function formatDisplayValue(val: unknown): string {
  if (val === undefined || val === null || val === "") {
    return "(default)"
  }
  if (typeof val === "boolean") {
    return val ? "yes" : "no"
  }
  if (typeof val === "object") {
    return JSON.stringify(val)
  }
  return String(val)
}
