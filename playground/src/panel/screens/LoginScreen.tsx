/**
 * Sign-in screen. The PAT is typed once, probed by `auth.signIn`, and never
 * leaves the Authorization header — no URL, no log, no state beyond the
 * token store the host chose.
 */

import type { CMS } from "patcms"
import { isCMSError } from "patcms"
import { useState } from "react"

export function LoginScreen({ cms, checking }: { cms: CMS; checking: boolean }) {
  const [token, setToken] = useState("")
  const [error, setError] = useState<string | undefined>(undefined)
  const [busy, setBusy] = useState(false)

  const signIn = async (): Promise<void> => {
    setBusy(true)
    setError(undefined)
    try {
      // remember: true persists through the host-chosen tokenStore (IDB here).
      await cms.auth.signIn(token, { remember: true })
      // App re-renders from the auth:change subscription.
    } catch (cause) {
      if (isCMSError(cause)) {
        setError(`${cause.code}: ${cause.message}`)
      } else {
        setError(cause instanceof Error ? cause.message : "sign-in failed")
      }
    } finally {
      setBusy(false)
      setToken("")
    }
  }

  return (
    <div className="panel-login">
      <form
        className="panel-card panel-login-card"
        onSubmit={(event) => {
          event.preventDefault()
          void signIn()
        }}
      >
        <h1>patcms panel</h1>
        <p className="panel-muted">
          Sign in with a GitHub fine-grained PAT (Contents: read+write).
        </p>
        <label className="panel-label" htmlFor="panel-token">
          Personal access token
        </label>
        <input
          id="panel-token"
          type="password"
          className="panel-input"
          autoComplete="off"
          value={token}
          onChange={(event) => setToken(event.target.value)}
          disabled={busy || checking}
        />
        {error === undefined ? null : <p className="panel-error">{error}</p>}
        <button type="submit" className="panel-btn" disabled={busy || checking || token === ""}>
          {busy || checking ? "Checking…" : "Sign in"}
        </button>
      </form>
    </div>
  )
}
