import type { ParseIssue } from "patcms/advanced"

/**
 * Filters all validation issues that apply to a given field name or path prefix.
 * e.g., prefix "images" matches "images", "images[0]", and "images[0].alt".
 */
export function findNestedIssues(
  issues: readonly ParseIssue[] | undefined,
  prefix: string,
): readonly ParseIssue[] {
  if (issues === undefined || issues.length === 0) return []
  return issues.filter(
    (issue) =>
      issue.path === prefix ||
      issue.path.startsWith(`${prefix}.`) ||
      issue.path.startsWith(`${prefix}[`),
  )
}

/**
 * Strips the field prefix from issues so that child widgets receive paths
 * relative to their own container.
 * e.g., "options[0].name" with prefix "options" becomes "[0].name".
 * "[0].name" with prefix "[0]" becomes "name".
 */
export function stripIssuePrefix(
  issues: readonly ParseIssue[] | undefined,
  prefix: string,
): readonly ParseIssue[] {
  if (issues === undefined || issues.length === 0) return []
  return issues
    .filter(
      (issue) =>
        issue.path === prefix ||
        issue.path.startsWith(`${prefix}.`) ||
        issue.path.startsWith(`${prefix}[`),
    )
    .map((issue) => {
      let relativePath = ""
      if (issue.path === prefix) {
        relativePath = ""
      } else if (issue.path.startsWith(`${prefix}.`)) {
        relativePath = issue.path.slice(prefix.length + 1)
      } else if (issue.path.startsWith(`${prefix}[`)) {
        relativePath = issue.path.slice(prefix.length)
      } else {
        relativePath = issue.path
      }
      return {
        ...issue,
        path: relativePath,
      }
    })
}
