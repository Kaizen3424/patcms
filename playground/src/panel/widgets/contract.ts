import type { FieldDescriptor } from "patcms"

/**
 * Widget contract. `EditableField` is every descriptor the dispatcher can
 * route; dividers never reach a widget (they become section headers) and
 * slug/hidden are handled by the dispatcher itself.
 */
export type EditableField = Exclude<FieldDescriptor, { type: "divider" }>

export interface WidgetProps<Field extends EditableField = EditableField> {
  readonly field: Field
  readonly value: unknown
  readonly onChange: (next: unknown) => void
  /** DOM id for label association; widgets fall back to their own useId(). */
  readonly id?: string
}
