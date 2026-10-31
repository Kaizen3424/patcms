import type { FieldDescriptor, ListFieldDescriptor, ParseIssue } from "@mycms/core"

/**
 * Static copy deck for parse and validation messages.
 * Every string is verified clean of the 9 banned words.
 */
export const MESSAGE_MAP_COPY = {
  priceInteger: "Whole numbers only, e.g. 1450",
  emailFormat: "Email needs @ and a dot",
  chooseOption: "Choose one of the options",
  relationUnknown: "Reference to a removed product",
  relationCheckFailed: "Could not verify connection right now. Ask {name} for help.",
  invalidDate: "Please enter a valid calendar date",
  invalidPath: "Image path should start with /images/",
  listTooShort: "Keep at least {min} item{plural}",
  listTooLong: "At most {max} item{plural} allowed",
  missingRequired: "Please fill in {label}",
  outOfRange: "This value is outside the allowed range",
  virtualKeyIgnored: "This web address is calculated automatically",
  unmodeledKey: "This extra setting is preserved behind the scenes",
  unknownFieldType: "This field type is not recognized. Ask {name} for help.",
  fallbackError: "Please check this value",
} as const

/**
 * Translates a machine validation/parse issue into founder-friendly prose.
 */
export function humanizeIssue(
  issue: ParseIssue,
  field?: FieldDescriptor,
  supportName = "your web partner",
): string {
  const label = field?.label ?? "this field"

  switch (issue.code) {
    case "TYPE_MISMATCH":
      if (field?.type === "number") {
        return MESSAGE_MAP_COPY.priceInteger
      }
      return `${label} is in an unexpected format`

    case "PATTERN_MISMATCH":
      if (field?.type === "string" && (field as { format?: string }).format === "email") {
        return MESSAGE_MAP_COPY.emailFormat
      }
      return `${label} needs to match the expected format`

    case "INVALID_OPTION":
      return `${label} — ${MESSAGE_MAP_COPY.chooseOption}`

    case "RELATION_UNKNOWN":
      return MESSAGE_MAP_COPY.relationUnknown

    case "RELATION_CHECK_FAILED":
      return MESSAGE_MAP_COPY.relationCheckFailed.replace("{name}", supportName)

    case "INVALID_DATE":
      return MESSAGE_MAP_COPY.invalidDate

    case "INVALID_PATH":
      return MESSAGE_MAP_COPY.invalidPath

    case "LIST_TOO_SHORT": {
      const min = (field as Partial<ListFieldDescriptor>)?.min ?? 1
      return MESSAGE_MAP_COPY.listTooShort
        .replace("{min}", String(min))
        .replace("{plural}", min === 1 ? "" : "s")
    }

    case "LIST_TOO_LONG": {
      const max = (field as Partial<ListFieldDescriptor>)?.max ?? 1
      return MESSAGE_MAP_COPY.listTooLong
        .replace("{max}", String(max))
        .replace("{plural}", max === 1 ? "" : "s")
    }

    case "MISSING_REQUIRED":
      return MESSAGE_MAP_COPY.missingRequired.replace("{label}", label)

    case "OUT_OF_RANGE":
      return MESSAGE_MAP_COPY.outOfRange

    case "VIRTUAL_KEY_IGNORED":
      return MESSAGE_MAP_COPY.virtualKeyIgnored

    case "UNMODELED_KEY":
      return MESSAGE_MAP_COPY.unmodeledKey

    case "UNKNOWN_FIELD_TYPE":
      return MESSAGE_MAP_COPY.unknownFieldType.replace("{name}", supportName)

    default:
      return issue.message || MESSAGE_MAP_COPY.fallbackError
  }
}
