import * as Dialog from "@radix-ui/react-dialog"
import { formatRelativeTime } from "patcms/advanced"
import { useEffect, useId, useState } from "react"
import { fillName, JOURNAL_COPY } from "../editor/copy"
import { useJournalStore, useRuntime } from "../runtime/context"
import type { JournalRecord } from "../storage/idb-journal-store"

export interface JournalDrawerProps {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
}

export function JournalDrawer({ open, onOpenChange }: JournalDrawerProps) {
  const { support } = useRuntime()
  const journalStore = useJournalStore()
  const [entries, setEntries] = useState<readonly JournalRecord[]>([])
  const titleId = useId()
  const descriptionId = useId()

  useEffect(() => {
    let active = true
    const load = async () => {
      const records = await journalStore.list()
      if (active) setEntries(records)
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

  const myEntries = entries.filter((e) => e.author === "You" || !e.author)
  const partnerEntries = entries.filter((e) => e.author && e.author !== "You")

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs transition-opacity animate-in fade-in" />
        <Dialog.Content
          aria-labelledby={titleId}
          aria-describedby={descriptionId}
          data-testid="journal-drawer"
          className="fixed top-0 right-0 z-50 flex h-full w-full max-w-md flex-col border-l border-border-soft bg-surface p-6 shadow-2xl transition-transform focus:outline-none"
        >
          <div className="flex items-start justify-between border-b border-border-soft pb-4">
            <div>
              <Dialog.Title id={titleId} className="text-base font-semibold text-text-primary">
                {JOURNAL_COPY.title}
              </Dialog.Title>
              <Dialog.Description id={descriptionId} className="mt-1 text-xs text-text-muted">
                {JOURNAL_COPY.subtitle}
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                className="rounded-lg p-1.5 text-text-muted transition-colors hover:bg-surface-raised hover:text-text-primary focus-visible:outline-2 focus-visible:outline-accent"
                aria-label={JOURNAL_COPY.close}
                data-testid="close-journal-drawer"
              >
                ✕
              </button>
            </Dialog.Close>
          </div>

          <div className="flex-1 overflow-y-auto py-4 space-y-6">
            {/* My Changes Section */}
            <section aria-labelledby="journal-my-changes-heading">
              <h3
                id="journal-my-changes-heading"
                className="text-xs font-semibold uppercase tracking-wider text-accent"
              >
                {JOURNAL_COPY.myChanges}
              </h3>
              {myEntries.length === 0 ? (
                <p className="mt-3 text-xs text-text-muted">{JOURNAL_COPY.emptyMyChanges}</p>
              ) : (
                <ul className="mt-3 space-y-2">
                  {myEntries.map((record) => (
                    <li
                      key={record.id}
                      data-testid={`journal-entry-${record.commitSha.slice(0, 7)}`}
                      className="rounded-lg border border-border-soft bg-surface-raised p-3 text-xs"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium text-text-primary truncate">
                          {record.entryTitle}
                        </span>
                        <span className="shrink-0 rounded bg-surface px-1.5 py-0.5 text-[10px] text-text-muted">
                          {record.collectionName}
                        </span>
                      </div>
                      <div className="mt-2 flex items-center justify-between text-[11px] text-text-muted">
                        <span>{formatRelativeTime(record.publishedAt)}</span>
                        <span className="font-mono">{record.commitSha.slice(0, 7)}</span>
                      </div>
                      {record.publicUrl ? (
                        <div className="mt-2 pt-2 border-t border-border-soft/60">
                          <a
                            href={record.publicUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[11px] text-accent hover:underline"
                          >
                            {JOURNAL_COPY.seeOnSite} ↗
                          </a>
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* Partner Changes Section */}
            <section aria-labelledby="journal-partner-changes-heading">
              <h3
                id="journal-partner-changes-heading"
                className="text-xs font-semibold uppercase tracking-wider text-text-muted"
              >
                {fillName(JOURNAL_COPY.partnerChanges, support.name)}
              </h3>
              {partnerEntries.length === 0 ? (
                <p className="mt-3 text-xs text-text-muted">
                  {fillName(JOURNAL_COPY.emptyPartnerChanges, support.name)}
                </p>
              ) : (
                <ul className="mt-3 space-y-2">
                  {partnerEntries.map((record) => (
                    <li
                      key={record.id}
                      data-testid={`journal-partner-entry-${record.commitSha.slice(0, 7)}`}
                      className="rounded-lg border border-border-soft bg-surface-raised/60 p-3 text-xs"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium text-text-primary truncate">
                          {record.entryTitle}
                        </span>
                        <span className="shrink-0 rounded bg-surface px-1.5 py-0.5 text-[10px] text-text-muted">
                          {record.collectionName}
                        </span>
                      </div>
                      <div className="mt-2 flex items-center justify-between text-[11px] text-text-muted">
                        <span>
                          Saved by {record.author || support.name} ·{" "}
                          {formatRelativeTime(record.publishedAt)}
                        </span>
                        <span className="font-mono">{record.commitSha.slice(0, 7)}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
