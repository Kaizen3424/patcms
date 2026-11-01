import type { ObjectFieldDescriptor } from "patcms"
import type { WidgetProps } from "./contract"
import { FieldList } from "./FieldList"

export function ObjectWidget({ field, value, onChange }: WidgetProps<ObjectFieldDescriptor>) {
  const record =
    typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {}
  return (
    <fieldset className="panel-object">
      <FieldList fields={field.fields} value={record} onChange={onChange} />
    </fieldset>
  )
}
