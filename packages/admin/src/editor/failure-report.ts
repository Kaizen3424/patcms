/**
 * Structured Copy Composer (P2.10 — master-plan §2.8 & §7).
 *
 * Emits a dual-audience diagnostic message:
 *  1. Plain human greeting from founder to {support.name} (no jargon, friendly SVO).
 *  2. Structured bulleted diagnostics for the technical partner (entry, repo, branch,
 *     base revision, changed fields, typed error code, HTTP status, timestamp, and guidance).
 *
 * Guarantees zero credential leaks (INV-A04/INV-A05): tokens and raw request bodies
 * are NEVER accepted or printed.
 */

export interface FailureReportContext {
  readonly entryTitle: string
  readonly filePath: string
  readonly branch: string
  readonly repo: string
  readonly baseSha: string
  readonly changedFields?: readonly string[]
  readonly errorCode: string
  readonly httpStatus?: number
  readonly timestamp: string
  readonly partnerName: string
  readonly guidance?: string
  readonly kind?: "save" | "read" | "advisory"
  readonly advisoryDetail?: string
}

export const PARTNER_GUIDANCE: Readonly<Record<string, string>> = {
  AUTH_EXPIRED:
    "The access key is expired, revoked, or invalid. Generate a new fine-grained personal access token with Contents Read and Write access.",
  SCOPE:
    "The access key lacks write permissions on this repository. Verify that 'Contents: Read and write' permission is granted.",
  RATE_LIMIT:
    "GitHub API rate limit exhausted. Check token allocation or secondary rate limit triggers.",
  NOT_FOUND:
    "The target repository or branch was not found. Confirm repository visibility, spelling, and branch configuration.",
  VALIDATION:
    "GitHub Git Data API rejected the tree or commit payload (422 non-fast-forward). Check commit message tokens or file schema.",
  NETWORK:
    "Network connection error contacting api.github.com. Verify DNS, firewall, or device connection.",
  TREE_TRUNCATED:
    "The tree exceeds GitHub's size limits or contains too many files to read safely in one request.",
  UNKNOWN: "Unclassified GitHub API error. Check GitHub status and recent workflow runs.",
}

/** Formats the dual-audience diagnostic payload for sharing with support.name. */
export function composeFailureReport(ctx: FailureReportContext): string {
  const guidance = ctx.guidance ?? PARTNER_GUIDANCE[ctx.errorCode] ?? PARTNER_GUIDANCE.UNKNOWN ?? ""
  const fields =
    ctx.changedFields && ctx.changedFields.length > 0 ? ctx.changedFields.join(", ") : "none"
  const statusStr = ctx.httpStatus !== undefined ? ` (HTTP ${ctx.httpStatus})` : ""

  const opDescription =
    ctx.kind === "read"
      ? `opening "${ctx.entryTitle}"`
      : ctx.kind === "advisory"
        ? `saving "${ctx.entryTitle}" (an older problem paused site updates)`
        : `saving "${ctx.entryTitle}"`

  const advisoryLine = ctx.advisoryDetail ? `\n• Advisory note: ${ctx.advisoryDetail}` : ""

  return `Hi ${ctx.partnerName},

I had trouble ${opDescription} on the site. My changes are kept on this device, but they could not be saved to the site.

Could you please take a look?

---
Details for ${ctx.partnerName}:
• Entry: ${ctx.entryTitle} (${ctx.filePath})
• Address: ${ctx.repo}
• Branch: ${ctx.branch}
• Base revision: ${ctx.baseSha || "unknown"}
• Changed fields: ${fields}
• Error: ${ctx.errorCode}${statusStr}${advisoryLine}
• Time: ${ctx.timestamp}
• Guidance: ${guidance}`
}

/**
 * Copies plain text to the clipboard via navigator.clipboard.writeText, falling back
 * to a hidden textarea execCommand in headless or unprivileged browser frames.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // Fall through to fallback
    }
  }
  if (typeof document !== "undefined" && document.createElement) {
    try {
      const textarea = document.createElement("textarea")
      textarea.value = text
      textarea.style.position = "fixed"
      textarea.style.opacity = "0"
      textarea.style.left = "-9999px"
      document.body.appendChild(textarea)
      textarea.focus()
      textarea.select()
      const success = document.execCommand("copy")
      document.body.removeChild(textarea)
      return success
    } catch {
      return false
    }
  }
  return false
}
