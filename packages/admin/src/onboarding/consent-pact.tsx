import { ONBOARDING_COPY } from "../editor/copy"

export interface ConsentPactCardProps {
  readonly onTakeTour: () => void
  readonly onDismiss: () => void
}

export function ConsentPactCard({ onTakeTour, onDismiss }: ConsentPactCardProps) {
  return (
    <section
      aria-label={ONBOARDING_COPY.pactTitle}
      data-testid="consent-pact-card"
      className="relative mb-6 rounded-card border border-border-soft bg-surface p-5 shadow-sm transition-all sm:p-6"
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1.5 max-w-2xl">
          <h2 className="text-sm font-semibold tracking-tight text-text-primary">
            {ONBOARDING_COPY.pactTitle}
          </h2>
          <p className="text-xs leading-relaxed text-text-muted">
            <span className="font-medium text-text-primary">{ONBOARDING_COPY.pactSentence1}</span>{" "}
            <span>{ONBOARDING_COPY.pactSentence2}</span>{" "}
            <span>{ONBOARDING_COPY.pactSentence3}</span>
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2 pt-1 sm:pt-0">
          <button
            type="button"
            onClick={onTakeTour}
            data-testid="take-tour-button"
            className="rounded-lg bg-surface-raised px-3 py-1.5 text-xs font-medium text-text-primary transition-colors hover:bg-surface-raised/80 hover:text-accent focus-visible:outline-2 focus-visible:outline-accent"
          >
            {ONBOARDING_COPY.takeTour}
          </button>
          <button
            type="button"
            onClick={onDismiss}
            data-testid="dismiss-pact-button"
            className="rounded-lg px-2.5 py-1.5 text-xs text-text-muted transition-colors hover:text-text-primary focus-visible:outline-2 focus-visible:outline-accent"
          >
            {ONBOARDING_COPY.dismiss}
          </button>
        </div>
      </div>
    </section>
  )
}
