/**
 * Entry editor v0 (P2.6) — one screen, one serializer, one machine.
 *
 * Laws this component enforces (ADR-0004 P2.6 pins):
 *  - the ONLY bytes it writes come from `composeFormBytes` → `composeEntryDocument`;
 *  - the draft is written pre-network by the coordinator and by a debounce here
 *    (crash protection), never as an autosave of content;
 *  - a boot replay only ADJUDICATES: nothing touches the remote until the
 *    founder confirms, and a conflict offers "start over", never a silent write;
 *  - the machine is reset on mount and after every published verdict, so a
 *    second save in the same session is possible;
 *  - edits typed while a save is committing survive and re-dirty the form.
 */
import type { FieldDescriptor, ParseIssue, SaveDraftPayload, SaveMachineState } from "@mycms/core"
import {
  adjudicateDraft,
  DEFAULT_LEASE_HEARTBEAT_MS,
  decodeUtf8,
  encodeUtf8,
  parseJsonDocument,
  SaveInFlightError,
  validateEntryForSave,
} from "@mycms/core"
import type { ReactNode } from "react"
import { useEffect, useRef, useState } from "react"
import { useRuntime } from "../runtime/context"
import type { EntryIndex, IndexedEntry } from "../runtime/entry-index"
import { defaultWidgetRegistry, EDITABLE_FIELD_TYPES } from "../widgets"
import { personalize, RECOVERY_COPY, SAVE_BAR_COPY } from "./copy"
import type { EntryFormState } from "./form-value"
import {
  composeFormBytes,
  createEntryForm,
  isFormDirty,
  withBase,
  withFieldTree,
  withFieldValue,
  withLatestVersion,
  withPublishedBase,
} from "./form-value"
import { SaveBar } from "./save-bar"
import { describeSaveBar } from "./save-bar-model"

/** Draft debounce — crash protection only; saving is always explicit. */
const DRAFT_WRITE_DELAY_MS = 800

interface BootOffer {
  readonly kind: "offer"
  readonly headSha: string
  readonly storedTree: Readonly<Record<string, unknown>>
  readonly mergedRaw?: string
}

interface BootConflict {
  readonly kind: "conflict"
  readonly headSha: string
}

export interface EntryEditorProps {
  readonly entry: IndexedEntry
  /** Snapshot head commit — the base the form loads against. */
  readonly headSha: string
  /** Whole-repo index for relation existence checks (strict save gate). */
  readonly index: EntryIndex | undefined
  /** Read-only renderer for list/object/image/relation/slug/hidden fields. */
  readonly renderReadOnly: (field: FieldDescriptor, value: unknown) => ReactNode
}

