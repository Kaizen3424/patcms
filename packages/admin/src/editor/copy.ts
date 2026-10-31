/**
 * Founder-facing copy deck (P2.6). This module owns every save/recovery string;
 * `status/copy.ts` owns the deploy-status strings (P2.8), and `copy.test.ts`
 * sweeps both decks with ONE banned-word scan (01-spec §6: no "build",
 * "commit", "deploy", "token", "slug", "repository", "draft", "someone",
 * "conflict").
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

/**
 * Post-publish advisory chips (P2.7 — ADR-0004 P2.7 pins). The master-plan
 * §5.2 wording used the banned "committed"; the deck says "saved" (superseding
 * note is pinned in the ADR). These lines NEVER gate a save.
 */
export const ADVISORY_COPY = {
  pausedTitle: "Your change is saved, but the site's update is paused by an older problem.",
  chipDetail: "{title}: {detail}",
  takeMeThere: "Take me there",
  copyMessage: "Copy message for {name}",
  copyBody: "{title}: {detail} ({path})",
  copied: "Copied",
  dismiss: "Dismiss",
  unknownTitle: "We could not check the rest of the site just now.",
  unknownDetail:
    "Your change is saved. Tell {name} if it does not appear live within a few minutes.",
} as const

/**
 * Conflict freeze region copy (P2.9 — ADR-0004 appendix).
 * "conflict" is banned — the surface says "this entry changed somewhere else",
 * "the other version".
 */
export const FREEZE_COPY = {
  title: "This entry changed somewhere else.",
  detail: "Decide which version to keep for each field before saving.",
  otherEditsKept: "Your other edits are kept.",
  theirsHeader: "The other version",
  mineHeader: "Your version",
  keepTheirs: "Keep the other version",
  keepMine: "Keep my version",
  startOver: "Start over from the latest version",
  degradedTitle: "This entry changed somewhere else.",
  degradedDetail:
    "Your words are safe on this device. Start over from the latest version to load the latest changes.",
  savedByHeader: "Saved by {name}",
  yourVersionHeader: "Your version (edited on this device)",
  keptYourField: "Kept your {field}",
  keptPartnerField: "Kept {name}'s {field}",
  copyDiscarded: "Copy discarded version",
  copiedDiscarded: "Discarded text copied to clipboard",
} as const

/** Bar buttons — same banned-word sweep as the status lines. */
export const ACTION_COPY = {
  save: "Save changes",
  saving: "Saving...",
  retry: "Try saving again",
  startOver: "Start over from the latest version",
  signOut: "Sign out",
} as const

/**
 * Failure card copy (P2.10 — INV-A02 classifier matrix).
 * Rendered docked above the SaveBar on non-quota failures and on entry read errors.
 * No banned words; "{name}" comes from config support.name.
 */
export const FAILURE_COPY: Readonly<Record<string, CopyLine>> = {
  AUTH_EXPIRED: {
    title: "Your access key needs checking.",
    detail: "Sign in again with your access key. Your changes stay safe on this device.",
  },
  SCOPE: {
    title: "This access key cannot update the site.",
    detail: "Ask {name} to give this access key permission to update files.",
  },
  RATE_LIMIT: {
    title: "The site is busy right now.",
    detail: "Saving will continue in a moment. You can keep editing.",
  },
  NOT_FOUND: {
    title: "The site files could not be reached.",
    detail: "The site files may have moved. Ask {name} to check the site connection.",
  },
  VALIDATION: {
    title: "The site files could not accept this change.",
    detail: "Your words are safe on this device. Ask {name} to check the entry format.",
  },
  NETWORK: {
    title: "Internet connection problem.",
    detail: "We could not reach the site. Check your internet connection and try again.",
  },
  TREE_TRUNCATED: {
    title: "The folder is too large to read safely.",
    detail: "Ask {name} to look at this folder before you save.",
  },
  UNKNOWN: {
    title: "Saving did not go through.",
    detail: "Your changes are still on this device. Try again, or ask {name} for help.",
  },
}

/** In-place re-auth modal copy (P2.10 — INV-A01). */
export const REAUTH_COPY = {
  title: "Your access key needs checking",
  detail: "Your changes are safe on this device. Enter your access key to continue saving.",
  readTitle: "Your access key needs checking to open this entry.",
  inputLabel: "Access key",
  inputPlaceholder: "Paste your access key here",
  showKey: "Show access key",
  hideKey: "Hide access key",
  remember: "Remember on this device",
  submit: "Check key and save",
  submitRead: "Check key",
  submitting: "Checking key...",
  cancel: "Keep editing",
  signOut: "Sign out",
  errorInvalid: "This access key could not be verified. Check the key and its permissions.",
  errorEmpty: "Please enter your access key.",
} as const

