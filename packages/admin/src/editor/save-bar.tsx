/**
 * Sticky save bar (P2.6) — presentational only. The status, copy and enabled
 * buttons all come from `save-bar-model` + the copy deck; this component owns
 * no save logic and never talks to the transport.
 */
import { ACTION_COPY, personalize, RECOVERY_COPY, SAVE_BAR_COPY, VALIDATION_COPY } from "./copy"
import type { SaveBarModel, SaveBarTone } from "./save-bar-model"

const TONE_CLASS: Readonly<Record<SaveBarTone, string>> = {
  neutral: "border-border-soft bg-surface",
  positive: "border-success/40 bg-success/10",
  warning: "border-accent/40 bg-accent-soft",
  danger: "border-danger/40 bg-danger/10",
}

const SECONDARY_BUTTON =
  "rounded-lg border border-border-strong bg-surface px-3 py-2 text-xs font-medium text-text-primary outline-none transition-colors hover:border-accent/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-40"
const PRIMARY_BUTTON =
  "rounded-lg bg-accent px-4 py-2 text-xs font-semibold text-[#111] outline-none transition-opacity focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-40"

export interface SaveBarProps {
  readonly model: SaveBarModel
  readonly supportName: string
  /** Local validation refused the save — overrides the title honestly. */
  readonly validationBlocked: boolean
  readonly onSave: () => void
  readonly onRetry: () => void
  readonly onStartOver: () => void
  readonly onSignOut: () => void
}

export function SaveBar({
  model,
  supportName,
  validationBlocked,
  onSave,
  onRetry,
  onStartOver,
  onSignOut,
}: SaveBarProps) {
  const base = personalize(SAVE_BAR_COPY[model.status], supportName)
  const title = validationBlocked ? VALIDATION_COPY.blockedTitle : base.title
  const detail = validationBlocked ? VALIDATION_COPY.blockedDetail : base.detail

  return (
    <section
      aria-label="Save status"
      data-testid="save-bar"
      data-status={model.status}
      className="sticky bottom-0 z-20 mt-10"
    >
      <div
        className={`rounded-t-card border-x border-t p-3 backdrop-blur sm:p-4 ${TONE_CLASS[model.tone]}`}
      >
        <div className="mx-auto flex max-w-4xl flex-wrap items-center gap-x-4 gap-y-3">
          <div className="min-w-0 flex-1">
            <p role="status" aria-live="polite" className="text-sm font-semibold tracking-tight">
              {title}
            </p>
            {detail === undefined ? null : (
              <p className="mt-0.5 text-xs leading-5 text-text-muted">{detail}</p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {model.canRetry ? (
              <button type="button" className={SECONDARY_BUTTON} onClick={onRetry}>
                {ACTION_COPY.retry}
              </button>
            ) : null}
            {model.canStartOver ? (
              <button
                type="button"
                className={SECONDARY_BUTTON}
                onClick={onStartOver}
                title={RECOVERY_COPY.startOver.detail}
              >
                {RECOVERY_COPY.startOver.label}
              </button>
            ) : null}
            {model.status === "authExpired" ? (
              <button type="button" className={SECONDARY_BUTTON} onClick={onSignOut}>
                {ACTION_COPY.signOut}
              </button>
            ) : null}
            <button
              type="button"
              className={PRIMARY_BUTTON}
              onClick={onSave}
              disabled={!model.canSave || model.busy || validationBlocked}
            >
              {model.busy ? ACTION_COPY.saving : ACTION_COPY.save}
            </button>
          </div>
        </div>
      </div>
    </section>
  )
}
