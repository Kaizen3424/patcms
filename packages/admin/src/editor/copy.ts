/**
 * Founder-facing copy deck (P2.6). ONE module owns every save/recovery string
 * so the banned-word scan is a single sweep (01-spec §6: no "build", "commit",
 * "deploy", "token", "slug", "repository", "draft", "someone", "conflict").
 *
 * Rules encoded here:
 *  - the named human always comes from `support.name` via `{name}` — never
 *    "someone" (master-plan §7);
 *  - "access key" is the only word for the credential;
 *  - every line says what happened, what is safe, and what to do next.
 */

export type SaveBarStatus =
  | "clean"
  | "dirty"
  | "saving"
  | "saved"
  | "noop"
  | "conflict"
  | "busy"
  | "paused"
  | "authExpired"
  | "failed"
  | "leaseLost"

export interface CopyLine {
  readonly title: string
  readonly detail?: string
}

/** The 11 sticky-bar states (P2.6 scope). */
export const SAVE_BAR_COPY: Readonly<Record<SaveBarStatus, CopyLine>> = {
  clean: {
    title: "Everything here is saved.",
    detail: "The site shows the latest version of this entry.",
  },
  dirty: { title: "You have unsaved changes." },
  saving: {
    title: "Saving your changes...",
    detail: "Keep this tab open until it finishes.",
  },
  saved: {
    title: "Saved.",
    detail: "The site will show your latest change.",
  },
  noop: {
    title: "Nothing to save.",
    detail: "This entry already matches the site.",
  },
  conflict: {
    title: "This entry changed somewhere else.",
    detail:
      "Your words are safe on this device. Ask {name} to look at both versions before you save.",
  },
  busy: {
    title: "The site is busy right now.",
    detail: "Saving will continue in a moment. You can keep editing.",
  },
  paused: {
    title: "Saving is paused.",
    detail: "Your changes are kept on this device. Try saving again in a moment.",
  },
  authExpired: {
    title: "Your access key needs checking.",
    detail: "Sign out, then sign in again. Your changes stay on this device.",
  },
  failed: {
    title: "Saving did not go through.",
    detail: "Your changes are still on this device. Try again, or ask {name} for help.",
  },
  leaseLost: {
    title: "This entry is open in another tab.",
    detail: "Changes made here stay on this device. Check again once the other tab is closed.",
  },
}

/** Recovery surfaces P2.6 ships (boot offer, start-over, retry, discard) + the P2.7 lease re-check. */ export const RECOVERY_COPY =
  {
    restoreFound: {
      title: "We found unsaved changes on this device.",
      detail: "They were never published. Restore them here?",
      confirm: "Restore changes",
      dismiss: "Keep them for later",
    },
    startOver: {
      label: "Start over from the latest version",
      detail: "Your unsaved changes on this device will be removed.",
    },
    discardLocal: {
      label: "Discard the changes kept on this device",
      detail: "They will not be published. This cannot be undone here.",
    },
    retrySave: {
      label: "Try saving again",
      detail: "Nothing is lost by trying again.",
    },
    recheck: {
      label: "Check again",
      detail: "Nothing is lost by checking. Saving unlocks once your other tab is closed.",
    },
  } as const

/** Validation gate — the save button refused locally (no network attempt). */
export const VALIDATION_COPY = {
  blockedTitle: "Some fields need attention.",
  blockedDetail: "Fix the highlighted fields, then save again.",
} as const

/** Bar buttons — same banned-word sweep as the status lines. */
export const ACTION_COPY = {
  save: "Save changes",
  saving: "Saving...",
  retry: "Try saving again",
  startOver: "Start over from the latest version",
  signOut: "Sign out",
} as const

/** Substitutes `{name}` with the named human from `support.name`. */
export function fillName(template: string, name: string): string {
  return template.replaceAll("{name}", name)
}

/** Applies `fillName` to every field of a copy line (detail may carry `{name}`). */
export function personalize(line: CopyLine, name: string): CopyLine {
  return {
    title: fillName(line.title, name),
    ...(line.detail === undefined ? {} : { detail: fillName(line.detail, name) }),
  }
}

/**
 * Every user-visible string in this module — the banned-word test walks this
 * (recursively derived so a new line cannot dodge the sweep).
 */
export function allCopyStrings(): readonly string[] {
  const strings: string[] = []
  const walk = (value: unknown): void => {
    if (typeof value === "string") {
      strings.push(value)
      return
    }
    if (typeof value === "object" && value !== null) {
      for (const child of Object.values(value)) walk(child)
    }
  }
  walk(SAVE_BAR_COPY)
  walk(RECOVERY_COPY)
  walk(VALIDATION_COPY)
  walk(ACTION_COPY)
  return strings
}
