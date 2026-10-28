/** Config builders + `toAdminConfig` projection (schemas stay host-side). */
import { z } from "zod"
import { getFieldMeta } from "../fields/meta"
import type {
  BaseFieldDescriptor,
  DividerDeclaration,
  FieldDescriptor,
  FieldMeta,
  NamedFieldSchema,
} from "../fields/types"
import { safePath } from "../safety/safe-path"
import { parseAdminConfig } from "./schema"
import type {
  AdminConfig,
  CollectionDefinition,
  CollectionDescriptor,
  ConfigDefinition,
  ConfigOptions,
  DeployConfig,
  FileDefinition,
  FileOptions,
  FilesCollectionDefinition,
  FilesCollectionOptions,
  FolderCollectionDefinition,
  FolderCollectionOptions,
  MediaFolders,
  ViewGroup,
} from "./types"
import { CONFIG_SCHEMA_VERSION } from "./version"

export function defineCollection(options: FolderCollectionOptions): FolderCollectionDefinition {
  const name = requireText(options.name, "collection name")
  const label = requireText(options.label, "collection label")
  const folder = requireRepoPath(options.folder, `${name}.folder`)
  if (!(options.schema instanceof z.ZodObject)) {
    throw new Error(`${name}: schema must be a z.object({...})`)
  }
  const shape = options.schema.shape as Record<string, z.ZodType>
  validateFieldSchemas(name, shape)
  validateDecorations(name, shape, options.decorations)
  validateCollectionPaths(name, options, shape)

  return {
    kind: "folder",
    name,
    label,
    ...(options.labelSingular === undefined ? {} : { labelSingular: options.labelSingular }),
    ...(options.icon === undefined ? {} : { icon: options.icon }),
    folder,
    format: "json",
    create: options.create ?? true,
    delete: options.delete ?? true,
    ...(options.identifierField === undefined ? {} : { identifierField: options.identifierField }),
    ...(options.summary === undefined ? {} : { summary: options.summary }),
    ...(options.previewPath === undefined ? {} : { previewPath: options.previewPath }),
    ...(options.sortableFields === undefined ? {} : { sortableFields: options.sortableFields }),
    ...(options.thumbnail === undefined ? {} : { thumbnail: options.thumbnail }),
    ...(options.viewGroups === undefined ? {} : { viewGroups: options.viewGroups }),
    ...(options.media === undefined ? {} : { media: validateMedia(options.media, name) }),
    schema: options.schema,
    ...(options.decorations === undefined ? {} : { decorations: options.decorations }),
  }
}

export function defineFiles(options: FilesCollectionOptions): FilesCollectionDefinition {
  const name = requireText(options.name, "collection name")
  if (options.files.length === 0) throw new Error(`${name}: at least one file is required`)
  const seen = new Set<string>()
  const files: FileDefinition[] = options.files.map((file) => {
    const fileDefinition = defineFile(name, file)
    if (seen.has(fileDefinition.name))
      throw new Error(`${name}: duplicate file ${fileDefinition.name}`)
    seen.add(fileDefinition.name)
    return fileDefinition
  })
  return {
    kind: "files",
    name,
    label: requireText(options.label, "collection label"),
    ...(options.icon === undefined ? {} : { icon: options.icon }),
    ...(options.media === undefined ? {} : { media: validateMedia(options.media, name) }),
    files,
  }
}

export function defineFile(collectionName: string, options: FileOptions): FileDefinition {
  const name = requireText(options.name, `${collectionName} file name`)
  if (!(options.schema instanceof z.ZodObject)) {
    throw new Error(`${collectionName}.${name}: schema must be a z.object({...})`)
  }
  validateFieldSchemas(
    `${collectionName}.${name}`,
    options.schema.shape as Record<string, z.ZodType>,
  )
  validateDecorations(
    `${collectionName}.${name}`,
    options.schema.shape as Record<string, z.ZodType>,
    options.decorations,
  )
  return {
    name,
    label: requireText(options.label, `${collectionName}.${name} label`),
    ...(options.icon === undefined ? {} : { icon: options.icon }),
    file: requireRepoPath(options.file, `${collectionName}.${name}.file`),
    schema: options.schema,
    ...(options.decorations === undefined ? {} : { decorations: options.decorations }),
  }
}

