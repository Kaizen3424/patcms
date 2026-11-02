/** Reads/writes CMS metadata carried on zod schemas via zod 4 `.meta()`. */
import { z } from "zod"
import type { FieldMeta } from "./types"

export const CMS_META_KEY = "patcms"

export function setFieldMeta<T extends z.ZodType>(schema: T, meta: FieldMeta): T {
  return schema.meta({ [CMS_META_KEY]: meta }) as unknown as T
}

export function getFieldMeta(schema: z.ZodType): FieldMeta | undefined {
  const meta = unwrapFieldSchema(schema).meta() as Record<string, unknown> | undefined
  const value = meta?.[CMS_META_KEY]
  return isFieldMeta(value) ? value : undefined
}

/** Removes optional/nullable/default/readonly wrappers to reach the CMS schema. */
export function unwrapFieldSchema(schema: z.ZodType): z.ZodType {
  let current = schema
  while (
    current instanceof z.ZodOptional ||
    current instanceof z.ZodNullable ||
    current instanceof z.ZodDefault ||
    current instanceof z.ZodReadonly ||
    current instanceof z.ZodCatch
  ) {
    current = current.unwrap() as z.ZodType
  }
  return current
}

function isFieldMeta(value: unknown): value is FieldMeta {
  if (typeof value !== "object" || value === null) return false
  const record = value as Record<string, unknown>
  return typeof record.type === "string" && typeof record.label === "string"
}
