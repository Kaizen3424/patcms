import type { ObjectFieldDescriptor } from "patcms/advanced"
import { useId } from "react"
import { FieldMessages } from "./chrome"
import { useWidgetRegistry } from "./context"
import type { WidgetProps } from "./contract"
import { stripIssuePrefix } from "./nested-issues"

export function ObjectWidget({
  value,
  onChange,
  error,
  fieldConfig,
  services,
  nestedIssues,
}: WidgetProps<ObjectFieldDescriptor>) {
  const id = useId()
  const registry = useWidgetRegistry()
  const record =
    typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {}

  const handleChildChange = (childName: string, childValue: unknown) => {
    const next: Record<string, unknown> = { ...record }
    if (childValue === undefined) {
      delete next[childName]
    } else {
      Object.defineProperty(next, childName, {
        value: childValue,
        enumerable: true,
        configurable: true,
        writable: true,
      })
    }
    onChange(next)
  }

  return (
    <fieldset
      id={id}
      className="rounded-card border border-border-soft bg-surface/30 p-4 transition-colors"
      data-testid={`object-widget-${fieldConfig.name}`}
    >
      <legend className="px-1 text-xs font-semibold uppercase tracking-wider text-text-muted">
        {fieldConfig.label}
        {fieldConfig.required ? (
          <span className="ml-1 text-danger" aria-hidden="true">
            *
          </span>
        ) : null}
      </legend>
      <FieldMessages id={id} field={fieldConfig} error={error} />

      <div className="mt-3 grid gap-x-6 gap-y-4 sm:grid-cols-2">
        {fieldConfig.fields
          .filter((field) => field.type !== "divider" && field.type !== "hidden")
          .map((child) => {
            const widgetKey =
              (child as { widget?: string }).widget ||
              (registry.get(child.name) ? child.name : child.type)
            const binding = registry.get(widgetKey)
            const childIssues = stripIssuePrefix(nestedIssues, child.name)
            const childError = childIssues.find((issue) => issue.path === "")?.message

            return (
              <div
                key={child.name}
                className={child.width === "half" ? "sm:col-span-1" : "sm:col-span-2"}
              >
                {binding === undefined ? (
                  <div className="text-xs text-text-muted">
                    <span className="font-medium">{child.label}</span>: Unsupported field type{" "}
                    <code className="text-text-primary">{child.type}</code>
                  </div>
                ) : (
                  <binding.Component
                    value={record[child.name]}
                    onChange={(newVal) => handleChildChange(child.name, newVal)}
                    error={childError}
                    fieldConfig={child}
                    services={services}
                    nestedIssues={childIssues}
                  />
                )}
              </div>
            )
          })}
      </div>
    </fieldset>
  )
}
