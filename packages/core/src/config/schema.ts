/** Strict, closed validation of JSON-safe admin config documents (ADR-0003). */
import { z } from "zod"
import type { FieldDescriptor } from "../fields/types"
import { safePath } from "../safety/safe-path"
import type { AdminConfig, FilesCollectionDescriptor, FolderCollectionDescriptor } from "./types"

const mediaSchema = z.strictObject({
  folder: z.string().min(1),
  publicFolder: z.string().min(1),
})

/** Commit-status contexts (ADR-0008 §2): exact names, no blank entries. */
const deploySchema = z.strictObject({
  contexts: z
    .array(z.string().refine((value) => value.trim().length > 0, "context cannot be blank"))
    .optional(),
})

const optionSchema = z.strictObject({
  label: z.string().min(1),
  value: z.string().min(1),
})

const fieldCommon = {
  name: z.string().min(1),
  label: z.string().min(1),
  required: z.boolean(),
  hint: z.string().optional(),
  width: z.enum(["full", "half"]).optional(),
  defaultValue: z.json().optional(),
}

export const fieldDescriptorSchema: z.ZodType<FieldDescriptor> = z.lazy(() =>
  z.discriminatedUnion("type", [
    z.strictObject({
      ...fieldCommon,
      type: z.literal("string"),
      format: z.enum(["email", "url"]).optional(),
      minLength: z.number().int().nonnegative().optional(),
      maxLength: z.number().int().nonnegative().optional(),
      pattern: z.string().optional(),
    }),
    z.strictObject({
      ...fieldCommon,
      type: z.literal("text"),
      minLength: z.number().int().nonnegative().optional(),
      maxLength: z.number().int().nonnegative().optional(),
    }),
    z.strictObject({
      ...fieldCommon,
      type: z.literal("number"),
      int: z.boolean().optional(),
      min: z.number().optional(),
      max: z.number().optional(),
    }),
    z.strictObject({ ...fieldCommon, type: z.literal("boolean") }),
    z.strictObject({
      ...fieldCommon,
      type: z.literal("select"),
      options: z.array(optionSchema).min(1),
      multiple: z.boolean().optional(),
    }),
    z.strictObject({
      ...fieldCommon,
      type: z.literal("datetime"),
      dateOnly: z.boolean().optional(),
    }),
    z.strictObject({
      ...fieldCommon,
      type: z.literal("list"),
      itemMode: z.enum(["object", "scalar"]),
      fields: z.array(fieldDescriptorSchema).min(1),
      min: z.number().int().nonnegative().optional(),
      max: z.number().int().nonnegative().optional(),
      summary: z.string().optional(),
    }),
    z.strictObject({
      ...fieldCommon,
      type: z.literal("object"),
      fields: z.array(fieldDescriptorSchema).min(1),
    }),
    z.strictObject({
      ...fieldCommon,
      type: z.literal("image"),
      extensions: z.array(z.string().min(1)).optional(),
    }),
    z.strictObject({
      ...fieldCommon,
      type: z.literal("relation"),
      collection: z.string().min(1),
      multiple: z.boolean().optional(),
      valueField: z.string().min(1).optional(),
      displayFields: z.array(z.string().min(1)).optional(),
      searchFields: z.array(z.string().min(1)).optional(),
    }),
    z.strictObject({ ...fieldCommon, type: z.literal("hidden") }),
    z.strictObject({ ...fieldCommon, type: z.literal("slug") }),
    z.strictObject({
      type: z.literal("divider"),
      label: z.string().optional(),
    }),
  ]),
) as unknown as z.ZodType<FieldDescriptor>

const viewGroupSchema = z.strictObject({
  name: z.string().min(1),
  label: z.string().min(1),
  field: z.string().min(1),
  pattern: z.string(),
})

const collectionBase = {
  name: z.string().min(1),
  label: z.string().min(1),
  icon: z.string().min(1).optional(),
  media: mediaSchema.optional(),
}