export function collectionDivider(label?: string): CollectionDefinition {
  return label === undefined ? { kind: "divider" } : { kind: "divider", label }
}

export function defineConfig(options: ConfigOptions): ConfigDefinition {
  validateMedia(options.media, "config")
  const deploy = options.deploy === undefined ? undefined : validateDeploy(options.deploy)
  const names = new Set<string>()
  for (const collection of options.collections) {
    if (collection.kind === "divider") continue
    if (names.has(collection.name)) throw new Error(`duplicate collection ${collection.name}`)
    names.add(collection.name)
  }
  return {
    schemaVersion: CONFIG_SCHEMA_VERSION,
    ...(options.site === undefined ? {} : { site: options.site }),
    ...(deploy === undefined ? {} : { deploy }),
    media: options.media,
    collections: options.collections,
  }
}

/** Drops zod schemas and produces the strict, JSON-safe admin document. */
export function toAdminConfig(config: ConfigDefinition): AdminConfig {
  const document: AdminConfig = {
    schemaVersion: config.schemaVersion,
    ...(config.site === undefined ? {} : { site: config.site }),
    ...(config.deploy === undefined ? {} : { deploy: config.deploy }),
    media: config.media,
    collections: config.collections.map(collectionToDescriptor),
  }
  return parseAdminConfig(document)
}

function collectionToDescriptor(collection: CollectionDefinition): CollectionDescriptor {
  if (collection.kind === "divider") {
    return collection.label === undefined
      ? { kind: "divider" }
      : { kind: "divider", label: collection.label }
  }
  if (collection.kind === "folder") {
    return {
      kind: "folder",
      name: collection.name,
      label: collection.label,
      ...(collection.labelSingular === undefined
        ? {}
        : { labelSingular: collection.labelSingular }),
      ...(collection.icon === undefined ? {} : { icon: collection.icon }),
      folder: collection.folder,
      format: "json",
      create: collection.create,
      delete: collection.delete,
      ...(collection.identifierField === undefined
        ? {}
        : { identifierField: collection.identifierField }),
      ...(collection.summary === undefined ? {} : { summary: collection.summary }),
      ...(collection.previewPath === undefined ? {} : { previewPath: collection.previewPath }),
      ...(collection.sortableFields === undefined
        ? {}
        : { sortableFields: collection.sortableFields }),
      ...(collection.thumbnail === undefined ? {} : { thumbnail: collection.thumbnail }),
      ...(collection.viewGroups === undefined ? {} : { viewGroups: collection.viewGroups }),
      ...(collection.media === undefined ? {} : { media: collection.media }),
      fields: fieldsToDescriptors(collection.schema, collection.name, collection.decorations),
    }
  }
  return {
    kind: "files",
    name: collection.name,
    label: collection.label,
    ...(collection.icon === undefined ? {} : { icon: collection.icon }),
    ...(collection.media === undefined ? {} : { media: collection.media }),
    files: collection.files.map((file) => ({
      name: file.name,
      label: file.label,
      ...(file.icon === undefined ? {} : { icon: file.icon }),
      file: file.file,
      fields: fieldsToDescriptors(file.schema, `${collection.name}.${file.name}`, file.decorations),
    })),
  }
}

