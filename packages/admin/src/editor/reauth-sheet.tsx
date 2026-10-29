import { useEffect, useRef, useState } from "react"
import { useRuntimeSafe } from "../runtime/context"
import { fillName, REAUTH_COPY } from "./copy"

export interface ReauthSheetProps {
  readonly open: boolean
  readonly supportName: string
  /** True when prompted because an entry read 401'd; false for mid-save. */
  readonly isRead?: boolean
  readonly onReauthenticated: () => void
  readonly onCancel: () => void
  readonly onSignOut: () => void
  /** Injected reauthenticate callback (defaults to useRuntime().reauthenticate). */
  readonly reauthenticate?: (token: string, remember: boolean) => Promise<unknown>
}

const PRIMARY_BUTTON =
  "rounded-lg bg-accent px-4 py-2 text-xs font-semibold text-[#111] outline-none transition-opacity focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-40"
const SECONDARY_BUTTON =
  "rounded-lg border border-border-strong bg-surface px-3 py-2 text-xs font-medium text-text-primary outline-none transition-colors hover:border-accent/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-40"

/**
 * In-place re-auth modal sheet (P2.10 — INV-A01).
 *
 * Appears when a mid-batch write or initial read fails with 401 AUTH_EXPIRED.
 * Preserves drafts in IndexedDB, probes the new key before accepting, updates
 * the transport token in-place without coordinator destruction, and resumes the save.
 */
export function ReauthSheet({
  open,
  supportName,
  isRead = false,
  onReauthenticated,
  onCancel,
  onSignOut,
  reauthenticate: customReauthenticate,
}: ReauthSheetProps) {
  const runtime = useRuntimeSafe()
  const doReauthenticate = customReauthenticate ?? runtime?.reauthenticate
  const [token, setToken] = useState("")
  const [showKey, setShowKey] = useState(false)
  const [remember, setRemember] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | undefined>(undefined)

  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      setToken("")
      setErrorMessage(undefined)
      setSubmitting(false)
      const timer = setTimeout(() => inputRef.current?.focus(), 50)
      return () => clearTimeout(timer)
    }
  }, [open])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (open && e.key === "Escape" && !submitting) {
        onCancel()
      }
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [open, submitting, onCancel])

  if (!open) return null

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = token.trim()
    if (trimmed.length === 0) {
      setErrorMessage(REAUTH_COPY.errorEmpty)
      return
    }

    setSubmitting(true)
    setErrorMessage(undefined)

    try {
      if (doReauthenticate === undefined) throw new Error("no reauthenticate provider")
      await doReauthenticate(trimmed, remember)
      onReauthenticated()
    } catch {
      setErrorMessage(REAUTH_COPY.errorInvalid)
    } finally {
      setSubmitting(false)
    }
  }

  const title = isRead ? REAUTH_COPY.readTitle : REAUTH_COPY.title
  const detail = fillName(REAUTH_COPY.detail, supportName)

  return (
    <div
      role="presentation"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="reauth-sheet-title"
        data-testid="reauth-sheet"
        className="w-full max-w-md rounded-2xl border border-border-strong bg-surface p-6 shadow-2xl"
      >
        <div className="mb-4">
          <h2 id="reauth-sheet-title" className="text-base font-semibold text-text-primary">
            {title}
          </h2>
          <p className="mt-1 text-xs leading-relaxed text-text-muted">{detail}</p>
        </div>

        {errorMessage !== undefined ? (
          <div
            role="alert"
            className="mb-4 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger"
          >
            {errorMessage}
          </div>
        ) : null}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="reauth-access-key-input"
              className="block text-xs font-medium text-text-primary"
            >
              {REAUTH_COPY.inputLabel}
            </label>
            <div className="relative mt-1">
              <input
                ref={inputRef}
                id="reauth-access-key-input"
                name="accessKey"
                type={showKey ? "text" : "password"}
                autoComplete="off"
                spellCheck="false"
                placeholder={REAUTH_COPY.inputPlaceholder}
                value={token}
                onChange={(e) => setToken(e.target.value)}
                disabled={submitting}
                className="w-full rounded-lg border border-border-soft bg-surface-muted px-3 py-2 pr-16 text-xs text-text-primary outline-none transition-colors placeholder:text-text-muted/60 focus:border-accent"
              />
              <button
                type="button"
                onClick={() => setShowKey(!showKey)}
                tabIndex={-1}
                className="absolute inset-y-0 right-2 my-auto h-6 rounded px-1.5 text-[10px] text-text-muted hover:text-text-primary"
              >
                {showKey ? REAUTH_COPY.hideKey : REAUTH_COPY.showKey}
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <input
              id="reauth-remember-checkbox"
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
              disabled={submitting}
              className="h-3.5 w-3.5 rounded border-border-strong bg-surface accent-accent"
            />
            <label
              htmlFor="reauth-remember-checkbox"
              className="cursor-pointer text-xs text-text-muted"
            >
              {REAUTH_COPY.remember}
            </label>
          </div>

          <div className="mt-6 flex flex-wrap items-center justify-between gap-2 pt-2">
            <button
              type="button"
              className={SECONDARY_BUTTON}
              onClick={onSignOut}
              disabled={submitting}
            >
              {REAUTH_COPY.signOut}
            </button>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className={SECONDARY_BUTTON}
                onClick={onCancel}
                disabled={submitting}
              >
                {REAUTH_COPY.cancel}
              </button>
              <button type="submit" className={PRIMARY_BUTTON} disabled={submitting}>
                {submitting
                  ? REAUTH_COPY.submitting
                  : isRead
                    ? REAUTH_COPY.submitRead
                    : REAUTH_COPY.submit}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  )
}
