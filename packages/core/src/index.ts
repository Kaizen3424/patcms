/**
 * patcms — a headless, git-backed CMS.
 *
 * The main entry is Node-safe and carries the high-level client plus everything
 * a host needs to describe content and build its own admin. Transport
 * primitives, the save driver, the contract suite, and test tooling live in
 * `patcms/advanced`; browser stores live in `patcms/web`.
 *
 * @example
 * ```ts
 * const cms = createCMS({
 *   config: defineConfig({ media, collections: [products] }),
 *   repository: { owner: "acme", repo: "site", branch: "main" },
 *   token: import.meta.env.GITHUB_TOKEN,
 * })
 *
 * const products = await cms.entries.list("products")
 * ```
 */

// ---- token lifecycle -----------------------------------------------------
export type { TokenStore } from "./auth"
export { MemoryTokenStore } from "./auth"
// ---- high-level client ---------------------------------------------------
export type {
  AuthAPI,
  AuthStatus,
  CMS,
  CMSErrorCode,
  CMSErrorOptions,
  CMSEventMap,
  CreateCMSOptions,
  CreateOptions,
  DeleteOptions,
  DeleteResult,
  Draft,
  DraftsAPI,
  EntriesAPI,
  Entry,
  EntryStub,
  EntrySummary,
  EntryValue,
  EventsAPI,
  ListOptions,
  MediaAPI,
  MediaBlob,
  MediaDeleteOptions,
  MediaDeleteResult,
  MediaFile,
  MediaListOptions,
  MediaUploadInput,
  RepositoryTarget,
  SaveOptions,
  SaveResult,
  Session,
  UploadOptions,
  ValidationResult,
} from "./client"
export { CMSError, createCMS, isCMSError, toCMSError } from "./client"
// ---- config DSL ----------------------------------------------------------
export type {
  AdminConfig,
  CollectionDefinition,
  CollectionDescriptor,
  CollectionDivider,
  CollectionDividerDescriptor,
  ConfigDefinition,
  ConfigIssue,
  ConfigOptions,
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
} from "./config"
export {
  CONFIG_SCHEMA_VERSION,
  ConfigValidationError,
  collectionDivider,
  defineCollection,
  defineConfig,
  defineFile,
  defineFiles,
  fieldDescriptorSchema,
  parseAdminConfig,
  safeParseAdminConfig,
  toAdminConfig,
} from "./config"
// ---- drafts --------------------------------------------------------------
export type { DraftKey, DraftRecord, DraftStore, SaveDraftPayload } from "./drafts"
export { createMemoryDraftStore } from "./drafts/memory-store"
// ---- fields --------------------------------------------------------------
export type {
  BaseFieldDescriptor,
  BaseFieldMeta,
  BaseFieldOptions,
  BooleanFieldDescriptor,
  BooleanFieldMeta,
  BooleanFieldOptions,
  DatetimeFieldDescriptor,
  DatetimeFieldMeta,
  DatetimeFieldOptions,
  DividerDeclaration,
  DividerFieldDescriptor,
  EntryValidationOptions,
  EntryValidationResult,
  FieldDescriptor,
  FieldMeta,
  FieldTypeName,
  FieldWidth,
  HiddenFieldDescriptor,
  HiddenFieldMeta,
  HiddenFieldOptions,
  ImageFieldDescriptor,
  ImageFieldMeta,
  ImageFieldOptions,
  ListFieldDescriptor,
  ListFieldMeta,
  ListFieldOptions,
  NamedFieldSchema,
  NumberFieldDescriptor,
  NumberFieldMeta,
  NumberFieldOptions,
  ObjectFieldDescriptor,
  ObjectFieldMeta,
  ObjectFieldOptions,
  ParsedEntry,
  ParseEntryOptions,
  ParseIssue,
  ParseIssueCode,
  RelationFieldDescriptor,
  RelationFieldMeta,
  RelationFieldOptions,
  RelationServices,
  SelectFieldDescriptor,
  SelectFieldMeta,
  SelectFieldOptions,
  SelectOption,
  SlugFieldDescriptor,
  SlugFieldMeta,
  SlugFieldOptions,
  StringFieldDescriptor,
  StringFieldMeta,
  StringFieldOptions,
  StringFormat,
  TextFieldDescriptor,
  TextFieldMeta,
  TextFieldOptions,
} from "./fields"
export {
  boolean,
  CMS_META_KEY,
  datetime,
  defineField,
  divider,
  getFieldMeta,
  hidden,
  image,
  list,
  mergeUntouched,
  number,
  object,
  parseEntry,
  relation,
  select,
  setFieldMeta,
  slug,
  string,
  text,
  unwrapFieldSchema,
  validateEntryForSave,
} from "./fields"
export { createBlankEntryValue, foldFieldDefaults } from "./fields/defaults"
// ---- media ---------------------------------------------------------------
export type {
  DeleteCheckResult,
  MediaBudget,
  ReferenceLocation,
  ReferenceQuery,
  RestoreChangesResult,
  SearchableEntry,
} from "./media"
export {
  CLIENT_BLOCK_BYTES,
  calculateMediaBudget,
  canDeleteMedia,
  createRestoreChanges,
  createTrashChanges,
  findReferences,
  isUploadSizeBlocked,
  publicPathToRepoPath,
  repoPathToPublicPath,
  resolveMediaFolders,
  restoreMediaPath,
  TRASH_PREFIX,
  trashMediaPath,
  WARNING_THRESHOLD_BYTES,
  WARNING_THRESHOLD_COUNT,
} from "./media"

// ---- safety --------------------------------------------------------------
export type {
  JsonPrimitive,
  JsonValue,
  SafePathFailureCode,
  SafePathOptions,
  SafePathResult,
  SafeUrlFailureCode,
  SafeUrlOptions,
  SafeUrlResult,
  SortDirection,
  UntrustedJsonFailureCode,
  UntrustedJsonIssue,
  UntrustedJsonOptions,
  UntrustedJsonResult,
} from "./safety"
export {
  compareNumbers,
  compareText,
  compareValues,
  createTextCollator,
  DEFAULT_LOCALE,
  decodeBase64,
  decodeUtf8,
  deriveSlug,
  encodeBase64,
  encodeUtf8,
  formatFriendlyDate,
  formatMoney,
  formatRelativeTime,
  isSafePath,
  isSafeUrl,
  mustacheLite,
  parseUntrustedJson,
  readPath,
  safePath,
  safeUrl,
  slugify,
  sortBy,
  UNTRUSTED_JSON_LIMITS,
  utf8ByteLength,
} from "./safety"
// ---- serialization -------------------------------------------------------
export type {
  ComposedEntryDocument,
  ComposeEntryDocumentInput,
  JsonDocument,
  NewlineStyle,
  ParseJsonDocumentResult,
} from "./serialization"
export {
  canonicalJson,
  composeEntryDocument,
  detectNewline,
  documentsCanonicallyEqual,
  jsonEqual,
  normalizeNewlines,
  parseJsonDocument,
  serializeDocument,
} from "./serialization"