export function EntryEditor({ entry, headSha, index, renderReadOnly }: EntryEditorProps) {
  const { backend, repository, drafts, coordinator, lease, support, signOut } = useRuntime()
  const draftKey = `${repository.repo}/${entry.collectionName}/${entry.slug}`

  const [form, setForm] = useState<EntryFormState | null>(() => {
    const created = createEntryForm(entry, headSha)
    return created.ok ? created.form : null
  })
  const formRef = useRef(form)
  const [machine, setMachine] = useState<SaveMachineState | undefined>(undefined)
  const [boot, setBoot] = useState<BootOffer | BootConflict | undefined>(undefined)
  const [validationIssues, setValidationIssues] = useState<readonly ParseIssue[]>([])
  const [justSaved, setJustSaved] = useState(false)
  const [justNoop, setJustNoop] = useState(false)
  const [leaseLost, setLeaseLost] = useState(false)
  const mounted = useRef(true)
  const saving = useRef(false)
  const initialized = useRef(false)

  const updateForm = (next: EntryFormState | null): void => {
    formRef.current = next
    setForm(next)
  }

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  // Machine base coordinate: one reset per mount (a remount for another entry
  // is a different component instance thanks to the screen's `key`).
  useEffect(() => {
    if (coordinator === undefined || initialized.current) return
    initialized.current = true
    coordinator.reset(draftKey, formRef.current?.baseSha ?? headSha)
  }, [coordinator, draftKey, headSha])

  useEffect(() => {
    if (coordinator === undefined) return
    setMachine(coordinator.state(draftKey))
    return coordinator.subscribe((snapshot) => setMachine(snapshot.states.get(draftKey)))
  }, [coordinator, draftKey])

  // Cross-tab lease: UX serialization only — the CAS stays the correctness
  // mechanism (ADR-0004). Losing it is a notice, never a silent save block.
  // While lost, Save stays disabled and the notice clears ONLY after a real
  // re-acquire wins (manual re-check or an observed foreign release — P2.7
  // pins; never a timed auto-acquire, which could steal from a live editor).
  useEffect(() => {
    if (lease === undefined) return
    let active = true
    const reacquire = (): void => {
      void lease.acquire(draftKey).then((held) => {
        if (active) setLeaseLost(!held)
      })
    }
    reacquire()
    const unsubscribeLost = lease.onLost(draftKey, () => {
      if (active) setLeaseLost(true)
    })
    const unsubscribeFreed = lease.onFreed(draftKey, () => {
      if (active) reacquire()
    })
    const timer = setInterval(() => {
      void lease.renew(draftKey).then((held) => {
        if (active && !held) setLeaseLost(true)
      })
    }, DEFAULT_LEASE_HEARTBEAT_MS)
    return () => {
      active = false
      unsubscribeLost()
      unsubscribeFreed()
      clearInterval(timer)
      void lease.release(draftKey)
    }
  }, [lease, draftKey])

  // Boot adjudication: NEVER writes. discard → delete; offer → confirm banner;
  // conflict → honest banner + start over. Uncertainty stays quiet.
  useEffect(() => {
    if (backend === undefined) return
    let active = true
    const run = async (): Promise<void> => {
      const record = await drafts.get<SaveDraftPayload>(draftKey)
      if (!active || record === undefined) return
      const adjudication = await adjudicateDraft({
        backend,
        branch: repository.branch,
        record,
      })
      if (!active) return
      if (adjudication.kind === "discard") {
        await drafts.delete(draftKey)
        return
      }
      if (adjudication.kind === "conflict") {
        setBoot({ kind: "conflict", headSha: adjudication.headSha })
        return
      }
      const stored = asRecord(record.value.formValue)
      if (stored === undefined && adjudication.mergedRaw === undefined) {
        // Nothing restorable was stored — the honest surface is the freeze
        // message, not an "offer" that would blank the entry.
        setBoot({ kind: "conflict", headSha: adjudication.headSha })
        return
      }
      setBoot({
        kind: "offer",
        headSha: adjudication.headSha,
        storedTree: stored ?? {},
        ...(adjudication.mergedRaw === undefined ? {} : { mergedRaw: adjudication.mergedRaw }),
      })
    }
    void run().catch(() => undefined)
    return () => {
      active = false
    }
  }, [backend, repository.branch, drafts, draftKey])

  // Debounced crash record: value only, no network (ADR-0002 orthogonality).
  useEffect(() => {
    if (form === null) return
    const timer = setTimeout(() => {
      if (!isFormDirty(form)) {
        void drafts.delete(draftKey)
        return
      }
      void drafts.put<SaveDraftPayload>({
        key: draftKey,
        savedAt: new Date().toISOString(),
        value: draftPayload(entry, form),
      })
    }, DRAFT_WRITE_DELAY_MS)
    return () => clearTimeout(timer)
  }, [form, drafts, draftKey, entry])

  // Teardown: best-effort flush, abandon a parked save honestly, free the slot.
  useEffect(() => {
    return () => {
      const current = formRef.current
      if (current !== null) {
        if (isFormDirty(current)) {
          void drafts.put<SaveDraftPayload>({
            key: draftKey,
            savedAt: new Date().toISOString(),
            value: draftPayload(entry, current),
          })
        }
      }
      coordinator?.cancel(draftKey)
    }
  }, [coordinator, drafts, draftKey, entry])

  const handleChange = (fieldName: string, value: unknown): void => {
    const current = formRef.current
    if (current === null) return
    const next = withFieldValue(current, fieldName, value)
    updateForm(next)
    setValidationIssues([])
    setJustSaved(false)
    setJustNoop(false)
    if (isFormDirty(next)) coordinator?.markDirty(draftKey, next.baseSha)
  }

  const save = async (): Promise<void> => {
    const current = formRef.current
    if (current === null || coordinator === undefined) return
    if (current.dirtyPaths.length === 0 || saving.current) return
    saving.current = true
    try {
      const bytes = composeFormBytes(current, entry.fields)
      const validation = await validateEntryForSave({
        fields: entry.fields,
        raw: current.formValue,
        filePath: entry.path,
        media: entry.media,
        ...(index === undefined ? {} : { services: { hasEntry: hasEntryIn(index) } }),
      })
      if (!validation.ok) {
        if (!mounted.current) return
        setValidationIssues(validation.issues.filter((issue) => issue.severity === "error"))
        return
      }
      setValidationIssues([])

      const verdict = await coordinator.save({
        draftKey,
        changes: { updates: [{ path: entry.path, bytes: encodeUtf8(bytes) }] },
        baseSha: current.baseSha,
        draft: draftPayload(entry, current),
      })
      if (!mounted.current) return

      if (verdict.kind === "published") {
        // New base = the commit the ref was OBSERVED carrying + the bytes we
        // composed. Never a re-read; edits made during the save stay dirty.
        const latest = formRef.current
        if (latest !== null) {
          updateForm(withPublishedBase(latest, { commitSha: verdict.commitSha, raw: bytes }))
        }
        coordinator.reset(draftKey, verdict.commitSha)
        setJustSaved(true)
        setJustNoop(false)
      } else if (verdict.kind === "noop") {
        coordinator.reset(draftKey, current.baseSha)
        setJustSaved(true)
        setJustNoop(true)
      } else {
        // conflict | failed: the bar reads the machine; drafts stay on device.
        setJustSaved(false)
      }
    } catch (error) {
      if (!(error instanceof SaveInFlightError)) throw error
    } finally {
      saving.current = false
    }
  }

  const retry = (): void => {
    const current = formRef.current
    if (current === null || coordinator === undefined) return
    if (machine?.phase === "paused") {
      // The pending promise from the parked attempt resumes and settles.
      coordinator.resume(draftKey)
      return
    }
    coordinator.reset(draftKey, current.baseSha)
    void save()
  }

  const startOver = async (): Promise<void> => {
    if (backend === undefined) return
    const ref = await backend.getRef(repository.branch)
    const file = await backend.readFile(repository.branch, entry.path, "")
    if (file.kind !== "file") return
    const headRaw = decodeUtf8(file.file.bytes)
    const current = formRef.current
    if (current !== null) {
      updateForm(
        withLatestVersion(withBase(current, { baseSha: ref.object.sha, baseRaw: headRaw })),
      )
    }
    coordinator?.reset(draftKey, ref.object.sha)
    await drafts.delete(draftKey)
    if (!mounted.current) return
    setBoot(undefined)
    setValidationIssues([])
    setJustSaved(false)
    setJustNoop(false)
  }

  const restore = async (): Promise<void> => {
    if (boot?.kind !== "offer" || backend === undefined) return
    const file = await backend.readFile(repository.branch, entry.path, "")
    const current = formRef.current
    if (file.kind !== "file" || current === null) return
    const headRaw = decodeUtf8(file.file.bytes)
    const merged = boot.mergedRaw === undefined ? undefined : parseJsonDocument(boot.mergedRaw)
    const tree = merged?.ok === true ? asRecord(merged.document.value) : undefined
    updateForm(
      withFieldTree(
        withBase(current, { baseSha: boot.headSha, baseRaw: headRaw }),
        tree ?? boot.storedTree,
      ),
    )
    coordinator?.reset(draftKey, boot.headSha)
    setBoot(undefined)
  }

  const dismissOffer = (): void => {
    // Keep the crash record: "later" means later, not deleted.
    setBoot(undefined)
  }

  /** Manual lease re-check (ADR-0004 P2.7): clears the notice iff we truly win. */
  const recheckLease = (): void => {
    if (lease === undefined) return
    void lease.acquire(draftKey).then((held) => {
      if (mounted.current && held) setLeaseLost(false)
    })
  }

  const model = describeSaveBar({
    state: machine,
    dirty: form !== null && isFormDirty(form),
    justSaved,
    justNoop,
    leaseLost,
  })

  if (form === null) {
    return (
      <div className="mt-6">
        <p className="rounded-card border border-danger/40 bg-danger/10 p-4 text-sm text-text-primary">
          This entry's file could not be read, so it stays read-only. Ask {support.name} to look at
          it in the site files.
        </p>
        <div className="mt-6 grid gap-x-8 gap-y-6 sm:grid-cols-2">
          {entry.fields
            .filter((field) => field.type !== "divider" && field.type !== "hidden")
            .map((field) => (
              <div
                key={field.name}
                className={field.width === "half" ? "sm:col-span-1" : "sm:col-span-2"}
              >
                <p className="text-xs font-medium uppercase tracking-[0.1em] text-text-muted">
                  {field.label}
                </p>
                <div className="mt-1.5 text-sm leading-6 text-text-primary">
                  {renderReadOnly(field, undefined)}
                </div>
              </div>
            ))}
        </div>
      </div>
    )
  }

  return (
    <div>
      {boot === undefined ? null : (
        <BootBanner
          boot={boot}
          supportName={support.name}
          onRestore={() => void restore()}
          onDismiss={dismissOffer}
          onStartOver={() => void startOver()}
        />
      )}

      {validationIssues.length === 0 ? null : (
        <div
          role="alert"
          className="mt-6 rounded-card border border-danger/40 bg-danger/10 p-4 text-sm"
        >
          <p className="font-semibold">This entry cannot be saved yet.</p>
          <ul className="mt-2 list-inside list-disc space-y-1 text-xs text-text-muted">
            {validationIssues.map((issue, position) => (
              <li key={`${issue.path}-${issue.code}-${position}`}>
                <span className="font-mono text-text-primary">{issue.path || "entry"}</span>{" "}
                {issue.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-6 grid gap-x-8 gap-y-6 sm:grid-cols-2">
        {entry.fields
          .filter((field) => field.type !== "divider" && field.type !== "hidden")
          .map((field) => {
            const binding = EDITABLE_FIELD_TYPES.has(field.type)
              ? defaultWidgetRegistry.get(field.type)
              : undefined
            const error = validationIssues.find((issue) => issue.path === field.name)?.message
            return (
              <div
                key={field.name}
                className={field.width === "half" ? "sm:col-span-1" : "sm:col-span-2"}
              >
                {binding === undefined ? (
                  <>
                    <p className="text-xs font-medium uppercase tracking-[0.1em] text-text-muted">
                      {field.label}
                    </p>
                    <div className="mt-1.5 text-sm leading-6 text-text-primary">
                      {renderReadOnly(field, form.formValue[field.name])}
                    </div>
                  </>
                ) : (
                  <binding.Component
                    value={form.formValue[field.name]}
                    onChange={(value) => handleChange(field.name, value)}
                    error={error}
                    fieldConfig={field}
                  />
                )}
              </div>
            )
          })}
      </div>

      <SaveBar
        model={model}
        supportName={support.name}
        validationBlocked={validationIssues.length > 0}
        onSave={() => void save()}
        onRetry={retry}
        onStartOver={() => void startOver()}
        onRecheck={recheckLease}
        onSignOut={() => void signOut()}
      />
    </div>
  )
}

function BootBanner({
  boot,
  supportName,
  onRestore,
  onDismiss,
  onStartOver,
}: {
  readonly boot: BootOffer | BootConflict
  readonly supportName: string
  readonly onRestore: () => void
  readonly onDismiss: () => void
  readonly onStartOver: () => void
}) {
  if (boot.kind === "offer") {
    return (
      <section
        role="status"
        data-testid="boot-offer"
        className="mt-6 rounded-card border border-accent/40 bg-accent-soft p-4"
      >
        <p className="text-sm font-semibold">{RECOVERY_COPY.restoreFound.title}</p>
        <p className="mt-1 text-xs leading-5 text-text-muted">
          {RECOVERY_COPY.restoreFound.detail}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-[#111]"
            onClick={onRestore}
          >
            {RECOVERY_COPY.restoreFound.confirm}
          </button>
          <button
            type="button"
            className="rounded-lg border border-border-strong bg-surface px-3 py-1.5 text-xs font-medium"
            onClick={onDismiss}
          >
            {RECOVERY_COPY.restoreFound.dismiss}
          </button>
        </div>
      </section>
    )
  }
  return (
    <section
      role="status"
      data-testid="boot-conflict"
      className="mt-6 rounded-card border border-danger/40 bg-danger/10 p-4"
    >
      <p className="text-sm font-semibold">{SAVE_BAR_COPY.conflict.title}</p>
      <p className="mt-1 text-xs leading-5 text-text-muted">
        {personalize(SAVE_BAR_COPY.conflict, supportName).detail}
      </p>
      <button
        type="button"
        className="mt-3 rounded-lg border border-border-strong bg-surface px-3 py-1.5 text-xs font-medium"
        onClick={onStartOver}
      >
        {RECOVERY_COPY.startOver.label}
      </button>
    </section>
  )
}

function draftPayload(entry: IndexedEntry, form: EntryFormState): SaveDraftPayload {
  return {
    filePath: entry.path,
    baseSha: form.baseSha,
    baseRaw: form.baseRaw,
    formValue: form.formValue,
  }
}

function hasEntryIn(index: EntryIndex) {
  return (collection: string, value: string): boolean =>
    index.bySlug.get(collection)?.has(value) === true
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}