const folderCollectionSchema = z.strictObject({
  ...collectionBase,
  kind: z.literal("folder"),
  labelSingular: z.string().min(1).optional(),
  folder: z.string().min(1),
  format: z.literal("json"),
  create: z.boolean().optional(),
  delete: z.boolean().optional(),
  identifierField: z.string().min(1).optional(),
  summary: z.string().optional(),
  previewPath: z.string().optional(),
  sortableFields: z.array(z.string().min(1)).optional(),
  thumbnail: z.string().min(1).optional(),
  viewGroups: z.array(viewGroupSchema).optional(),
  fields: z.array(fieldDescriptorSchema).min(1),
})

const fileSchema = z.strictObject({
  name: z.string().min(1),
  label: z.string().min(1),
  icon: z.string().min(1).optional(),
  file: z.string().min(1),
  fields: z.array(fieldDescriptorSchema).min(1),
})

const filesCollectionSchema = z.strictObject({
  ...collectionBase,
  kind: z.literal("files"),
  files: z.array(fileSchema).min(1),
})

const dividerCollectionSchema = z.strictObject({
  kind: z.literal("divider"),
  label: z.string().optional(),
})

const collectionSchema = z.discriminatedUnion("kind", [
  folderCollectionSchema,
  filesCollectionSchema,
  dividerCollectionSchema,
])

const adminConfigSchema = z.strictObject({
  schemaVersion: z.literal(1),
  site: z
    .strictObject({
      name: z.string().min(1).optional(),
      url: z.string().min(1).optional(),
    })
    .optional(),
  deploy: deploySchema.optional(),
  media: mediaSchema,
  collections: z.array(collectionSchema).min(1),
})

export interface ConfigIssue {
  readonly path: string
  readonly message: string
}

export class ConfigValidationError extends Error {
  readonly issues: readonly ConfigIssue[]

  constructor(issues: readonly ConfigIssue[]) {
    super(
      `Invalid admin config:\n${issues.map((issue) => `  - ${issue.path}: ${issue.message}`).join("\n")}`,
    )
    this.name = "ConfigValidationError"
    this.issues = issues
  }
}

/** Strict parse; unknown keys/types and semantic inconsistencies are errors. */
export function parseAdminConfig(value: unknown): AdminConfig {
  const result = adminConfigSchema.safeParse(value)
  if (!result.success) {
    throw new ConfigValidationError(
      result.error.issues.map((issue) => ({
        path: issue.path.length === 0 ? "$" : issue.path.join("."),
        message: issue.message,
      })),
    )
  }

  const config = result.data as AdminConfig
  const issues: ConfigIssue[] = []
  validateSemantics(config, issues)
  if (issues.length > 0) throw new ConfigValidationError(issues)
  return config
}

/** Non-throwing helper for hosts that want to render config errors. */
export function safeParseAdminConfig(
  value: unknown,
):
  | { readonly ok: true; readonly config: AdminConfig }
  | { readonly ok: false; readonly issues: readonly ConfigIssue[] } {
  try {
    return { ok: true, config: parseAdminConfig(value) }
  } catch (error) {
    if (error instanceof ConfigValidationError) return { ok: false, issues: error.issues }
    throw error
  }
}

function validateSemantics(config: AdminConfig, issues: ConfigIssue[]): void {
  validateMedia(config.media, "media", issues)
  validateContexts(config.deploy, issues)
  const names = new Set<string>()
  for (const collection of config.collections) {
    if (collection.kind === "divider") continue
    if (names.has(collection.name)) {
      issues.push({ path: collection.name, message: "duplicate collection name" })
    }
    names.add(collection.name)
  }

  for (const collection of config.collections) {
    if (collection.kind === "folder") validateFolder(collection, names, issues)
    if (collection.kind === "files") validateFiles(collection, names, issues)
  }
}

function validateFolder(
  collection: FolderCollectionDescriptor,
  collections: ReadonlySet<string>,
  issues: ConfigIssue[],
): void {
  const base = collection.name
  validateRepoPath(collection.folder, `${base}.folder`, issues)
  if (collection.media !== undefined) validateMedia(collection.media, `${base}.media`, issues)
  const fieldNames = validateFields(collection.fields, base, collections, issues)
  if (collection.identifierField !== undefined && !fieldNames.has(collection.identifierField)) {
    issues.push({ path: `${base}.identifierField`, message: "unknown identifier field" })
  }
  for (const sortable of collection.sortableFields ?? []) {
    if (sortable !== "slug" && !fieldNames.has(sortable)) {
      issues.push({ path: `${base}.sortableFields`, message: `unknown field ${sortable}` })
    }
  }
  for (const group of collection.viewGroups ?? []) {
    if (!fieldNames.has(group.field)) {
      issues.push({
        path: `${base}.viewGroups.${group.name}`,
        message: `unknown field ${group.field}`,
      })
    }
  }
}

