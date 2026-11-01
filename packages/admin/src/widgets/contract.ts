/**
 * Admin widget contract — the admin half of ADR-0009's dual registry, joined
 * to the core field types BY NAME. `WidgetProps` is the pinned v0 subset:
 * `{ value, onChange, error, fieldConfig }`. The async half (`useField()`,
 * `services`) arrives with the list/object/relation widgets (P3.1/P3.3) per
 * the ADR-0009 P2.6 note.
 *
 * Standing veto: no `backend`, no credential, no transport in `WidgetProps`.
 * A widget is a pure function of its value + descriptor.
 */
import type { FieldDescriptor, ParseIssue, StagedMediaTileRecord } from "patcms/advanced"
import type { ComponentType } from "react"
import type { IndexedEntry } from "../runtime/entry-index"

export interface WidgetServices {
  readonly getEntries: (collection: string) => readonly IndexedEntry[]
  readonly getEntryBySlug: (collection: string, slug: string) => IndexedEntry | undefined
  readonly searchEntries: (
    collection: string,
    query: string,
    fields: readonly string[],
  ) => readonly IndexedEntry[]
  readonly stageMedia?: (
    file: File,
    options?: { collection?: string; targetFilename?: string },
  ) => Promise<{ publicPath: string; tile: StagedMediaTileRecord }>
  readonly listStagedMedia?: () => Promise<readonly StagedMediaTileRecord[]>
  readonly resolveMediaSha?: (path: string) => string | undefined
}

export interface WidgetProps<F extends FieldDescriptor = FieldDescriptor> {
  readonly value: unknown
  /** Writes one value; `undefined` means "not set" (the key is removed). */
  readonly onChange: (value: unknown) => void
  /** Save-gate message for this field, when one applies. */
  readonly error: string | undefined
  readonly fieldConfig: F
  readonly services?: WidgetServices
  readonly nestedIssues?: readonly ParseIssue[]
}

export type WidgetTypeName = FieldDescriptor["type"] | (string & {})

export interface WidgetBinding {
  readonly fieldTypeName: WidgetTypeName
  readonly Component: ComponentType<WidgetProps>
}

/**
 * Registers one component for one field type. The cast is the seam ADR-0009
 * describes: React props are contravariant, so per-type props cannot be stored
 * in a homogeneous table.
 */
export function defineWidget<F extends FieldDescriptor = FieldDescriptor>(input: {
  readonly fieldTypeName: WidgetTypeName
  readonly Component: ComponentType<WidgetProps<F>>
}): WidgetBinding {
  return {
    fieldTypeName: input.fieldTypeName,
    Component: input.Component as unknown as ComponentType<WidgetProps>,
  }
}

export interface WidgetRegistry {
  get(fieldTypeName: string): WidgetBinding | undefined
  readonly fieldTypeNames: readonly string[]
}

export function createWidgetRegistry(bindings: readonly WidgetBinding[]): WidgetRegistry {
  const byName = new Map<string, WidgetBinding>()
  for (const binding of bindings) {
    if (byName.has(binding.fieldTypeName)) {
      throw new Error(`duplicate widget binding for ${binding.fieldTypeName}`)
    }
    byName.set(binding.fieldTypeName, binding)
  }
  return {
    get: (fieldTypeName) => byName.get(fieldTypeName),
    fieldTypeNames: [...byName.keys()],
  }
}
