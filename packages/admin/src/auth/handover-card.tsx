import { useEffect, useState } from "react"
import { EXPIRY_COPY } from "../editor/copy"
import { getTokenExpiryConfig, setTokenExpiryConfig, type TokenExpiryConfig } from "./token-expiry"

export interface HandoverCardProps {
  readonly onSaved?: (config: TokenExpiryConfig) => void
}

export function HandoverCard({ onSaved }: HandoverCardProps) {
  const [createdAt, setCreatedAt] = useState(() => new Date().toISOString().slice(0, 10))
  const [durationDays, setDurationDays] = useState<30 | 60 | 90>(60)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    let active = true
    void getTokenExpiryConfig().then((cfg) => {
      if (active && cfg) {
        setCreatedAt(cfg.createdAt.slice(0, 10))
        setDurationDays(cfg.durationDays)
      }
    })
    return () => {
      active = false
    }
  }, [])

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    const config: TokenExpiryConfig = {
      createdAt: new Date(createdAt).toISOString(),
      durationDays,
    }
    await setTokenExpiryConfig(config)
    setSaved(true)
    onSaved?.(config)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <section
      aria-label={EXPIRY_COPY.handoverTitle}
      data-testid="handover-card"
      className="rounded-card border border-border-soft bg-surface p-5 shadow-sm sm:p-6"
    >
      <div className="mb-4">
        <h2 className="text-sm font-semibold tracking-tight text-text-primary">
          {EXPIRY_COPY.handoverTitle}
        </h2>
        <p className="mt-1 text-xs text-text-muted">{EXPIRY_COPY.handoverSubtitle}</p>
      </div>

      <form onSubmit={handleSave} className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="key-created-at" className="block text-xs font-medium text-text-primary">
            {EXPIRY_COPY.createdLabel}
          </label>
          <input
            id="key-created-at"
            type="date"
            value={createdAt}
            onChange={(e) => setCreatedAt(e.target.value)}
            className="mt-1 w-full rounded-lg border border-border-soft bg-surface-raised px-3 py-1.5 text-xs text-text-primary focus-visible:outline-2 focus-visible:outline-accent"
          />
        </div>

        <div>
          <label htmlFor="key-duration" className="block text-xs font-medium text-text-primary">
            {EXPIRY_COPY.durationLabel}
          </label>
          <select
            id="key-duration"
            value={durationDays}
            onChange={(e) => setDurationDays(Number(e.target.value) as 30 | 60 | 90)}
            className="mt-1 w-full rounded-lg border border-border-soft bg-surface-raised px-3 py-1.5 text-xs text-text-primary focus-visible:outline-2 focus-visible:outline-accent"
          >
            <option value={30}>30 days</option>
            <option value={60}>60 days</option>
            <option value={90}>90 days</option>
          </select>
        </div>

        <div className="sm:col-span-2 flex items-center justify-between pt-2">
          {saved ? (
            <span className="text-xs text-success font-medium">✓ {EXPIRY_COPY.settingsSaved}</span>
          ) : (
            <span />
          )}
          <button
            type="submit"
            data-testid="save-handover-button"
            className="rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-[#111] transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-accent"
          >
            {EXPIRY_COPY.saveSettings}
          </button>
        </div>
      </form>
    </section>
  )
}