/** Rate limit reset countdown copy (P2.10 — INV-N01). */
export const RATE_COPY = {
  busyTitle: "The site is busy right now.",
  countdown: "Resuming in {seconds} seconds...",
  pausedTitle: "Saving is paused.",
  pausedDetail: "Your changes are kept on this device. Try saving again in a moment.",
  resumeNow: "Try saving now",
  announcementStart:
    "Saving is paused because the site is busy. Resuming in about {seconds} seconds.",
  announcementWarning: "Resuming in 10 seconds.",
  announcementResume: "Resuming now.",
} as const

/** Failure card actions and labels (P2.10). */
export const FAILURE_CARD_COPY = {
  reassurance: "Your changes are kept on this device.",
  retry: "Try saving again",
  checkKey: "Check access key",
  copyMessage: "Copy message for {name}",
  copied: "Copied to clipboard",
  technicalDetails: "Technical details for {name}",
  startOver: "Start over from the latest version",
} as const

/** Entry screen read failure actions (P2.10). */
export const READ_ERROR_COPY = {
  retry: "Try loading again",
  backToFolder: "Back to folder",
  copyMessage: "Copy message for {name}",
} as const

/** Web address lifecycle copy (P3.5). */
export const SLUG_COPY = {
  webAddress: "web address:",
  fixableUntilSave: "— still fixable until Save",
  changeInfo: "Need to change this?",
  closeInfo: "Close info",
  lockedExplanation:
    "This web address is already live. Changing it directly could break bookmarks or links from other websites. To keep your visitors happy, address changes are best handled with an automatic redirect.",
  copyNote: "Copy note for {name}",
  copied: "Copied note to clipboard!",
  collision:
    "An address with this name already exists. We recommend choosing a distinct name before saving.",
} as const

/** Template and new-entry flow copy (P3.7). */
export const TEMPLATE_COPY = {
  newEntry: "New entry",
  startFromBlank: "Start from blank",
  startFromTemplate: "Start from an existing item",
  nothingPublished: "Nothing published until you Save",
  creatingNew: "Creating new entry",
} as const

/** Behind-the-scenes drawer copy (P3.4). */
export const BEHIND_THE_SCENES_COPY = {
  title: "Behind the scenes — managed by {name}",
  description: "These settings work quietly behind the scenes to keep your website looking sharp.",
  notShown: "Not shown on your site right now",
} as const

/** Media library and image handling copy (P4.6). */
export const MEDIA_COPY = {
  title: "Media Library",
  searchPlaceholder: "Search images by name or path...",
  filterAll: "All",
  emptyState: "No images found.",
  emptySearch: "No images match your search.",
  uploadButton: "Upload image",
  uploadPrompt: "Drag & drop an image or browse",
  uploading: "Optimizing image...",
  retryUpload: "Retry upload",
  chooseFromLibrary: "Choose from library",
  detailsTitle: "Image Details",
  publicPath: "Public path",
  copyPath: "Copy path",
  copied: "Copied!",
  dimensions: "Dimensions",
  fileSize: "File size",
  usedIn: "Used in",
  noReferences: "Not used in any entries yet.",
  altPrefillPrefix: "Last used as:",
  replaceTitle: "Replace image file",
  replaceWarning:
    "Replacing an existing file keeps the same web address. Because public sites cache images, visitors may see the old image for up to 1 hour.",
  deleteButton: "Delete image",
  deleteWarning:
    "This will remove the image from the site. If it is used in any entries, it cannot be deleted until those references are removed.",
  budgetWarning:
    "Your media storage is reaching recommended limits. Ask {name} to archive older images to keep everything fast.",
} as const

/** Recently deleted / tombstone copy (P4.7). */
export const TRASH_COPY = {
  title: "Recently Deleted",
  subtitle:
    "Restoring moves the image back to its original location. Entries that previously used it will need to be re-saved if their fields were cleared.",
  emptyState: "No recently deleted images.",
  restoreButton: "Restore",
  restoring: "Restoring...",
  restored: "Restored!",
  collisionError: "Cannot restore: an image already exists at the original location.",
  deleteBlocked: "Cannot delete: this image is used in entries.",
  confirmDelete: "Move this image to Recently Deleted?",
} as const

/** Global search copy (P5.1). */
export const SEARCH_COPY = {
  placeholder: "Search titles, numbers, materials, or photo descriptions...",
  promptTitle: "Find anything on your site",
  promptDetail:
    "Search products, collections, and pages by title, price, material, or photo description...",
  emptyTitle: "No matches found",
  emptyDetail:
    'No entries match "{query}". Try searching whole-euro prices (e.g. 1450), materials, or title words.',
  offlineBadge: "Showing last-seen copy",
  shortcuts: "↑↓ to navigate · ↵ to open · esc to close",
} as const

/** Activity journal copy (P5.2). */
export const JOURNAL_COPY = {
  title: "Activity journal",
  subtitle: "Recent changes saved to this site.",
  myChanges: "My changes",
  partnerChanges: "Site updates by {name}",
  emptyMyChanges: "You have not saved any changes yet on this device.",
  emptyPartnerChanges: "No recent updates from {name}.",
  seeOnSite: "See on site",
  savedAt: "Saved {time}",
  close: "Close journal",
} as const