function fieldsToDescriptors(
  schema: z.ZodType,
  context: string,
  decorations: readonly DividerDeclaration[] = [],
): FieldDescriptor[] {
  if (!(schema instanceof z.ZodObject)) throw new Error(`${context}: schema must be a z.object`)
  const shape = schema.shape as Record<string, z.ZodType>
  const pending = new Map<string, DividerDeclaration[]>()
  for (const decoration of decorations) {
    if (!Object.hasOwn(shape, decoration.before)) {
      throw new Error(`${context}: divider before unknown field ${decoration.before}`)
    }
    const list = pending.get(decoration.before) ?? []
    list.push(decoration)
    pending.set(decoration.before, list)
  }

  const descriptors: FieldDescriptor[] = []
  for (const [name, fieldSchema] of Object.entries(shape)) {
    for (const decoration of pending.get(name) ?? []) {
      descriptors.push(
        decoration.label === undefined
          ? { type: "divider" }
          : { type: "divider", label: decoration.label },
      )
    }
    pending.delete(name)
    const meta = getFieldMeta(fieldSchema)
    if (meta === undefined) {
      throw new Error(
        `${context}.${name}: missing CMS metadata — declare this field with fields.* (ADR-0003)`,
      )
    }
    descriptors.push(descriptorFromMeta(name, meta, `${context}.${name}`))
  }
  const unused = [...pending.keys()]
  if (unused.length > 0) throw new Error(`${context}: unused divider target ${unused.join(", ")}`)
  return descriptors
}

function descriptorFromMeta(name: string, meta: FieldMeta, context: string): FieldDescriptor {
  const base: BaseFieldDescriptor = {
    name,
    label: meta.label,
    required: meta.required,
    ...(meta.hint === undefined ? {} : { hint: meta.hint }),
    ...(meta.width === undefined ? {} : { width: meta.width }),
    ...(meta.defaultValue === undefined ? {} : { defaultValue: meta.defaultValue }),
  }

  switch (meta.type) {
    case "string":
      return {
        ...base,
        type: "string",
        ...(meta.format === undefined ? {} : { format: meta.format }),
        ...(meta.minLength === undefined ? {} : { minLength: meta.minLength }),
        ...(meta.maxLength === undefined ? {} : { maxLength: meta.maxLength }),
        ...(meta.pattern === undefined ? {} : { pattern: meta.pattern }),
      }
    case "text":
      return {
        ...base,
        type: "text",
        ...(meta.minLength === undefined ? {} : { minLength: meta.minLength }),
        ...(meta.maxLength === undefined ? {} : { maxLength: meta.maxLength }),
      }
    case "number":
      return {
        ...base,
        type: "number",
        ...(meta.int === undefined ? {} : { int: meta.int }),
        ...(meta.min === undefined ? {} : { min: meta.min }),
        ...(meta.max === undefined ? {} : { max: meta.max }),
      }
    case "boolean":
      return { ...base, type: "boolean" }
    case "select":
      return {
        ...base,
        type: "select",
        options: meta.options,
        ...(meta.multiple === undefined ? {} : { multiple: meta.multiple }),
      }
    case "datetime":
      return {
        ...base,
        type: "datetime",
        ...(meta.dateOnly === undefined ? {} : { dateOnly: meta.dateOnly }),
      }
    case "list":
      return {
        ...base,
        type: "list",
        itemMode: meta.itemMode,
        fields: childDescriptors(meta.fields, context),
        ...(meta.min === undefined ? {} : { min: meta.min }),
        ...(meta.max === undefined ? {} : { max: meta.max }),
        ...(meta.summary === undefined ? {} : { summary: meta.summary }),
      }
    case "object":
      return { ...base, type: "object", fields: childDescriptors(meta.fields, context) }
    case "image":
      return {
        ...base,
        type: "image",
        ...(meta.extensions === undefined ? {} : { extensions: meta.extensions }),
      }
    case "relation":
      return {
        ...base,
        type: "relation",
        collection: meta.collection,
        ...(meta.multiple === undefined ? {} : { multiple: meta.multiple }),
        ...(meta.valueField === undefined ? {} : { valueField: meta.valueField }),
        ...(meta.displayFields === undefined ? {} : { displayFields: meta.displayFields }),
        ...(meta.searchFields === undefined ? {} : { searchFields: meta.searchFields }),
      }
    case "hidden":
      return { ...base, type: "hidden" }
    case "slug":
      return { ...base, type: "slug" }
  }
}

