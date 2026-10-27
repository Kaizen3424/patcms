/**
 * Admin widget registry — `defineWidget(fieldTypeName, Component)` joined to
 * the core field types BY NAME (ADR-0009 §1). P2.6 ships the six editing
 * widgets; list/object/image/relation/hidden/slug stay read-only in the entry
 * screen until P3.
 */
import { BooleanWidget } from "./boolean-widget"
import { createWidgetRegistry, defineWidget } from "./contract"
import { DatetimeWidget } from "./datetime-widget"
import { NumberWidget } from "./number-widget"
import { SelectWidget } from "./select-widget"
import { StringWidget } from "./string-widget"
import { TextWidget } from "./text-widget"

export type {
  WidgetBinding,
  WidgetProps,
  WidgetRegistry,
} from "./contract"
export { createWidgetRegistry, defineWidget } from "./contract"

export const WIDGETS = [
  defineWidget({ fieldTypeName: "string", Component: StringWidget }),
  defineWidget({ fieldTypeName: "text", Component: TextWidget }),
  defineWidget({ fieldTypeName: "number", Component: NumberWidget }),
  defineWidget({ fieldTypeName: "boolean", Component: BooleanWidget }),
  defineWidget({ fieldTypeName: "select", Component: SelectWidget }),
  defineWidget({ fieldTypeName: "datetime", Component: DatetimeWidget }),
] as const

/** The default registry the editor renders from. */
export const defaultWidgetRegistry = createWidgetRegistry(WIDGETS)

/** Field types P2.6 can EDIT; everything else renders read-only. */
export const EDITABLE_FIELD_TYPES: ReadonlySet<string> = new Set(
  defaultWidgetRegistry.fieldTypeNames,
)