/** Ambient heartbeat copy (P5.2). */
export const HEARTBEAT_COPY = {
  liveTitle: "Site live",
  lastEditYours: "Site live · Last edit yours, {time}",
  lastEditPartner: "Site live · Last edit {name}, {time}",
  updating: "Site updating...",
  loginConnected: "Connected to site content",
  loginLastSeen: "Last connected {time}",
} as const

/** Onboarding consent pact and 60-second tour copy (P5.3). */
export const ONBOARDING_COPY = {
  pactTitle: "Welcome to your content studio",
  pactSentence1: "You are connected to this site's live content.",
  pactSentence2: "Changes you make only publish when you choose to save them.",
  pactSentence3: "Your edits are kept safe on this device while you work.",
  takeTour: "Take a 60-second tour",
  dismiss: "Dismiss",
  tourTitle: "How this studio works",
  stepOf: "Step {current} of {total}",
  close: "Close tour",
  next: "Next",
  back: "Back",
  finish: "Finish tour",
  step1Title: "Clear, simple fields",
  step1Body: "Every field is checked as you type, keeping everything clean and in order.",
  step2Title: "You are in control",
  step2Body:
    "Changes stay on your device until you choose to save. Nothing goes live without your say-so.",
  step3Title: "Special settings when needed",
  step3Body:
    "Advanced settings stay quietly tucked away behind the scenes so you can focus on writing.",
  step4Title: "Ambient confidence",
  step4Body: "A heartbeat indicator lets you know your public site is up to date.",
} as const

/** Background drift monitor copy (P5.4). */
export const DRIFT_COPY = {
  bannerTitle: "This page's files changed ({name}, {time})",
  whatChanged: "What changed?",
  drawerTitle: "Updates detected on the site",
  drawerSubtitle: "Saved by {name} · {time}",
  keepEditingTitle: "Keep editing",
  keepEditingBody:
    "Your changes remain safe on this device. When you save, any differences will be presented clearly before saving.",
  reloadLatest: "Reload latest version",
  reloadWarning: "Reloading will replace what is on this screen.",
  close: "Close updates panel",
} as const

/** Token expiry proactive and recovery copy (P5.7). */
export const EXPIRY_COPY = {
  renewChip: "Renew after {date}",
  renewNotice: "Access key renewal coming up after {date} — ask {name} for a fresh code",
  reauthPreserved:
    "Your access key needs checking. Your changes are kept safe on this device — enter a fresh access key to resume without losing anything.",
  partnerNoteButton: "Copy note for {name}",
  partnerNoteText:
    "Hi {name}, my studio access key for the website has expired. Could you generate a fresh access key for me?",
  copiedNote: "Note copied to clipboard",
  handoverTitle: "Access key renewal",
  handoverSubtitle: "Set when your access key was created and how long it lasts.",
  createdLabel: "Key created date",
  durationLabel: "Duration",
  saveSettings: "Save settings",
  settingsSaved: "Saved",
} as const

/** Studio diagnostics copy (P5.10). */
export const DIAGNOSTICS_COPY = {
  title: "Studio diagnostics",
  subtitle:
    "Technical details from this session. Access keys and personal emails are always hidden.",
  empty: "No diagnostics recorded in this session yet.",
  copyButton: "Copy diagnostics",
  copiedSuccess: "Diagnostics copied to clipboard. You can paste this to {name}.",
  close: "Close",
  systemLabel: "Studio information",
} as const

/** Substitutes `{name}` with the named human from `support.name`. */
export function fillName(template: string, name: string): string {
  return template.replaceAll("{name}", name)
}

/**
 * Generic placeholder fill for chip lines ({title}/{detail}/{count}). Built on
 * split/join, never String.replace — a value containing `$` patterns must be
 * inert (validator copy comes from repo content).
 */
export function fillLine(template: string, values: Readonly<Record<string, string>>): string {
  let result = template
  for (const [key, value] of Object.entries(values)) {
    result = result.split(`{${key}}`).join(value)
  }
  return result
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
  walk(FREEZE_COPY)
  walk(ACTION_COPY)
  walk(ADVISORY_COPY)
  walk(FAILURE_COPY)
  walk(REAUTH_COPY)
  walk(RATE_COPY)
  walk(FAILURE_CARD_COPY)
  walk(READ_ERROR_COPY)
  walk(SLUG_COPY)
  walk(TEMPLATE_COPY)
  walk(BEHIND_THE_SCENES_COPY)
  walk(MEDIA_COPY)
  walk(TRASH_COPY)
  walk(SEARCH_COPY)
  walk(JOURNAL_COPY)
  walk(HEARTBEAT_COPY)
  walk(ONBOARDING_COPY)
  walk(DRIFT_COPY)
  walk(EXPIRY_COPY)
  walk(DIAGNOSTICS_COPY)
  return strings
}
