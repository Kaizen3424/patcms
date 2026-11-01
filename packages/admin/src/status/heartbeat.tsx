import { formatRelativeTime } from "patcms/advanced"
import { useEffect, useState } from "react"
import { fillName, HEARTBEAT_COPY } from "../editor/copy"
import { useJournalStore, useRuntimeSafe } from "../runtime/context"
import type { JournalRecord } from "../storage/idb-journal-store"
import { useSiteStatus } from "./provider"

export function TopBarHeartbeat({ onOpenJournal }: { readonly onOpenJournal?: () => void }) {
  const runtime = useRuntimeSafe()
  const siteStatus = useSiteStatus()
  const journalStore = useJournalStore()
  const [latestRecord, setLatestRecord] = useState<JournalRecord | undefined>(undefined)

  useEffect(() => {
    let active = true
    const load = async () => {
      const records = await journalStore.list({ limit: 1 })
      if (active) setLatestRecord(records[0])
    }
    void load()
    const unsubscribe = journalStore.subscribe(() => {
      void load()
    })
    return () => {
      active = false
      unsubscribe()
    }
  }, [journalStore])

  if (!runtime) return null

  const supportName = runtime.support.name
  const isUpdating = siteStatus.snapshot?.kind === "building"

  let label: string = HEARTBEAT_COPY.liveTitle
  if (isUpdating) {
    label = HEARTBEAT_COPY.updating
  } else if (latestRecord) {
    const isYours = latestRecord.author === "You" || !latestRecord.author
    const timeStr = formatRelativeTime(latestRecord.publishedAt)
    if (isYours) {
      label = fillName(HEARTBEAT_COPY.lastEditYours, supportName).replace("{time}", timeStr)
    } else {
      label = fillName(HEARTBEAT_COPY.lastEditPartner, latestRecord.author || supportName).replace(
        "{time}",
        timeStr,
      )
    }
  }

  return (
    <button
      type="button"
      onClick={onOpenJournal}
      data-testid="top-bar-heartbeat"
      className="flex items-center gap-2 rounded-full border border-border-soft bg-surface-raised/40 px-3 py-1 text-xs text-text-muted transition-colors hover:border-border-strong hover:text-text-primary focus-visible:outline-2 focus-visible:outline-accent"
      title="View activity journal"
    >
      <span
        aria-hidden="true"
        className={`size-2 rounded-full ${isUpdating ? "bg-accent animate-pulse" : "bg-success"}`}
      />
      <span className="font-medium">{label}</span>
    </button>
  )
}

export function LoginHeartbeat({ lastConnected }: { readonly lastConnected?: string }) {
  const timeStr = lastConnected ? formatRelativeTime(lastConnected) : undefined

  return (
    <div
      data-testid="login-heartbeat"
      className="mt-4 flex items-center justify-center gap-2 text-xs text-text-muted"
    >
      <span aria-hidden="true" className="size-1.5 rounded-full bg-success" />
      <span>
        {timeStr
          ? fillName(HEARTBEAT_COPY.loginLastSeen, "").replace("{time}", timeStr)
          : HEARTBEAT_COPY.loginConnected}
      </span>
    </div>
  )
}
