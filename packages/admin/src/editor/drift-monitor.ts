import type { GitBackend } from "@mycms/core"
import { useEffect, useRef, useState } from "react"

export interface DriftInfo {
  readonly remoteSha: string
  readonly detectedAt: string
}

export interface UseDriftMonitorOptions {
  readonly branch?: string
  readonly baseHeadSha?: string
  readonly entryPath?: string
  readonly backend?: GitBackend
  readonly rateLimitRemaining?: number | null
  readonly enabled?: boolean
  readonly pollIntervalMs?: number
  readonly idleBackoffMs?: number
}

const DEFAULT_POLL_INTERVAL_MS = 60_000
const DEFAULT_IDLE_BACKOFF_MS = 300_000
const FIVE_MINUTES_MS = 5 * 60_000
const THIRTY_MINUTES_MS = 30 * 60_000

export function useDriftMonitor(options: UseDriftMonitorOptions): {
  readonly drift: DriftInfo | undefined
  readonly clearDrift: () => void
} {
  const {
    branch,
    baseHeadSha,
    entryPath,
    backend,
    rateLimitRemaining,
    enabled = true,
    pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
    idleBackoffMs = DEFAULT_IDLE_BACKOFF_MS,
  } = options

  const [drift, setDrift] = useState<DriftInfo | undefined>(undefined)
  const lastActivityRef = useRef<number>(Date.now())
  const lastBaseShaRef = useRef<string | undefined>(baseHeadSha)

  // Clear drift when baseHeadSha advances (e.g. after saving or reloading)
  useEffect(() => {
    if (baseHeadSha !== lastBaseShaRef.current) {
      lastBaseShaRef.current = baseHeadSha
      setDrift(undefined)
    }
  }, [baseHeadSha])

  useEffect(() => {
    const handleActivity = () => {
      lastActivityRef.current = Date.now()
    }

    window.addEventListener("pointermove", handleActivity, { passive: true })
    window.addEventListener("keydown", handleActivity, { passive: true })

    return () => {
      window.removeEventListener("pointermove", handleActivity)
      window.removeEventListener("keydown", handleActivity)
    }
  }, [])

  useEffect(() => {
    if (!enabled || !branch || !baseHeadSha || !entryPath || !backend) {
      return
    }

    let active = true
    let timerId: ReturnType<typeof setTimeout> | undefined

    const check = async () => {
      // 1. Check document visibility
      if (typeof document !== "undefined" && document.visibilityState !== "visible") {
        scheduleNext(pollIntervalMs)
        return
      }

      // 2. Check idle time: halt after 30 minutes
      const idleTime = Date.now() - lastActivityRef.current
      if (idleTime >= THIRTY_MINUTES_MS) {
        return
      }

      // 3. Check rate limit
      if (
        rateLimitRemaining !== null &&
        rateLimitRemaining !== undefined &&
        rateLimitRemaining < 100
      ) {
        scheduleNext(idleBackoffMs)
        return
      }

      try {
        const ref = await backend.getRef(branch)
        if (!active) return

        if (ref.object.sha && ref.object.sha !== baseHeadSha) {
          const changedFiles = await backend.listChangedFiles(branch, baseHeadSha, ref.object.sha)
          if (!active) return

          if (changedFiles.has(entryPath)) {
            setDrift({
              remoteSha: ref.object.sha,
              detectedAt: new Date().toISOString(),
            })
            return // Stop polling once drift is detected
          }
        }
      } catch {
        // fail-soft
      }

      const nextInterval = idleTime >= FIVE_MINUTES_MS ? idleBackoffMs : pollIntervalMs
      scheduleNext(nextInterval)
    }

    const scheduleNext = (delayMs: number) => {
      if (active) {
        timerId = setTimeout(() => {
          void check()
        }, delayMs)
      }
    }

    scheduleNext(pollIntervalMs)

    return () => {
      active = false
      if (timerId !== undefined) clearTimeout(timerId)
    }
  }, [
    backend,
    baseHeadSha,
    branch,
    enabled,
    entryPath,
    idleBackoffMs,
    pollIntervalMs,
    rateLimitRemaining,
  ])

  return {
    drift,
    clearDrift: () => setDrift(undefined),
  }
}