function childDescriptors(fields: readonly NamedFieldSchema[], context: string): FieldDescriptor[] {
  return fields.map((field) => {
    const meta = getFieldMeta(field.schema)
    if (meta === undefined) {
      throw new Error(`${context}.${field.name}: missing CMS metadata`)
    }
    return descriptorFromMeta(field.name, meta, `${context}.${field.name}`)
  })
}

function validateFieldSchemas(context: string, shape: Readonly<Record<string, z.ZodType>>): void {
  const names = Object.keys(shape)
  if (names.length === 0) throw new Error(`${context}: at least one field is required`)
  for (const name of names) {
    if (name.length === 0) throw new Error(`${context}: field name cannot be empty`)
    const meta = getFieldMeta(shape[name] as z.ZodType)
    if (meta === undefined) {
      throw new Error(`${context}.${name}: missing CMS metadata — use fields.* (ADR-0003)`)
    }
  }
}

function validateDecorations(
  context: string,
  shape: Readonly<Record<string, z.ZodType>>,
  decorations: readonly DividerDeclaration[] = [],
): void {
  for (const decoration of decorations) {
    if (!Object.hasOwn(shape, decoration.before)) {
      throw new Error(`${context}: divider before unknown field ${decoration.before}`)
    }
  }
}

function validateCollectionPaths(
  name: string,
  options: FolderCollectionOptions,
  shape: Readonly<Record<string, z.ZodType>>,
): void {
  if (options.identifierField !== undefined && !Object.hasOwn(shape, options.identifierField)) {
    throw new Error(`${name}: identifierField ${options.identifierField} does not exist`)
  }
  for (const sortable of options.sortableFields ?? []) {
    if (sortable !== "slug" && !Object.hasOwn(shape, sortable)) {
      throw new Error(`${name}: sortable field ${sortable} does not exist`)
    }
  }
  for (const group of options.viewGroups ?? []) {
    validateViewGroup(name, group, shape)
  }
}

function validateViewGroup(
  collection: string,
  group: ViewGroup,
  shape: Readonly<Record<string, z.ZodType>>,
): void {
  if (!Object.hasOwn(shape, group.field)) {
    throw new Error(`${collection}: view group ${group.name} targets unknown field ${group.field}`)
  }
  if (group.name.length === 0 || group.label.length === 0) {
    throw new Error(`${collection}: view group name/label cannot be empty`)
  }
}

function validateDeploy(deploy: DeployConfig): DeployConfig {
  if (deploy.contexts === undefined) return {}
  const seen = new Set<string>()
  for (const context of deploy.contexts) {
    if (context.trim().length === 0) {
      throw new Error("deploy.contexts cannot contain blank names")
    }
    if (seen.has(context)) throw new Error(`deploy.contexts: duplicate context ${context}`)
    seen.add(context)
  }
  return { contexts: [...deploy.contexts] }
}

function validateMedia(media: MediaFolders, context: string): MediaFolders {
  requireRepoPath(media.folder, `${context}.media.folder`)
  const publicPath = safePath(media.publicFolder, { absolute: true })
  if (!publicPath.ok) {
    throw new Error(`${context}.media.publicFolder: ${publicPath.detail ?? publicPath.code}`)
  }
  return media
}

function requireRepoPath(value: string, context: string): string {
  const result = safePath(value)
  if (!result.ok) throw new Error(`${context}: ${result.detail ?? result.code}`)
  return value
}

function requireText(value: string, context: string): string {
  if (value.trim().length === 0) throw new Error(`${context} cannot be empty`)
  return value
}
