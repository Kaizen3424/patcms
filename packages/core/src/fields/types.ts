/**
 * Field vocabulary + metadata contracts. The 12 value types are pinned by
 * ADR-0003; `divider` is a decoration declaration, not a value.
 */
import type { z } from "zod"

export type FieldTypeName =
  | "string"
  | "text"
  | "number"
  | "boolean"
  | "select"
  | "datetime"
  | "list"
  | "object"
  | "image"
  | "relation"
  | "hidden"
  | "slug"

export type FieldWidth = "full" | "half"
export type StringFormat = "email" | "url"

export interface SelectOption {
  readonly label: string
  readonly value: string
}

export interface NamedFieldSchema {
  readonly name: string
  readonly schema: z.ZodType
}

export interface BaseFieldMeta {
  readonly type: FieldTypeName
  readonly label: string
  readonly hint?: string
  readonly required: boolean
  readonly defaultValue?: unknown
  readonly width?: FieldWidth
}

export interface StringFieldMeta extends BaseFieldMeta {
  readonly type: "string"
  readonly format?: StringFormat
  readonly minLength?: number
  readonly maxLength?: number
  readonly pattern?: string
}

export interface TextFieldMeta extends BaseFieldMeta {
  readonly type: "text"
  readonly minLength?: number
  readonly maxLength?: number
}

export interface NumberFieldMeta extends BaseFieldMeta {
  readonly type: "number"
  readonly int?: boolean
  readonly min?: number
  readonly max?: number
}

export interface BooleanFieldMeta extends BaseFieldMeta {
  readonly type: "boolean"
}

export interface SelectFieldMeta extends BaseFieldMeta {
  readonly type: "select"
  readonly options: readonly SelectOption[]
  readonly multiple?: boolean
}

export interface DatetimeFieldMeta extends BaseFieldMeta {
  readonly type: "datetime"
  readonly dateOnly?: boolean
}

export interface ListFieldMeta extends BaseFieldMeta {
  readonly type: "list"
  readonly itemMode: "object" | "scalar"
  readonly fields: readonly NamedFieldSchema[]
  readonly min?: number
  readonly max?: number
  readonly summary?: string
}

export interface ObjectFieldMeta extends BaseFieldMeta {
  readonly type: "object"
  readonly fields: readonly NamedFieldSchema[]
}

export interface ImageFieldMeta extends BaseFieldMeta {
  readonly type: "image"
  readonly extensions?: readonly string[]
}

export interface RelationFieldMeta extends BaseFieldMeta {
  readonly type: "relation"
  readonly collection: string
  readonly multiple?: boolean
  readonly valueField?: string
  readonly displayFields?: readonly string[]
  readonly searchFields?: readonly string[]
}

export interface HiddenFieldMeta extends BaseFieldMeta {
  readonly type: "hidden"
  readonly siteEffect?: string
}

export interface SlugFieldMeta extends BaseFieldMeta {
  readonly type: "slug"
}

export type FieldMeta =
  | StringFieldMeta
  | TextFieldMeta
  | NumberFieldMeta
  | BooleanFieldMeta
  | SelectFieldMeta
  | DatetimeFieldMeta
  | ListFieldMeta
  | ObjectFieldMeta
  | ImageFieldMeta
  | RelationFieldMeta
  | HiddenFieldMeta
  | SlugFieldMeta

/** JSON-safe field descriptor emitted by `toAdminConfig`. */
export interface BaseFieldDescriptor {
  readonly name: string
  readonly label: string
  readonly required: boolean
  readonly hint?: string
  readonly width?: FieldWidth
  readonly defaultValue?: unknown
}

export interface StringFieldDescriptor extends BaseFieldDescriptor {
  readonly type: "string"
  readonly format?: StringFormat
  readonly minLength?: number
  readonly maxLength?: number
  readonly pattern?: string
}

export interface TextFieldDescriptor extends BaseFieldDescriptor {
  readonly type: "text"
  readonly minLength?: number
  readonly maxLength?: number
}

export interface NumberFieldDescriptor extends BaseFieldDescriptor {
  readonly type: "number"
  readonly int?: boolean
  readonly min?: number
  readonly max?: number
}

export interface BooleanFieldDescriptor extends BaseFieldDescriptor {
  readonly type: "boolean"
}

export interface SelectFieldDescriptor extends BaseFieldDescriptor {
  readonly type: "select"
  readonly options: readonly SelectOption[]
  readonly multiple?: boolean
}

export interface DatetimeFieldDescriptor extends BaseFieldDescriptor {
  readonly type: "datetime"
  readonly dateOnly?: boolean
}

export interface ListFieldDescriptor extends BaseFieldDescriptor {
  readonly type: "list"
  readonly itemMode: "object" | "scalar"
  readonly fields: readonly FieldDescriptor[]
  readonly min?: number
  readonly max?: number
  readonly summary?: string
}

export interface ObjectFieldDescriptor extends BaseFieldDescriptor {
  readonly type: "object"
  readonly fields: readonly FieldDescriptor[]
}

export interface ImageFieldDescriptor extends BaseFieldDescriptor {
  readonly type: "image"
  readonly extensions?: readonly string[]
}

export interface RelationFieldDescriptor extends BaseFieldDescriptor {
  readonly type: "relation"
  readonly collection: string
  readonly multiple?: boolean
  readonly valueField?: string
  readonly displayFields?: readonly string[]
  readonly searchFields?: readonly string[]
}

export interface HiddenFieldDescriptor extends BaseFieldDescriptor {
  readonly type: "hidden"
  readonly siteEffect?: string
}

export interface SlugFieldDescriptor extends BaseFieldDescriptor {
  readonly type: "slug"
}

export interface DividerFieldDescriptor {
  readonly type: "divider"
  readonly label?: string
}

export type FieldDescriptor =
  | StringFieldDescriptor
  | TextFieldDescriptor
  | NumberFieldDescriptor
  | BooleanFieldDescriptor
  | SelectFieldDescriptor
  | DatetimeFieldDescriptor
  | ListFieldDescriptor
  | ObjectFieldDescriptor
  | ImageFieldDescriptor
  | RelationFieldDescriptor
  | HiddenFieldDescriptor
  | SlugFieldDescriptor
  | DividerFieldDescriptor

export interface DividerDeclaration {
  /** Field name this divider appears before. */
  readonly before: string
  readonly label?: string
}
