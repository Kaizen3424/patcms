/**
 * List widget — a repeater over scalar or object items. Object items render
 * their own field set inline; scalar items render the single item field.
 * `foldFieldDefaults` supplies starter items for required lists on new
 * entries; this widget supplies them when the user adds one.
 */

import type { ListFieldDescriptor } from "patcms"
import { foldFieldDefaults, mustacheLite } from "patcms"
import type { WidgetProps } from "./contract"
import { FieldList } from "./FieldList"
import { ScalarInput } from "./ScalarInput"

export function ListWidget({
  field,
  value,
  onChange,
  idPrefix = "panel",
}: WidgetProps<ListFieldDescriptor> & { readonly idPrefix?: string }) {
  const items = Array.isArray(value) ? value : []
  const atMax = field.max !== undefined && items.length >= field.max

  const replaceItem = (index: number, next: unknown): void => {
    onChange(items.map((item, position) => (position === index ? next : item)))
  }
  const removeItem = (index: number): void => {
    const next = items.filter((_, position) => position !== index)
    onChange(next.length === 0 ? undefined : next)
  }
  const moveItem = (index: number, delta: -1 | 1): void => {
    const target = index + delta
    if (target < 0 || target >= items.length) return
    const next = [...items]
    const swapped = next[index]
    next[index] = next[target]
    next[target] = swapped
    onChange(next)
  }
  const addItem = (): void => {
    onChange([...items, newListItem(field)])
  }

  return (
    <div className="panel-list">
      {items.map((item, index) => {
        const summary =
          field.summary === undefined ? null : mustacheLite(field.summary, asRecord(item)).trim()
        return (
          <fieldset key={index} className="panel-list-item">
            <legend className="panel-list-legend">
              <span>{summary === null || summary === "" ? `Item ${index + 1}` : summary}</span>
              <span className="panel-list-actions">
                <button
                  type="button"
                  className="panel-btn-icon"
                  aria-label="Move up"
                  disabled={index === 0}
                  onClick={() => moveItem(index, -1)}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="panel-btn-icon"
                  aria-label="Move down"
                  disabled={index === items.length - 1}
                  onClick={() => moveItem(index, 1)}
                >
                  ↓
                </button>
                <button
                  type="button"
                  className="panel-btn-icon panel-btn-danger"
                  aria-label="Remove item"
                  onClick={() => removeItem(index)}
                >
                  ✕
                </button>
              </span>
            </legend>
            {field.itemMode === "scalar" ? (
              <ScalarInput
                field={scalarField(field)}
                value={item}
                onChange={(next) => replaceItem(index, next)}
                id={`${idPrefix}-${index}`}
              />
            ) : (
              <FieldList
                fields={field.fields}
                value={asRecord(item)}
                onChange={(next) => replaceItem(index, next)}
                idPrefix={`${idPrefix}-${index}`}
              />
            )}
          </fieldset>
        )
      })}
      <button type="button" className="panel-btn" disabled={atMax} onClick={addItem}>
        Add item
      </button>
    </div>
  )
}

function scalarField(field: ListFieldDescriptor) {
  const child = field.fields[0]
  if (child === undefined || child.type === "divider") {
    throw new Error(`list ${field.name}: scalar lists need exactly one item field`)
  }
  return child
}

function asRecord(item: unknown): Record<string, unknown> {
  return typeof item === "object" && item !== null && !Array.isArray(item)
    ? (item as Record<string, unknown>)
    : {}
}

function newListItem(field: ListFieldDescriptor): unknown {
  if (field.itemMode === "scalar") {
    const child = field.fields[0]
    return child !== undefined && "defaultValue" in child && child.defaultValue !== undefined
      ? child.defaultValue
      : ""
  }
  const item: Record<string, unknown> = {}
  foldFieldDefaults(field.fields, item)
  return item
}
