/**
 * Zod-first factory set (ADR-0003). Each factory returns a zod schema carrying
 * CMS metadata via `.meta({mycms: ...})`; `required:false` wraps with `.optional()`
 * and `default` stays METADATA ONLY (parse never injects it).
 */
import { z } from "zod"
import { getFieldMeta, setFieldMeta } from "./meta"
import type {
  BaseFieldMeta,
  FieldMeta,
  FieldWidth,
  NamedFieldSchema,
  SelectOption,
  StringFormat,
} from "./types"

export interface BaseFieldOptions {
  readonly label: string
  readonly hint?: string
  readonly required?: boolean
  readonly defaultValue?: unknown
  readonly width?: FieldWidth
}

export interface StringFieldOptions extends BaseFieldOptions {
  readonly format?: StringFormat
  readonly minLength?: number
  readonly maxLength?: number
  readonly pattern?: RegExp
}

export interface TextFieldOptions extends BaseFieldOptions {
  readonly minLength?: number
  readonly maxLength?: number
}

export interface NumberFieldOptions extends BaseFieldOptions {
  readonly int?: boolean
  readonly min?: number
  readonly max?: number
}

export type BooleanFieldOptions = BaseFieldOptions

export interface SelectFieldOptions extends BaseFieldOptions {
  readonly options: readonly (string | SelectOption)[]
  readonly multiple?: boolean
}

export interface DatetimeFieldOptions extends BaseFieldOptions {
  readonly dateOnly?: boolean
}

export interface ListFieldOptions extends BaseFieldOptions {
  readonly fields?: Readonly<Record<string, z.ZodType>>
  readonly field?: { readonly name: string; readonly schema: z.ZodType }
  readonly min?: number
  readonly max?: number
  readonly summary?: string
}

export interface ObjectFieldOptions extends BaseFieldOptions {
  readonly fields: Readonly<Record<string, z.ZodType>>
}

export interface ImageFieldOptions extends BaseFieldOptions {
  readonly pattern?: RegExp
  readonly extensions?: readonly string[]
}

export interface RelationFieldOptions extends BaseFieldOptions {
  readonly collection: string
  readonly multiple?: boolean
  readonly valueField?: string
  readonly displayFields?: readonly string[]
  readonly searchFields?: readonly string[]
}

export interface HiddenFieldOptions extends BaseFieldOptions {
  readonly siteEffect?: string
}
export type SlugFieldOptions = Pick<BaseFieldOptions, "label" | "hint" | "width">

export function defineField<T extends z.ZodType>(schema: T, meta: FieldMeta): T {
  return setFieldMeta(schema, meta)
}

function baseMeta(
  type: FieldMeta["type"],
  options: BaseFieldOptions,
  requiredDefault = true,
): BaseFieldMeta {
  return {
    type,
    label: options.label,
    hint: options.hint,
    required: options.required ?? requiredDefault,
    defaultValue: options.defaultValue,
    width: options.width,
  } as BaseFieldMeta
}

function finalize<T extends z.ZodType>(schema: T, meta: FieldMeta, required: boolean): T {
  const withMeta = setFieldMeta(schema, meta)
  return (required ? withMeta : withMeta.optional()) as unknown as T
}

function assertRange(label: string, min: number | undefined, max: number | undefined): void {
  if (min !== undefined && (!Number.isInteger(min) || min < 0)) {
    throw new Error(`${label}: min must be a non-negative integer`)
  }
  if (max !== undefined && (!Number.isInteger(max) || max < 0)) {
    throw new Error(`${label}: max must be a non-negative integer`)
  }
  if (min !== undefined && max !== undefined && min > max) {
    throw new Error(`${label}: min cannot exceed max`)
  }
}

