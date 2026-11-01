/**
 * Relation widget — options come from the related collection's entry list.
 * The stored value is the descriptor's `valueField` template rendered against
 * the target entry (defaulting to the slug); the label comes from
 * `displayFields`. A stored value that no longer matches any entry renders as
 * a missing-reference chip instead of silently disappearing.
 */

import type { EntrySummary, RelationFieldDescriptor } from "patcms"
import { mustacheLite } from "patcms"
import { useEffect, useState } from "react"
import type { WidgetProps } from "./contract"
import { usePanelScope } from "./scope"

export function RelationWidget({ field, value, onChange }: WidgetProps<RelationFieldDescriptor>) {
  const scope = usePanelScope()
  const [targets, setTargets] = useState<readonly EntrySummary[]>([])

  useEffect(() => {
    let alive = true
    void scope.cms.entries
      .list(field.collection)
      .then((listed) => {
        if (alive) setTargets(listed)
      })
      .catch(() => {
        if (alive) setTargets([])
      })
    return () => {
      alive = false
    }
  }, [scope.cms, field.collection])

  const storedFor = (entry: EntrySummary): string =>
    mustacheLite(field.valueField ?? "{{slug}}", entry.value)
  const labelFor = (entry: EntrySummary): string => {
    const fields = field.displayFields ?? ["title"]
    const rendered = fields
      .map((name) => mustacheLite(`{{${name}}}`, entry.value).trim())
      .filter((part) => part.length > 0)
      .join(" · ")
    return rendered.length > 0 ? rendered : entry.slug
  }

  const isMultiple = field.multiple === true
  const selected = isMultiple
    ? Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string")
      : []
    : typeof value === "string" && value !== ""
      ? [value]
      : []

  const known = new Set(targets.map(storedFor))
  const missing = selected.filter((slug) => !known.has(slug))

  const setSingle = (next: string): void => {
    onChange(next === "" ? undefined : next)
  }
  const toggle = (stored: string, checked: boolean): void => {
    const next = checked ? [...selected, stored] : selected.filter((item) => item !== stored)
    onChange(next.length === 0 ? undefined : next)
  }

  if (isMultiple) {
    return (
      <div className="panel-check-group">
        {targets.map((entry) => {
          const stored = storedFor(entry)
          return (
            <label key={entry.slug} className="panel-check">
              <input
                type="checkbox"
                checked={selected.includes(stored)}
                onChange={(event) => toggle(stored, event.target.checked)}
              />
              <span>{labelFor(entry)}</span>
            </label>
          )
        })}
        {missing.map((slug) => (
          <p key={slug} className="panel-error">
            Missing reference: {slug}
          </p>
        ))}
      </div>
    )
  }

  return (
    <div>
      <select
        className="panel-input"
        value={selected[0] ?? ""}
        onChange={(event) => setSingle(event.target.value)}
      >
        <option value="">— none —</option>
        {targets.map((entry) => {
          const stored = storedFor(entry)
          return (
            <option key={entry.slug} value={stored}>
              {labelFor(entry)}
            </option>
          )
        })}
      </select>
      {missing.map((slug) => (
        <p key={slug} className="panel-error">
          Missing reference: {slug}
        </p>
      ))}
    </div>
  )
}
