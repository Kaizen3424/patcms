/** Safety module barrel — masked logger, untrusted JSON, path/url guards, templates, collation, money, slug. */

export type { SortDirection } from "./collator"
export {
  compareNumbers,
  compareText,
  compareValues,
  createTextCollator,
  DEFAULT_LOCALE,
  sortBy,
} from "./collator"
export { formatFriendlyDate, formatRelativeTime, parseDate } from "./dates"
export { decodeBase64, decodeUtf8, encodeBase64, encodeUtf8 } from "./encoding"
export type { Logger, LogLevel, LogRecord } from "./logger"
export { createLogger, isSensitiveKey, maskData, maskString } from "./logger"
export type { MoneyFormatOptions } from "./money"
export { formatMoney } from "./money"
export type { TemplateValues } from "./mustache"
export { mustacheLite, readPath } from "./mustache"
export type { SafePathFailureCode, SafePathOptions, SafePathResult } from "./safe-path"
export { isSafePath, safePath } from "./safe-path"
export type { SafeUrlFailureCode, SafeUrlOptions, SafeUrlResult } from "./safe-url"
export { isSafeUrl, safeUrl } from "./safe-url"
export { deriveSlug } from "./slug"
export type {
  JsonPrimitive,
  JsonValue,
  UntrustedJsonFailureCode,
  UntrustedJsonIssue,
  UntrustedJsonOptions,
  UntrustedJsonResult,
} from "./untrusted-json"
export {
  parseUntrustedJson,
  UNTRUSTED_JSON_LIMITS,
  utf8ByteLength,
} from "./untrusted-json"