export function string(options: StringFieldOptions): z.ZodType<string> {
  assertRange(options.label, options.minLength, options.maxLength)
  let schema = z.string()
  if (options.format === "email") schema = schema.email()
  if (options.format === "url") schema = schema.url()
  if (options.minLength !== undefined) schema = schema.min(options.minLength)
  if (options.maxLength !== undefined) schema = schema.max(options.maxLength)
  if (options.pattern !== undefined) schema = schema.regex(options.pattern)

  return finalize(
    schema,
    {
      ...baseMeta("string", options),
      type: "string",
      format: options.format,
      minLength: options.minLength,
      maxLength: options.maxLength,
      pattern: options.pattern?.source,
    },
    options.required ?? true,
  )
}

export function text(options: TextFieldOptions): z.ZodType<string> {
  assertRange(options.label, options.minLength, options.maxLength)
  let schema = z.string()
  if (options.minLength !== undefined) schema = schema.min(options.minLength)
  if (options.maxLength !== undefined) schema = schema.max(options.maxLength)

  return finalize(
    schema,
    {
      ...baseMeta("text", options),
      type: "text",
      minLength: options.minLength,
      maxLength: options.maxLength,
    },
    options.required ?? true,
  )
}

export function number(options: NumberFieldOptions): z.ZodType<number> {
  assertRange(options.label, options.min, options.max)
  let schema = z.number()
  if (options.int === true) schema = schema.int()
  if (options.min !== undefined) schema = schema.min(options.min)
  if (options.max !== undefined) schema = schema.max(options.max)

  return finalize(
    schema,
    {
      ...baseMeta("number", options),
      type: "number",
      int: options.int,
      min: options.min,
      max: options.max,
    },
    options.required ?? true,
  )
}

export function boolean(options: BooleanFieldOptions): z.ZodType<boolean> {
  return finalize(
    z.boolean(),
    { ...baseMeta("boolean", options), type: "boolean" },
    options.required ?? true,
  )
}

export function select(options: SelectFieldOptions): z.ZodType<string | string[]> {
  const normalized = normalizeOptions(options.label, options.options)
  const values = normalized.map((option) => option.value)
  const enumSchema = z.enum(values as [string, ...string[]])
  const schema = options.multiple === true ? z.array(enumSchema) : enumSchema

  if (options.defaultValue !== undefined) {
    const valid =
      options.multiple === true
        ? Array.isArray(options.defaultValue) &&
          options.defaultValue.every((value) => values.includes(String(value)))
        : typeof options.defaultValue === "string" && values.includes(options.defaultValue)
    if (!valid) throw new Error(`${options.label}: defaultValue is not one of the options`)
  }

  return finalize(
    schema,
    {
      ...baseMeta("select", options),
      type: "select",
      options: normalized,
      multiple: options.multiple,
    },
    options.required ?? true,
  )
}

export function datetime(options: DatetimeFieldOptions): z.ZodType<string> {
  const schema =
    options.dateOnly === true
      ? z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
      : z.string().datetime({ offset: true })

  return finalize(
    schema,
    { ...baseMeta("datetime", options), type: "datetime", dateOnly: options.dateOnly },
    options.required ?? true,
  )
}

const DEFAULT_IMAGE_PATTERN = /^\/images\/[\w./-]+\.(?:jpe?g|png|webp|avif|svg)$/i
const DEFAULT_IMAGE_EXTENSIONS = ["jpg", "jpeg", "png", "webp", "avif", "svg"] as const

export function image(options: ImageFieldOptions): z.ZodType<string> {
  const schema = z.string().regex(options.pattern ?? DEFAULT_IMAGE_PATTERN)
  return finalize(
    schema,
    {
      ...baseMeta("image", options),
      type: "image",
      extensions: options.extensions ?? DEFAULT_IMAGE_EXTENSIONS,
    },
    options.required ?? true,
  )
}

export function relation(options: RelationFieldOptions): z.ZodType<string | string[]> {
  if (options.collection.length === 0) throw new Error("relation: collection is required")
  const schema = options.multiple === true ? z.array(z.string().min(1)) : z.string().min(1)
  const valueField = normalizeValueField(options.valueField)
  return finalize(
    schema,
    {
      ...baseMeta("relation", options),
      type: "relation",
      collection: options.collection,
      multiple: options.multiple,
      valueField,
      displayFields: options.displayFields ?? ["title"],
      searchFields: options.searchFields ?? ["title"],
    },
    options.required ?? true,
  )
}

