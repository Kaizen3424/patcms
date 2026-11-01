import { formatRelativeTime } from "patcms/advanced"
import { DRIFT_COPY, fillName } from "./copy"
import type { DriftInfo } from "./drift-monitor"

export interface DriftBannerProps {
  readonly drift?: DriftInfo
  readonly supportName: string
  readonly onOpenDrawer: () => void
}

export function DriftBanner({ drift, supportName, onOpenDrawer }: DriftBannerProps) {
  return (
    <div
      data-testid="drift-banner-container"
      className="h-6 flex items-center transition-all"
      aria-live="polite"
    >
      {drift ? (
        <div
          data-testid="drift-banner-active"
          className="flex w-full items-center justify-between rounded border border-accent/40 bg-accent-soft/60 px-2.5 py-0.5 text-xs text-text-primary"
        >
          <div className="flex items-center gap-1.5 truncate">
            <span aria-hidden="true" className="size-1.5 rounded-full bg-accent" />
            <span className="truncate">
              {fillName(DRIFT_COPY.bannerTitle, supportName).replace(
                "{time}",
                formatRelativeTime(drift.detectedAt),
              )}
            </span>
          </div>
          <button
            type="button"
            onClick={onOpenDrawer}
            data-testid="drift-what-changed-button"
            className="shrink-0 text-xs font-semibold text-accent underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-accent"
          >
            {DRIFT_COPY.whatChanged}
          </button>
        </div>
      ) : null}
    </div>
  )
}
