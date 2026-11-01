import * as Dialog from "@radix-ui/react-dialog"
import { formatRelativeTime } from "patcms/advanced"
import { useId } from "react"
import { DRIFT_COPY, fillName } from "./copy"
import type { DriftInfo } from "./drift-monitor"

export interface DriftDrawerProps {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly drift?: DriftInfo
  readonly supportName: string
  readonly isDirty: boolean
  readonly onReload: () => void
}

export function DriftDrawer({
  open,
  onOpenChange,
  drift,
  supportName,
  isDirty,
  onReload,
}: DriftDrawerProps) {
  const titleId = useId()
  const descId = useId()

  if (!drift) return null

  const handleReload = () => {
    onReload()
    onOpenChange(false)
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs transition-opacity animate-in fade-in" />
        <Dialog.Content
          aria-labelledby={titleId}
          aria-describedby={descId}
          data-testid="drift-drawer"
          className="fixed top-0 right-0 z-50 flex h-full w-full max-w-md flex-col border-l border-border-soft bg-surface p-6 shadow-2xl transition-transform focus:outline-none"
        >
          <div className="flex items-start justify-between border-b border-border-soft pb-4">
            <div>
              <Dialog.Title id={titleId} className="text-base font-semibold text-text-primary">
                {DRIFT_COPY.drawerTitle}
              </Dialog.Title>
              <Dialog.Description id={descId} className="mt-1 text-xs text-text-muted">
                {fillName(DRIFT_COPY.drawerSubtitle, supportName).replace(
                  "{time}",
                  formatRelativeTime(drift.detectedAt),
                )}
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                className="rounded-lg p-1.5 text-text-muted transition-colors hover:bg-surface-raised hover:text-text-primary focus-visible:outline-2 focus-visible:outline-accent"
                aria-label={DRIFT_COPY.close}
                data-testid="close-drift-drawer"
              >
                ✕
              </button>
            </Dialog.Close>
          </div>

          <div className="flex-1 overflow-y-auto py-6 space-y-6">
            <div className="rounded-lg border border-border-soft bg-surface-raised p-4 space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-accent">
                {DRIFT_COPY.keepEditingTitle}
              </h3>
              <p className="text-xs leading-relaxed text-text-muted">
                {DRIFT_COPY.keepEditingBody}
              </p>
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                data-testid="keep-editing-button"
                className="mt-2 w-full rounded-lg bg-surface px-3 py-2 text-xs font-medium text-text-primary border border-border-soft transition-colors hover:bg-surface-raised hover:border-border-strong focus-visible:outline-2 focus-visible:outline-accent"
              >
                {DRIFT_COPY.keepEditingTitle}
              </button>
            </div>

            <div className="rounded-lg border border-border-soft bg-surface-raised p-4 space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-text-muted">
                {DRIFT_COPY.reloadLatest}
              </h3>
              {isDirty ? (
                <p className="text-xs leading-relaxed text-accent">{DRIFT_COPY.reloadWarning}</p>
              ) : null}
              <button
                type="button"
                onClick={handleReload}
                data-testid="reload-latest-button"
                className="mt-2 w-full rounded-lg border border-border-soft bg-surface px-3 py-2 text-xs font-medium text-text-primary transition-colors hover:bg-surface-raised hover:border-border-strong focus-visible:outline-2 focus-visible:outline-accent"
              >
                {DRIFT_COPY.reloadLatest}
              </button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