export function hidden(options: HiddenFieldOptions): z.ZodType<unknown> {
  return finalize(
    z.unknown(),
    {
      ...baseMeta("hidden", options, false),
      type: "hidden",
      siteEffect: options.siteEffect,
    },
    options.required ?? false,
  )
}

export function slug(options: SlugFieldOptions = { label: "Slug" }): z.ZodType<string | undefined> {
  return setFieldMeta(z.string(), {
    type: "slug",
    label: options.label,
    hint: options.hint,
    required: false,
    width: options.width,
  }).optional() as z.ZodType<string | undefined>
}

export function list(options: ListFieldOptions): z.ZodType<unknown[]> {
  assertRange(options.label, options.min, options.max)
  if ((options.fields === undefined) === (options.field === undefined)) {
    throw new Error(`${options.label}: provide exactly one of fields or field`)
  }

  let itemSchema: z.ZodType
  let named: NamedFieldSchema[]
  let itemMode: "object" | "scalar"

  if (options.field !== undefined) {
    itemMode = "scalar"
    named = [{ name: options.field.name, schema: options.field.schema }]
    itemSchema = options.field.schema
  } else {
    itemMode = "object"
    named = namedSchemas(options.label, options.fields ?? {})
    itemSchema = z.object(Object.fromEntries(named.map((entry) => [entry.name, entry.schema])))
  }

  for (const entry of named) {
    if (getFieldMeta(entry.schema) === undefined) {
      throw new Error(`${options.label}.${entry.name}: list children must be fields.* schemas`)
    }
  }

  let schema = z.array(itemSchema)
  if (options.min !== undefined) schema = schema.min(options.min)
  if (options.max !== undefined) schema = schema.max(options.max)

  return finalize(
    schema,
    {
      ...baseMeta("list", options),
      type: "list",
      itemMode,
      fields: named,
      min: options.min,
      max: options.max,
      summary: options.summary,
    },
    options.required ?? true,
  )
}

export function object(options: ObjectFieldOptions): z.ZodType<Record<string, unknown>> {
  const named = namedSchemas(options.label, options.fields)
  for (const entry of named) {
    if (getFieldMeta(entry.schema) === undefined) {
      throw new Error(`${options.label}.${entry.name}: object children must be fields.* schemas`)
    }
  }
  const schema = z.object(Object.fromEntries(named.map((entry) => [entry.name, entry.schema])))
  return finalize(
    schema,
    { ...baseMeta("object", options), type: "object", fields: named },
    options.required ?? true,
  )
}

function namedSchemas(
  label: string,
  fields: Readonly<Record<string, z.ZodType>>,
): NamedFieldSchema[] {
  const entries = Object.entries(fields)
  if (entries.length === 0) throw new Error(`${label}: at least one child field is required`)
  return entries.map(([name, schema]) => ({ name, schema }))
}

function normalizeOptions(
  label: string,
  options: readonly (string | SelectOption)[],
): SelectOption[] {
  if (options.length === 0) throw new Error(`${label}: at least one select option is required`)
  const normalized = options.map((option) =>
    typeof option === "string"
      ? { label: option, value: option }
      : { label: option.label, value: option.value },
  )
  const seen = new Set<string>()
  for (const option of normalized) {
    if (option.value.length === 0) throw new Error(`${label}: select option value cannot be empty`)
    if (seen.has(option.value)) throw new Error(`${label}: duplicate select option ${option.value}`)
    seen.add(option.value)
  }
  return normalized
}

function normalizeValueField(valueField: string | undefined): string {
  if (valueField === undefined) return "slug"
  const match = /^\{\{\s*([A-Za-z0-9_$.[\]]+)\s*\}\}$/.exec(valueField)
  return match?.[1] ?? valueField
}
