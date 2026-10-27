export type { JsonDocument, NewlineStyle, ParseJsonDocumentResult } from "./document"
export {
  canonicalJson,
  detectNewline,
  documentsCanonicallyEqual,
  jsonEqual,
  normalizeNewlines,
  parseJsonDocument,
  serializeDocument,
} from "./document"
export type {
  ComposedEntryDocument,
  ComposeEntryDocumentInput,
} from "./entry-document"
export { composeEntryDocument } from "./entry-document"
