import { CapabilityProbeError } from "@mycms/core"
import type { FormEvent } from "react"
import { useState } from "react"
import { EXPIRY_COPY, fillName } from "../editor/copy"
import { copyToClipboard } from "../editor/failure-report"
import { useRuntime } from "../runtime/context"
import { LoginHeartbeat } from "../status/heartbeat"

/**
 * P1 login card — access key -> capability probe -> signed-in shell.
 * Copy law: founder vocabulary ("access key"), no token jargon in the primary
 * path; the remember copy is the exact ADR-0002 consent language.
 */
export function LoginScreen() {
  const { signIn, bootNotice, config, support } = useRuntime()
  const [accessKey, setAccessKey] = useState("")
  const [remember, setRemember] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)
  const [isExpiredAuth, setIsExpiredAuth] = useState(false)
  const [copiedNote, setCopiedNote] = useState(false)

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (accessKey.trim().length === 0 || busy) return
    setBusy(true)
    setError(undefined)
    try {
      await signIn(accessKey, remember)
    } catch (caught) {
      if (caught instanceof CapabilityProbeError && caught.code === "AUTH_EXPIRED") {
        setIsExpiredAuth(true)
      } else {
        setIsExpiredAuth(false)
      }
      setError(loginErrorMessage(caught))
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-bg p-6 text-text-primary">
      <section className="w-full max-w-md">
        <div className="mb-8 flex items-center gap-3">
          <span
            aria-hidden="true"
            className="grid size-11 place-items-center rounded-card border border-accent/40 bg-accent-soft text-sm font-semibold text-accent"
          >
            I&Y
          </span>
          <div>
            <p className="text-sm text-text-muted">{config.site?.name ?? "Content studio"}</p>
            <h1 className="text-2xl font-semibold tracking-tight">Content studio</h1>
          </div>
        </div>

        <form
          onSubmit={submit}
          className="rounded-card border border-border-soft bg-surface p-6 shadow-2xl shadow-black/20 sm:p-8"
        >
          <h2 className="text-lg font-semibold tracking-tight">Open the studio</h2>
          <p className="mt-2 text-sm leading-6 text-text-muted">
            Use the GitHub access key set up for this site. It is checked once, then the studio
            opens only the content folders this key can reach.
          </p>

          {bootNotice === undefined ? null : (
            <p
              role="status"
              className="mt-4 rounded-lg border border-accent/30 bg-accent-soft px-3 py-2 text-sm text-text-primary"
            >
              {bootNotice}
            </p>
          )}

          <div className="mt-6 grid gap-2">
            <label htmlFor="access-key" className="text-sm font-medium text-text-primary">
              Access key
            </label>
            <input
              id="access-key"
              name="access-key"
              type="password"
              value={accessKey}
              onChange={(event) => setAccessKey(event.target.value)}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              placeholder="github_pat_..."
              disabled={busy}
              aria-describedby="access-key-help"
              aria-invalid={error !== undefined}
              className="rounded-lg border border-border-soft bg-surface-raised px-4 py-3 text-base outline-none transition-colors placeholder:text-text-muted/60 focus-visible:border-accent/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-60"
            />
            <p id="access-key-help" className="text-xs leading-5 text-text-muted">
              Fine-grained key with read access to this site&apos;s content. It never appears in a
              web address.
            </p>
          </div>

          <label className="mt-5 flex cursor-pointer items-start gap-3 text-sm">
            <input
              type="checkbox"
              checked={remember}
              onChange={(event) => setRemember(event.target.checked)}
              disabled={busy}
              className="mt-0.5 size-4 accent-[var(--color-accent)]"
            />
            <span>
              <span className="font-medium text-text-primary">Remember on this device</span>
              <span className="mt-1 block text-xs leading-5 text-text-muted">
                Stored in this browser. Any code running on this page could still read it, so this
                is convenience, not protection. Revoke it anytime at github.com/settings/tokens.
              </span>
            </span>
          </label>

          {error === undefined ? null : (
            <div>
              <p
                role="alert"
                className="mt-4 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm leading-5 text-text-primary"
              >
                {error}
              </p>
              {isExpiredAuth ? (
                <div className="mt-3 rounded-lg border border-border-soft bg-surface-raised p-3">
                  <p className="text-xs text-text-muted">
                    {fillName(EXPIRY_COPY.partnerNoteText, support.name)}
                  </p>
                  <button
                    type="button"
                    onClick={async () => {
                      await copyToClipboard(fillName(EXPIRY_COPY.partnerNoteText, support.name))
                      setCopiedNote(true)
                      setTimeout(() => setCopiedNote(false), 2000)
                    }}
                    data-testid="copy-partner-note-button"
                    className="mt-2 text-xs font-medium text-accent hover:underline focus-visible:outline-2 focus-visible:outline-accent cursor-pointer"
                  >
                    {copiedNote
                      ? `✓ ${EXPIRY_COPY.copiedNote}`
                      : fillName(EXPIRY_COPY.partnerNoteButton, support.name)}
                  </button>
                </div>
              ) : null}
            </div>
          )}

          <button
            type="submit"
            disabled={busy || accessKey.trim().length === 0}
            className="mt-6 w-full rounded-lg bg-accent px-4 py-3 text-base font-semibold text-[#111] outline-none transition-opacity focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? "Checking the key..." : "Continue"}
          </button>
        </form>

        <p className="mt-5 text-center text-xs text-text-muted">
          Nothing is sent anywhere except GitHub. No tracking, no analytics.
        </p>
        <LoginHeartbeat />
      </section>
    </main>
  )
}

function loginErrorMessage(error: unknown): string {
  if (error instanceof CapabilityProbeError) {
    switch (error.code) {
      case "AUTH_EXPIRED":
        return "That access key was not accepted. Check that it has not expired or been revoked, then try again."
      case "SCOPE":
        return "That key works, but it does not have access to this site. Check the key's access settings."
      case "NOT_FOUND":
        return "We could not find the site. Check the site address and the key's access."
      case "RATE_LIMIT":
        return "GitHub is limiting requests right now. Try again when the limit resets."
      case "NETWORK":
        return "We could not reach GitHub. Check this device's connection and try again."
      default:
        return "The key could not be checked. Please try again."
    }
  }
  return "The key could not be checked. Please try again."
}
