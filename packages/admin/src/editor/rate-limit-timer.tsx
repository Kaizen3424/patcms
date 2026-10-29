import { useEffect, useRef, useState } from "react"
import { fillLine, RATE_COPY } from "./copy"

export interface RateLimitTimerProps {
  /** Total milliseconds until rate limit window resets. */
  readonly waitMs: number
  /** Callback when the founder clicks "Try saving now" manual override. */
  readonly onManualResume: () => void
  /** Injected clock for deterministic testing. */
  readonly now?: () => number
}

const SECONDARY_BUTTON =
  "rounded-lg border border-accent/40 bg-accent-soft px-3 py-1.5 text-xs font-medium text-text-primary outline-none transition-colors hover:border-accent/80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"

/**
 * Accessible rate-limit countdown UI (P2.10 — INV-N01).
 *
 * Rules:
 *  - Calculates remaining time against absolute target epoch (no drift in background tabs).
 *  - Visual ticker marked `aria-hidden="true"` so screen readers are NOT spammed every second.
 *  - Screen reader announcements fire only on milestones: start, 10-second warning, and resumption.
 *  - Provides "Try saving now" manual override calling coordinator.resume().
 */
export function RateLimitTimer({ waitMs, onManualResume, now = Date.now }: RateLimitTimerProps) {
  const targetEpoch = useRef(now() + Math.max(0, waitMs))
  const initialSeconds = Math.max(0, Math.ceil(waitMs / 1000))
  const [secondsRemaining, setSecondsRemaining] = useState(initialSeconds)
  const [announcement, setAnnouncement] = useState(() =>
    fillLine(RATE_COPY.announcementStart, { seconds: String(initialSeconds) }),
  )
  const announcedTen = useRef(false)

  useEffect(() => {
    targetEpoch.current = now() + Math.max(0, waitMs)
    const initial = Math.max(0, Math.ceil(waitMs / 1000))
    setSecondsRemaining(initial)
    setAnnouncement(fillLine(RATE_COPY.announcementStart, { seconds: String(initial) }))
    announcedTen.current = false
  }, [waitMs, now])

  useEffect(() => {
    const interval = setInterval(() => {
      const remaining = Math.max(0, Math.ceil((targetEpoch.current - now()) / 1000))
      setSecondsRemaining(remaining)

      if (remaining === 10 && !announcedTen.current) {
        announcedTen.current = true
        setAnnouncement(RATE_COPY.announcementWarning)
      } else if (remaining === 0) {
        setAnnouncement(RATE_COPY.announcementResume)
      }
    }, 500)

    return () => clearInterval(interval)
  }, [now])

  return (
    <div
      data-testid="rate-limit-timer"
      className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-accent/30 bg-accent/10 px-3 py-2 text-xs"
    >
      {/* Screen-reader milestone live region */}
      <span role="status" aria-live="polite" className="sr-only">
        {announcement}
      </span>

      {/* Visual countdown ticker */}
      <div className="flex items-center gap-2 font-medium text-text-primary">
        <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-accent" />
        <span aria-hidden="true">
          {fillLine(RATE_COPY.countdown, { seconds: String(secondsRemaining) })}
        </span>
      </div>

      <button type="button" className={SECONDARY_BUTTON} onClick={onManualResume}>
        {RATE_COPY.resumeNow}
      </button>
    </div>
  )
}
