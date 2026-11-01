import type { FieldDescriptor, ListFieldDescriptor, ParseIssue } from "patcms/advanced"
import { mustacheLite } from "patcms/advanced"
import { useId, useRef, useState } from "react"
import { FieldMessages } from "./chrome"
import { useWidgetRegistry } from "./context"
import type { WidgetProps } from "./contract"
import { stripIssuePrefix } from "./nested-issues"

let nextClientId = 1

export function ListWidget({
  value,
  onChange,
  error,
  fieldConfig,
  services,
  nestedIssues,
}: WidgetProps<ListFieldDescriptor>) {
  const id = useId()
  const registry = useWidgetRegistry()
  const [announcement, setAnnouncement] = useState("")

  // Stable client key tracking across reorders without serializing to data
  const clientIdMap = useRef<WeakMap<object, string>>(new WeakMap())
  const primitiveIdMap = useRef<Map<number, string>>(new Map())

  const items = Array.isArray(value) ? value : []
  const min = fieldConfig.min ?? 0
  const max = fieldConfig.max ?? Number.POSITIVE_INFINITY

  const canAdd = items.length < max
  const canRemove = items.length > min

  const getItemKey = (item: unknown, index: number): string => {
    if (typeof item === "object" && item !== null) {
      let key = clientIdMap.current.get(item)
      if (!key) {
        key = `obj-${nextClientId++}`
        clientIdMap.current.set(item, key)
      }
      return key
    }
    let key = primitiveIdMap.current.get(index)
    if (!key) {
      key = `prim-${nextClientId++}`
      primitiveIdMap.current.set(index, key)
    }
    return key
  }

  const handleMove = (fromIndex: number, toIndex: number) => {
    if (toIndex < 0 || toIndex >= items.length) return
    const next = [...items]
    const [moved] = next.splice(fromIndex, 1)
    if (moved === undefined) return
    next.splice(toIndex, 0, moved)
    onChange(next)
    setAnnouncement(`Item ${fromIndex + 1} of ${items.length} moved to position ${toIndex + 1}`)
  }

  const handleRemove = (index: number) => {
    if (!canRemove) return
    const next = items.filter((_, i) => i !== index)
    onChange(next)
    setAnnouncement(`Removed item. ${next.length} remaining`)
  }

  const handleAdd = () => {
    if (!canAdd) return
    const newItem = createDefaultItem(fieldConfig)
    const next = [...items, newItem]
    onChange(next)
    setAnnouncement(`Added new item. ${next.length} total`)
  }

  const handleItemChange = (index: number, nextItem: unknown) => {
    const next = [...items]
    next[index] = nextItem
    onChange(next)
  }

  const removeDisabledReason = !canRemove
    ? min > 0
      ? `Keep at least ${min} item${min === 1 ? "" : "s"}`
      : undefined
    : undefined

  const addDisabledReason = !canAdd
    ? `At most ${max} item${max === 1 ? "" : "s"} allowed`
    : undefined

  return (
    <fieldset
      id={id}
      className="rounded-card border border-border-soft bg-surface/20 p-4 transition-colors"
      data-testid={`list-widget-${fieldConfig.name}`}
    >
      <div className="flex items-center justify-between gap-4">
        <legend className="px-1 text-xs font-semibold uppercase tracking-wider text-text-muted">
          {fieldConfig.label}
          {fieldConfig.required ? (
            <span className="ml-1 text-danger" aria-hidden="true">
              *
            </span>
          ) : null}
          <span className="ml-2 font-normal lowercase tracking-normal text-text-muted/70">
            ({items.length}
            {Number.isFinite(max) ? `/${max}` : ""})
          </span>
        </legend>

        {canAdd ? (
          <button
            type="button"
            onClick={handleAdd}
            className="rounded-lg border border-border-soft bg-surface px-2.5 py-1 text-xs font-medium text-accent transition-colors hover:border-accent hover:bg-accent/10 focus-visible:outline-2 focus-visible:outline-accent"
          >
            + Add {fieldConfig.label.replace(/s$/, "") || "item"}
          </button>
        ) : (
          <span className="text-[11px] text-text-muted" title={addDisabledReason}>
            {addDisabledReason}
          </span>
        )}
      </div>

      <FieldMessages id={id} field={fieldConfig} error={error} />

      {/* Screen reader live region for reorder & mutation announcements */}
      <div aria-live="polite" aria-atomic="true" className="sr-only">
        {announcement}
      </div>

      {items.length === 0 ? (
        <p className="mt-3 text-xs italic text-text-muted">No items added yet.</p>
      ) : (
        <div className="mt-4 space-y-3">
          {items.map((item, index) => {
            const itemKey = getItemKey(item, index)
            const itemIssues = stripIssuePrefix(nestedIssues, `[${index}]`)
            const itemError = itemIssues.find((issue) => issue.path === "")?.message

            const summaryText =
              fieldConfig.summary && typeof item === "object" && item !== null
                ? mustacheLite(fieldConfig.summary, {
                    fields: item as Record<string, unknown>,
                    ...(item as Record<string, unknown>),
                  })
                : undefined

            return (
              <div
                key={itemKey}
                className="rounded-lg border border-border-soft bg-surface p-3 transition-colors"
                data-testid={`list-item-${fieldConfig.name}-${index}`}
              >
                {/* Item header controls */}
                <div className="mb-2 flex items-center justify-between gap-2 border-b border-border-soft/60 pb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-semibold text-text-muted">#{index + 1}</span>
                    {summaryText ? (
                      <span className="truncate text-xs font-medium text-text-primary">
                        {summaryText}
                      </span>
                    ) : null}
                  </div>

                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      disabled={index === 0}
                      onClick={() => handleMove(index, index - 1)}
                      aria-label={`Move item ${index + 1} up`}
                      className="rounded px-1.5 py-0.5 text-xs text-text-muted transition-colors hover:bg-surface-raised hover:text-text-primary disabled:opacity-30"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      disabled={index === items.length - 1}
                      onClick={() => handleMove(index, index + 1)}
                      aria-label={`Move item ${index + 1} down`}
                      className="rounded px-1.5 py-0.5 text-xs text-text-muted transition-colors hover:bg-surface-raised hover:text-text-primary disabled:opacity-30"
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      disabled={!canRemove}
                      title={removeDisabledReason}
                      onClick={() => handleRemove(index)}
                      aria-label={`Remove item ${index + 1}`}
                      className="ml-2 rounded px-2 py-0.5 text-xs text-danger/80 transition-colors hover:bg-danger/10 hover:text-danger disabled:opacity-30"
                    >
                      Remove
                    </button>
                  </div>
                </div>

                {itemError ? (
                  <p role="alert" className="mb-2 text-[11px] text-danger">
                    {itemError}
                  </p>
                ) : null}

                {/* Item contents */}
                {fieldConfig.itemMode === "scalar" && fieldConfig.fields[0] ? (
                  <RenderScalarItem
                    fieldConfig={fieldConfig.fields[0]}
                    value={item}
                    onChange={(nextVal) => handleItemChange(index, nextVal)}
                    error={itemError}
                    services={services}
                    nestedIssues={itemIssues}
                  />
                ) : (
                  <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
                    {fieldConfig.fields
                      .filter((f) => f.type !== "divider" && f.type !== "hidden")
                      .map((child) => {
                        const widgetKey =
                          (child as { widget?: string }).widget ||
                          (registry.get(child.name) ? child.name : child.type)
                        const binding = registry.get(widgetKey)
                        const childIssues = stripIssuePrefix(itemIssues, child.name)
                        const childError = childIssues.find((issue) => issue.path === "")?.message
                        const record =
                          typeof item === "object" && item !== null
                            ? (item as Record<string, unknown>)
                            : {}

                        return (
                          <div
                            key={child.name}
                            className={child.width === "half" ? "sm:col-span-1" : "sm:col-span-2"}
                          >
                            {binding === undefined ? (
                              <div className="text-xs text-text-muted">
                                <span className="font-medium">{child.label}</span>: Unsupported
                                field type <code className="text-text-primary">{child.type}</code>
                              </div>
                            ) : (
                              <binding.Component
                                value={record[child.name]}
                                onChange={(val) => {
                                  const updated = { ...record }
                                  if (val === undefined) {
                                    delete updated[child.name]
                                  } else {
                                    Object.defineProperty(updated, child.name, {
                                      value: val,
                                      enumerable: true,
                                      configurable: true,
                                      writable: true,
                                    })
                                  }
                                  handleItemChange(index, updated)
                                }}
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
                )}
              </div>
            )
          })}
        </div>
      )}
    </fieldset>
  )
}

function RenderScalarItem({
  fieldConfig,
  value,
  onChange,
  error,
  services,
  nestedIssues,
}: {
  readonly fieldConfig: FieldDescriptor
  readonly value: unknown
  readonly onChange: (value: unknown) => void
  readonly error: string | undefined
  readonly services?: WidgetProps["services"]
  readonly nestedIssues?: readonly ParseIssue[]
}) {
  const registry = useWidgetRegistry()
  const binding = registry.get(fieldConfig.type)

  if (binding === undefined) {
    return (
      <div className="text-xs text-text-muted">
        Unsupported scalar type: <code className="text-text-primary">{fieldConfig.type}</code>
      </div>
    )
  }

  return (
    <binding.Component
      value={value}
      onChange={onChange}
      error={error}
      fieldConfig={fieldConfig}
      services={services}
      nestedIssues={nestedIssues}
    />
  )
}

function createDefaultItem(fieldConfig: ListFieldDescriptor): unknown {
  if (fieldConfig.itemMode === "scalar") {
    const child = fieldConfig.fields[0]
    return child && "defaultValue" in child ? child.defaultValue : ""
  }
  const item: Record<string, unknown> = {}
  for (const child of fieldConfig.fields) {
    if (child.type === "divider" || child.type === "slug") continue
    if (child.defaultValue !== undefined) {
      item[child.name] = child.defaultValue
    } else if (child.type === "list") {
      item[child.name] = []
    } else if (child.type === "object") {
      item[child.name] = {}
    } else if (child.type === "number") {
      item[child.name] = 0
    } else if (child.type === "boolean") {
      item[child.name] = false
    } else {
      item[child.name] = ""
    }
  }
  return item
}
