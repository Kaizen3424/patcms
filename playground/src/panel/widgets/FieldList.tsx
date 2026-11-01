import type { FieldDescriptor } from "patcms"
import type { EditableField, WidgetProps } from "./contract"
import { ImageWidget } from "./ImageWidget"
import { ListWidget } from "./ListWidget"
import { ObjectWidget } from "./ObjectWidget"
import {
  BooleanWidget,
  DatetimeWidget,
  NumberWidget,
  SelectWidget,
  StringWidget,
  TextWidget,
} from "./primitives"
import { RelationWidget } from "./RelationWidget"

/**
 * Field-list renderer — the dispatcher that turns descriptors into inputs.
 * Dividers become section headers, the virtual slug renders read-only, hidden
 * fields render nothing (their value rides along untouched), everything else
 * dispatches by type.
 */
export function FieldList(props: {
  fields: readonly FieldDescriptor[]
  value: Record<string, unknown>
  onChange: (next: Record<string, unknown>) => void
  /** Uniqueness scope for DOM ids — list items and objects nest deeper. */
  idPrefix?: string
}) {
  const idPrefix = props.idPrefix ?? "panel"
  return (
    <div className="panel-fields">
      {props.fields.map((field, index) => (
        <FieldItem
          key={field.type === "divider" ? `divider-${index}` : field.name}
          field={field}
          value={props.value}
          onChange={props.onChange}
          idPrefix={idPrefix}
          index={index}
        />
      ))}
    </div>
  )
}

function FieldItem(props: {
  field: FieldDescriptor
  value: Record<string, unknown>
  onChange: (next: Record<string, unknown>) => void
  idPrefix: string
  index: number
}) {
  const { field } = props
  if (field.type === "divider") {
    return field.label === undefined ? null : <div className="panel-divider">{field.label}</div>
  }
  if (field.type === "hidden") return null
  if (field.type === "slug") {
    const slug = props.value[field.name]
    return (
      <div className="panel-field">
        <span className="panel-label">Slug (derived from the filename)</span>
        <code className="panel-slug-value">{typeof slug === "string" ? slug : "—"}</code>
      </div>
    )
  }
  const setField = (next: unknown): void => {
    props.onChange({ ...props.value, [field.name]: next })
  }
  return (
    <FieldRow
      field={field}
      value={props.value[field.name]}
      onChange={setField}
      id={`${props.idPrefix}-${field.name}`}
    />
  )
}

function FieldRow({
  field,
  value,
  onChange,
  id,
}: WidgetProps<EditableField> & { readonly id: string }) {
  if (field.type === "boolean") {
    return (
      <div className="panel-field panel-field-plain">
        <BooleanWidget field={field} value={value} onChange={onChange} />
        {field.hint === undefined ? null : <p className="panel-hint">{field.hint}</p>}
      </div>
    )
  }
  return (
    <div className={`panel-field${field.width === "half" ? " panel-half" : ""}`}>
      <label className="panel-label" htmlFor={id}>
        {field.label}
        {field.required ? <span className="panel-required"> *</span> : null}
      </label>
      {renderWidget(field, value, onChange, id)}
      {field.hint === undefined ? null : <p className="panel-hint">{field.hint}</p>}
    </div>
  )
}

function renderWidget(
  field: EditableField,
  value: unknown,
  onChange: (next: unknown) => void,
  id: string,
) {
  switch (field.type) {
    case "string":
      return <StringWidget field={field} value={value} onChange={onChange} id={id} />
    case "text":
      return <TextWidget field={field} value={value} onChange={onChange} id={id} />
    case "number":
      return <NumberWidget field={field} value={value} onChange={onChange} id={id} />
    case "boolean":
      return <BooleanWidget field={field} value={value} onChange={onChange} id={id} />
    case "select":
      return <SelectWidget field={field} value={value} onChange={onChange} id={id} />
    case "datetime":
      return <DatetimeWidget field={field} value={value} onChange={onChange} id={id} />
    case "list":
      return <ListWidget field={field} value={value} onChange={onChange} idPrefix={id} />
    case "object":
      return <ObjectWidget field={field} value={value} onChange={onChange} idPrefix={id} />
    case "image":
      return <ImageWidget field={field} value={value} onChange={onChange} />
    case "relation":
      return <RelationWidget field={field} value={value} onChange={onChange} />
  }
}
