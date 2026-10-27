/**
 * @mycms/core public entry — ADR-0001 (one composition root) + ADR-0010 §1
 * (naming appears here + docs headers only).
 *
 * P0 state: laws encoded as seams (interfaces, DI stubs, runner, masked
 * logger). Mechanisms land per the ADR roster: config P1.1, fields P1.2,
 * backend reads P1.4, pipeline P2, drafts P2.5, web adapters P2.5.
 */

export type {
  AuthKind,
  AuthProvider,
  CapabilityProbeResult,
  CapabilityStatus,
  PatProviderOptions,
  ProbeErrorCode,
  RateLimitSnapshot,
  SignInOptions,
  TokenStore,
} from "./auth"
export {
  CapabilityProbeError,
  MemoryTokenStore,
  PatProvider,
} from "./auth"
export type {
  ContractCheck,
  ContractContext,
  ContractFailure,
  ContractReport,
} from "./backend/contract-suite"
export {
  CORE_CONTRACT_SUITE,
  defineContractSuite,
  runContractSuite,
  SHAPE_CHECK,
  WRITE_CAS_CHECK,
  WRITE_COMMIT_CHECK,
} from "./backend/contract-suite"
export type { ReadErrorCode } from "./backend/errors"
export { BackendReadError, isBackendReadError } from "./backend/errors"
export type {
  FakeGithubSpec,
  FakeRequest,
  FakeRequestLogEvent,
  FakeResponse,
} from "./backend/fake-github-server"
export { FakeGithubServer } from "./backend/fake-github-server"
export type { GitTreeEntry } from "./backend/git-sha"
export { gitBlobSha, gitCommitShaCanonical, gitTreeSha, sha1Hex } from "./backend/git-sha"
export type { GithubProbeOptions } from "./backend/github/probe"
export { probeGithubCapabilities } from "./backend/github/probe"
export type { ReadTreeLike, Result, TreeTruncationIssue } from "./backend/guards"
export { assertNotTruncated } from "./backend/guards"
// backend / pipeline seams
export type {
  CommitChangeSet,
  CommitResult,
  FileRead,
  FileWrite,
  GitBackend,
  GitBackendCapabilities,
  ReadFileOptions,
  ReadFileResult,
  ReadTreeOptions,
  ReadTreeResult,
  Ref,
  RefObject,
  TreeEntryTuple,
  TreeRead,
} from "./backend/types"
export type { WriteErrorCode } from "./backend/write-errors"
export {
  BackendWriteError,
  classifyWriteResponse,
  isBackendWriteError,
  networkWriteError,
} from "./backend/write-errors"
export type { GithubBackendOptions } from "./backends/github"
export { encodeBranch, GithubBackend } from "./backends/github"
export type { FixtureFile, FixtureRepoSpec } from "./backends/reference-fixture-backend"
export {
  ContractStubNotImplementedError,
  FixtureBackend,
  textFixtureFile,
} from "./backends/reference-fixture-backend"
export type { FileCacheEntry, SnapshotRef, TreeCacheEntry } from "./cache"
export { SnapshotStore } from "./cache"
// transport seam
export type {
  CreateMyCMSDeps,
  FetchLike,
  FetchRequestInitLike,
  FetchResponseLike,
  MyCMSInstance,
} from "./composition"
export { createMyCMS } from "./composition"
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
// config (zod-first DSL + strict admin document)
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
export type { DraftKey, DraftRecord, DraftStore } from "./drafts"
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
// fields (schema factories, parse, strict-save validator)
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
// pipeline (C.1 driver, C.2 conflict engine): save driver + laws + policy
export type {
  CommitMessageVerdict,
  ConcurrencyLimiter,
  ConflictEngineInput,
  ConflictEngineResult,
  FieldPath,
  FieldPathSegment,
  FileConflictVerdict,
  OurWrite,
  RateDescriptor,
  RebaseInput,
  RebaseIssue,
  RebaseIssueCode,
  RebaseResult,
  RebaseSuccess,
  SaveConflictDetails,
  SaveDriverInput,
  SavePhase,
  SaveVerdict,
} from "./pipeline"
export {
  commonAncestorFieldPath,
  composeCommitMessage,
  computeDirtyPaths,
  containsSkipToken,
  createConcurrencyLimiter,
  createRateResume,
  describeRatePause,
  diffPaths,
  equalsFieldPath,
  fieldEquals,
  fieldPathKey,
  isAncestorFieldPath,
  isZeroDiffChangeSet,
  parseRateWindowReset,
  parseRetryAfter,
  readAtFieldPath,
  rebase,
  relatedFieldPaths,
  resolveConflictPaths,
  runSave,
  SAVE_PHASE_ORDER,
} from "./pipeline"
export type {
  JsonPrimitive,
  JsonValue,
  MoneyFormatOptions,
  SafePathFailureCode,
  SafePathOptions,
  SafePathResult,
  SafeUrlFailureCode,
  SafeUrlOptions,
  SafeUrlResult,
  SortDirection,
  TemplateValues,
  UntrustedJsonFailureCode,
  UntrustedJsonIssue,
  UntrustedJsonOptions,
  UntrustedJsonResult,
} from "./safety"
// safety (masked logger, untrusted JSON, path/url, templates, collation, money, slug)
export {
  compareNumbers,
  compareText,
  compareValues,
  createLogger,
  createTextCollator,
  DEFAULT_LOCALE,
  decodeBase64,
  decodeUtf8,
  deriveSlug,
  encodeUtf8,
  formatMoney,
  isSafePath,
  isSafeUrl,
  mustacheLite,
  parseUntrustedJson,
  readPath,
  safePath,
  safeUrl,
  sortBy,
  UNTRUSTED_JSON_LIMITS,
  utf8ByteLength,
} from "./safety"
export type { Logger, LogLevel, LogRecord } from "./safety/logger"
export type { JsonDocument, NewlineStyle, ParseJsonDocumentResult } from "./serialization"
// serialization (source-preserving documents)
export {
  canonicalJson,
  detectNewline,
  documentsCanonicallyEqual,
  jsonEqual,
  normalizeNewlines,
  parseJsonDocument,
  serializeDocument,
} from "./serialization"
export type { WebKeyValueStore } from "./web"
