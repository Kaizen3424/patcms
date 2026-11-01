/**
 * Admin widget registry — `defineWidget(fieldTypeName, Component)` joined to
 * the core field types BY NAME (ADR-0009 §1).
 */
import type { SelectFieldDescriptor } from "patcms/advanced"
import { BooleanWidget } from "./boolean-widget"
import { createWidgetRegistry, defineWidget } from "./contract"
import { DatetimeWidget } from "./datetime-widget"
import { ImageWidget } from "./image-widget"
import { ListWidget } from "./list-widget"
import { NumberWidget } from "./number-widget"
import { ObjectWidget } from "./object-widget"
import { ReferenceSwatchWidget } from "./reference-swatch/reference-swatch"
import { RelationWidget } from "./relation-widget"
import { SelectWidget } from "./select-widget"
import { StringWidget } from "./string-widget"
import { TextWidget } from "./text-widget"

export { useWidgetRegistry, WidgetRegistryProvider } from "./context"
export type {
  WidgetBinding,
  WidgetProps,
  WidgetRegistry,
  WidgetServices,
  WidgetTypeName,
} from "./contract"
export { createWidgetRegistry, defineWidget } from "./contract"
export { findNestedIssues, stripIssuePrefix } from "./nested-issues"

export {
  BooleanWidget,
  DatetimeWidget,
  ImageWidget,
  ListWidget,
  NumberWidget,
  ObjectWidget,
  ReferenceSwatchWidget,
  RelationWidget,
  SelectWidget,
  StringWidget,
  TextWidget,
}

export const WIDGETS = [
  defineWidget({ fieldTypeName: "string", Component: StringWidget }),
  defineWidget({ fieldTypeName: "text", Component: TextWidget }),
  defineWidget({ fieldTypeName: "number", Component: NumberWidget }),
  defineWidget({ fieldTypeName: "boolean", Component: BooleanWidget }),
  defineWidget({ fieldTypeName: "select", Component: SelectWidget }),
  defineWidget({ fieldTypeName: "datetime", Component: DatetimeWidget }),
  defineWidget({ fieldTypeName: "list", Component: ListWidget }),
  defineWidget({ fieldTypeName: "object", Component: ObjectWidget }),
  defineWidget({ fieldTypeName: "image", Component: ImageWidget }),
  defineWidget({ fieldTypeName: "relation", Component: RelationWidget }),
  defineWidget<SelectFieldDescriptor>({
    fieldTypeName: "swatch",
    Component: ReferenceSwatchWidget,
  }),
] as const

/** The default registry the editor renders from. */
export const defaultWidgetRegistry = createWidgetRegistry(WIDGETS)

/** Field types that can be edited in the editor. */
export const EDITABLE_FIELD_TYPES: ReadonlySet<string> = new Set(
  defaultWidgetRegistry.fieldTypeNames,
)
