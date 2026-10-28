/**
 * Config module barrel — ADR-0003. Host apps build a ConfigDefinition with
 * zod schemas; the admin consumes only the strict JSON-safe AdminConfig.
 */
export {
  collectionDivider,
  defineCollection,
  defineConfig,
  defineFile,
  defineFiles,
  toAdminConfig,
} from "./document"
export type { ConfigIssue } from "./schema"
export {
  ConfigValidationError,
  fieldDescriptorSchema,
  parseAdminConfig,
  safeParseAdminConfig,
} from "./schema"
export type {
  AdminConfig,
  CollectionDefinition,
  CollectionDescriptor,
  CollectionDivider,
  CollectionDividerDescriptor,
  ConfigDefinition,
  ConfigOptions,
  DeployConfig,
  FileDefinition,
  FileDescriptor,
  FileOptions,
  FilesCollectionDefinition,
  FilesCollectionDescriptor,
  FilesCollectionOptions,
  FolderCollectionDefinition,
  FolderCollectionDescriptor,
  FolderCollectionOptions,
  MediaFolders,
  ViewGroup,
} from "./types"
export { CONFIG_SCHEMA_VERSION } from "./version"