function validateFiles(
  collection: FilesCollectionDescriptor,
  collections: ReadonlySet<string>,
  issues: ConfigIssue[],
): void {
  if (collection.media !== undefined) {
    validateMedia(collection.media, `${collection.name}.media`, issues)
  }
  const fileNames = new Set<string>()
  for (const file of collection.files) {
    const base = `${collection.name}.${file.name}`
    if (fileNames.has(file.name)) {
      issues.push({ path: base, message: "duplicate file name" })
    }
    fileNames.add(file.name)
    validateRepoPath(file.file, `${base}.file`, issues)
    validateFields(file.fields, base, collections, issues)
  }
}

function validateFields(
  fields: readonly FieldDescriptor[],
  context: string,
  collections: ReadonlySet<string>,
  issues: ConfigIssue[],
): ReadonlySet<string> {
  const names = new Set<string>()
  fields.forEach((field, index) => {
    const base = `${context}.fields[${index}]`
    if (field.type === "divider") return
    if (names.has(field.name)) {
      issues.push({ path: `${base}.name`, message: `duplicate field ${field.name}` })
    }
    names.add(field.name)
    validateField(field, base, collections, issues)
  })
  return names
}

function validateField(
  field: FieldDescriptor,
  context: string,
  collections: ReadonlySet<string>,
  issues: ConfigIssue[],
): void {
  if (field.type === "divider") return
  if (field.type === "select") {
    const values = new Set<string>()
    for (const option of field.options) {
      if (values.has(option.value)) {
        issues.push({ path: `${context}.options`, message: `duplicate option ${option.value}` })
      }
      values.add(option.value)
    }
    if (field.defaultValue !== undefined) {
      const valid =
        field.multiple === true
          ? Array.isArray(field.defaultValue) &&
            field.defaultValue.every((value: unknown) => values.has(String(value)))
          : typeof field.defaultValue === "string" && values.has(field.defaultValue)
      if (!valid) issues.push({ path: `${context}.defaultValue`, message: "not an option value" })
    }
  }
  if (field.type === "string" && field.pattern !== undefined) {
    try {
      new RegExp(field.pattern)
    } catch {
      issues.push({ path: `${context}.pattern`, message: "invalid regular expression" })
    }
  }
  if (field.type === "relation" && !collections.has(field.collection)) {
    issues.push({
      path: `${context}.collection`,
      message: `unknown relation target ${field.collection}`,
    })
  }
  if (field.type === "list") {
    if (field.itemMode === "scalar" && field.fields.length !== 1) {
      issues.push({ path: `${context}.fields`, message: "scalar list needs exactly one child" })
    }
    if (field.itemMode === "object" && field.fields.length === 0) {
      issues.push({ path: `${context}.fields`, message: "object list needs children" })
    }
    validateFields(field.fields, context, collections, issues)
  }
  if (field.type === "object") {
    validateFields(field.fields, context, collections, issues)
  }
}

function validateContexts(deploy: AdminConfig["deploy"], issues: ConfigIssue[]): void {
  if (deploy?.contexts === undefined) return
  const seen = new Set<string>()
  deploy.contexts.forEach((context, index) => {
    if (seen.has(context)) {
      issues.push({ path: `deploy.contexts[${index}]`, message: `duplicate context ${context}` })
    }
    seen.add(context)
  })
}

function validateMedia(
  media: { readonly folder: string; readonly publicFolder: string },
  context: string,
  issues: ConfigIssue[],
): void {
  validateRepoPath(media.folder, `${context}.folder`, issues)
  const publicPath = safePath(media.publicFolder, { absolute: true })
  if (!publicPath.ok) {
    issues.push({
      path: `${context}.publicFolder`,
      message: publicPath.detail ?? publicPath.code,
    })
  }
}

function validateRepoPath(path: string, context: string, issues: ConfigIssue[]): void {
  const result = safePath(path)
  if (!result.ok) issues.push({ path: context, message: result.detail ?? result.code })
}
