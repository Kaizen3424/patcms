import * as Dialog from "@radix-ui/react-dialog"
import { useEffect, useId, useState } from "react"
import { ONBOARDING_COPY } from "../editor/copy"

export interface ProductTourDialogProps {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly onComplete?: () => void
}

interface TourStep {
  readonly title: string
  readonly body: string
  readonly badge: string
  readonly icon: string
}

const TOUR_STEPS: readonly TourStep[] = [
  {
    title: ONBOARDING_COPY.step1Title,
    body: ONBOARDING_COPY.step1Body,
    badge: "Writing",
    icon: "✍️",
  },
  {
    title: ONBOARDING_COPY.step2Title,
    body: ONBOARDING_COPY.step2Body,
    badge: "Safety",
    icon: "🛡️",
  },
  {
    title: ONBOARDING_COPY.step3Title,
    body: ONBOARDING_COPY.step3Body,
    badge: "Organisation",
    icon: "⚙️",
  },
  {
    title: ONBOARDING_COPY.step4Title,
    body: ONBOARDING_COPY.step4Body,
    badge: "Live Status",
    icon: "🟢",
  },
]

export function ProductTourDialog({ open, onOpenChange, onComplete }: ProductTourDialogProps) {
  const [stepIndex, setStepIndex] = useState(0)
  const titleId = useId()
  const descId = useId()

  useEffect(() => {
    if (open) setStepIndex(0)
  }, [open])

  const totalSteps = TOUR_STEPS.length
  const currentStep: TourStep = TOUR_STEPS[stepIndex] ?? (TOUR_STEPS[0] as unknown as TourStep)

  const handleNext = () => {
    if (stepIndex < totalSteps - 1) {
      setStepIndex((prev) => prev + 1)
    } else {
      onComplete?.()
      onOpenChange(false)
    }
  }

  const handleBack = () => {
    if (stepIndex > 0) {
      setStepIndex((prev) => prev - 1)
    }
  }

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowRight") {
      event.preventDefault()
      handleNext()
    } else if (event.key === "ArrowLeft") {
      event.preventDefault()
      handleBack()
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs transition-opacity animate-in fade-in" />
        <Dialog.Content
          aria-labelledby={titleId}
          aria-describedby={descId}
          onKeyDown={handleKeyDown}
          data-testid="product-tour-dialog"
          className="fixed top-1/2 left-1/2 z-50 w-full max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-card border border-border-soft bg-surface p-6 shadow-2xl transition-all focus:outline-none sm:p-8"
        >
          <div className="flex items-center justify-between border-b border-border-soft pb-4">
            <div className="flex items-center gap-2">
              <span className="rounded bg-surface-raised px-2 py-0.5 text-[11px] font-medium text-text-muted">
                {ONBOARDING_COPY.tourTitle}
              </span>
              <span aria-live="polite" className="text-xs text-text-muted">
                {ONBOARDING_COPY.stepOf
                  .replace("{current}", String(stepIndex + 1))
                  .replace("{total}", String(totalSteps))}
              </span>
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                className="rounded-lg p-1.5 text-text-muted transition-colors hover:bg-surface-raised hover:text-text-primary focus-visible:outline-2 focus-visible:outline-accent"
                aria-label={ONBOARDING_COPY.close}
                data-testid="close-tour-dialog"
              >
                ✕
              </button>
            </Dialog.Close>
          </div>

          <div className="py-8">
            <div className="mb-4 inline-flex size-12 items-center justify-center rounded-xl border border-accent/30 bg-accent-soft text-xl">
              <span aria-hidden="true">{currentStep.icon}</span>
            </div>
            <div className="flex items-center gap-2">
              <h2 id={titleId} className="text-lg font-semibold tracking-tight text-text-primary">
                {currentStep.title}
              </h2>
              <span className="rounded-full border border-border-soft bg-surface-raised px-2 py-0.5 text-[10px] font-medium text-text-muted">
                {currentStep.badge}
              </span>
            </div>
            <p id={descId} className="mt-3 text-sm leading-relaxed text-text-muted">
              {currentStep.body}
            </p>
          </div>

          <div className="flex items-center justify-between border-t border-border-soft pt-4">
            <div className="flex gap-1.5" aria-hidden="true">
              {TOUR_STEPS.map((step, idx) => (
                <span
                  key={step.title}
                  className={`size-2 rounded-full transition-all ${
                    idx === stepIndex ? "w-6 bg-accent" : "bg-border-strong"
                  }`}
                />
              ))}
            </div>

            <div className="flex items-center gap-2">
              {stepIndex > 0 ? (
                <button
                  type="button"
                  onClick={handleBack}
                  data-testid="tour-back-button"
                  className="rounded-lg px-3 py-1.5 text-xs font-medium text-text-muted transition-colors hover:bg-surface-raised hover:text-text-primary focus-visible:outline-2 focus-visible:outline-accent"
                >
                  {ONBOARDING_COPY.back}
                </button>
              ) : null}
              <button
                type="button"
                onClick={handleNext}
                data-testid="tour-next-button"
                className="rounded-lg bg-accent px-4 py-1.5 text-xs font-semibold text-[#111] transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-accent"
              >
                {stepIndex === totalSteps - 1 ? ONBOARDING_COPY.finish : ONBOARDING_COPY.next}
              </button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
