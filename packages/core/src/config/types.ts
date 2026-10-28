/** Config documents: host-side definitions (with zod schemas) and JSON-safe admin descriptors. */
import type { z } from "zod"
import type { DividerDeclaration, FieldDescriptor } from "../fields/types"
import type { CONFIG_SCHEMA_VERSION } from "./version"

export interface MediaFolders {
  readonly folder: string
  readonly publicFolder: string
}

export interface ViewGroup {
  readonly name: string
  readonly label: string
  readonly field: string
  readonly pattern: string
}

/**
 * Site-level deploy-status configuration (ADR-0008 §2, ADR-0003 P2.8 addendum).
 * Absent/empty `contexts` = commit-status fallback off.
 */
export interface DeployConfig {
  readonly contexts?: readonly string[]
}

export interface FolderCollectionOptions {
  readonly name: string
  readonly label: string
  readonly labelSingular?: string
  readonly icon?: string
  readonly folder: string
  readonly format?: "json"
  readonly create?: boolean
  readonly delete?: boolean
  readonly identifierField?: string
  readonly summary?: string
  readonly previewPath?: string
  readonly sortableFields?: readonly string[]
  readonly thumbnail?: string
  readonly viewGroups?: readonly ViewGroup[]
  readonly media?: MediaFolders
  readonly schema: z.ZodType
  readonly decorations?: readonly DividerDeclaration[]
}

export interface FolderCollectionDefinition {
  readonly kind: "folder"
  readonly name: string
  readonly label: string
  readonly labelSingular?: string
  readonly icon?: string
  readonly folder: string
  readonly format: "json"
  readonly create: boolean
  readonly delete: boolean
  readonly identifierField?: string
  readonly summary?: string
  readonly previewPath?: string
  readonly sortableFields?: readonly string[]
  readonly thumbnail?: string
  readonly viewGroups?: readonly ViewGroup[]
  readonly media?: MediaFolders
  readonly schema: z.ZodType
  readonly decorations?: readonly DividerDeclaration[]
}

export interface FileOptions {
  readonly name: string
  readonly label: string
  readonly icon?: string
  readonly file: string
  readonly schema: z.ZodType
  readonly decorations?: readonly DividerDeclaration[]
}

export interface FileDefinition {
  readonly name: string
  readonly label: string
  readonly icon?: string
  readonly file: string
  readonly schema: z.ZodType
  readonly decorations?: readonly DividerDeclaration[]
}

export interface FilesCollectionOptions {
  readonly name: string
  readonly label: string
  readonly icon?: string
  readonly media?: MediaFolders
  readonly files: readonly FileOptions[]
}

export interface FilesCollectionDefinition {
  readonly kind: "files"
  readonly name: string
  readonly label: string
  readonly icon?: string
  readonly media?: MediaFolders
  readonly files: readonly FileDefinition[]
}

export interface CollectionDivider {
  readonly kind: "divider"
  readonly label?: string
}

export type CollectionDefinition =
  | FolderCollectionDefinition
  | FilesCollectionDefinition
  | CollectionDivider

export interface ConfigOptions {
  readonly site?: { readonly name?: string; readonly url?: string }
  readonly deploy?: DeployConfig
  readonly media: MediaFolders
  readonly collections: readonly CollectionDefinition[]
}

export interface ConfigDefinition {
  readonly schemaVersion: typeof CONFIG_SCHEMA_VERSION
  readonly site?: { readonly name?: string; readonly url?: string }
  readonly deploy?: DeployConfig
  readonly media: MediaFolders
  readonly collections: readonly CollectionDefinition[]
}

export interface AdminConfig {
  readonly schemaVersion: typeof CONFIG_SCHEMA_VERSION
  readonly site?: { readonly name?: string; readonly url?: string }
  readonly deploy?: DeployConfig
  readonly media: MediaFolders
  readonly collections: readonly CollectionDescriptor[]
}

export interface FolderCollectionDescriptor {
  readonly kind: "folder"
  readonly name: string
  readonly label: string
  readonly labelSingular?: string
  readonly icon?: string
  readonly folder: string
  readonly format: "json"
  readonly create?: boolean
  readonly delete?: boolean
  readonly identifierField?: string
  readonly summary?: string
  readonly previewPath?: string
  readonly sortableFields?: readonly string[]
  readonly thumbnail?: string
  readonly viewGroups?: readonly ViewGroup[]
  readonly media?: MediaFolders
  readonly fields: readonly FieldDescriptor[]
}

export interface FileDescriptor {
  readonly name: string
  readonly label: string
  readonly icon?: string
  readonly file: string
  readonly fields: readonly FieldDescriptor[]
}

export interface FilesCollectionDescriptor {
  readonly kind: "files"
  readonly name: string
  readonly label: string
  readonly icon?: string
  readonly media?: MediaFolders
  readonly files: readonly FileDescriptor[]
}

export interface CollectionDividerDescriptor {
  readonly kind: "divider"
  readonly label?: string
}

export type CollectionDescriptor =
  | FolderCollectionDescriptor
  | FilesCollectionDescriptor
  | CollectionDividerDescriptor

export type FieldDescriptorPath = readonly (string | number)[]
