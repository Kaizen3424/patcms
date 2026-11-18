/**
 * Field registry vocabulary + zod-first factories (ADR-0003 / ADR-0009).
 * 12 value types, `divider` decoration, virtual `slug`.
 */
export { divider } from "./divider"
export type {
  BaseFieldOptions,
  BooleanFieldOptions,
  DatetimeFieldOptions,
  HiddenFieldOptions,
  ImageFieldOptions,
  ListFieldOptions,
  NumberFieldOptions,
  ObjectFieldOptions,
  RelationFieldOptions,
  SelectFieldOptions,
  SlugFieldOptions,
  StringFieldOptions,
  TextFieldOptions,
} from "./factories"
export {
  boolean,
  datetime,
  defineField,
  hidden,
  image,
  list,
  number,
  object,
  relation,
  select,
  slug,
  string,
  text,
} from "./factories"
export { CMS_META_KEY, getFieldMeta, setFieldMeta, unwrapFieldSchema } from "./meta"
export type { ParsedEntry, ParseEntryOptions, ParseIssue, ParseIssueCode } from "./parse"
export { parseEntry } from "./parse"
export type {
  BaseFieldDescriptor,
  BaseFieldMeta,
  BooleanFieldDescriptor,
  BooleanFieldMeta,
  DatetimeFieldDescriptor,
  DatetimeFieldMeta,
  DividerDeclaration,
  DividerFieldDescriptor,
  FieldDescriptor,
  FieldMeta,
  FieldTypeName,
  FieldWidth,
  HiddenFieldDescriptor,
  HiddenFieldMeta,
  ImageFieldDescriptor,
  ImageFieldMeta,
  ListFieldDescriptor,
  ListFieldMeta,
  NamedFieldSchema,
  NumberFieldDescriptor,
  NumberFieldMeta,
  ObjectFieldDescriptor,
  ObjectFieldMeta,
  RelationFieldDescriptor,
  RelationFieldMeta,
  SelectFieldDescriptor,
  SelectFieldMeta,
  SelectOption,
  SlugFieldDescriptor,
  SlugFieldMeta,
  StringFieldDescriptor,
  StringFieldMeta,
  StringFormat,
  TextFieldDescriptor,
  TextFieldMeta,
} from "./types"
export type {
  EntryValidationOptions,
  EntryValidationResult,
  ParsedEntryValidationOptions,
  RelationServices,
} from "./validate"
export {
  collectRelationIssues,
  mergeUntouched,
  validateEntryForSave,
  validateParsedEntryForSave,
} from "./validate"
