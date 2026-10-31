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
import type {
  ConflictMergePreview,
  FieldDescriptor,
  FieldPath,
  FileWrite,
  FolderCollectionDescriptor,
  ParseIssue,
  SaveDraftPayload,
  SaveMachineState,
  StagedMediaTileRecord,
} from "@mycms/core"
import {
  adjudicateDraft,
  computeDirtyPaths,
  DEFAULT_LEASE_HEARTBEAT_MS,
  decodeUtf8,
  encodeUtf8,
  fieldPathKey,
  parseJsonDocument,
  publicPathToRepoPath,
  repoPathToPublicPath,
  resolveMediaFolders,
  SaveInFlightError,
  validateEntryForSave,
} from "@mycms/core"
import type { ReactNode } from "react"
import { useEffect, useMemo, useRef, useState } from "react"
import { usePublishEntry, useRuntime, useSnapshot } from "../runtime/context"
import type { EntryIndex, IndexedEntry } from "../runtime/entry-index"
import { StatusChip } from "../status/chip"
import { usePublishedSha } from "../status/provider"
import {
  defaultWidgetRegistry,
  EDITABLE_FIELD_TYPES,
  stripIssuePrefix,
  WidgetRegistryProvider,
  type WidgetServices,
} from "../widgets"
import { normalizeImage } from "../workers/raster-client"
import { AdvisoryChips } from "./advisory-chip"
import { BehindTheScenesDrawer } from "./behind-the-scenes"
import { personalize, RECOVERY_COPY, SAVE_BAR_COPY, TEMPLATE_COPY } from "./copy"
import { DriftBanner } from "./drift-banner"
import { DriftDrawer } from "./drift-drawer"
import { useDriftMonitor } from "./drift-monitor"
import { FailureCard } from "./failure-card"
import { composeFailureReport, copyToClipboard } from "./failure-report"
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
  withReconciledBase,
} from "./form-value"
import {
  allFreezeRowsDecided,
  applyAllFreezeChoices,
  createFreezeRows,
  type FreezeRow,
  replayLateKeystrokes,
} from "./freeze-model"
import { FreezePanel } from "./freeze-panel"
import { humanizeIssue } from "./message-map"
import { RateLimitTimer } from "./rate-limit-timer"
import { ReauthSheet } from "./reauth-sheet"
import { SaveBar } from "./save-bar"
import { describeSaveBar } from "./save-bar-model"
import type { SweepVerdict } from "./save-sweep"
import { sweepSite } from "./save-sweep"
import { deriveSlugFromTitle, SlugChip } from "./slug-chip"

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

interface ActiveConflict {
  readonly headSha: string
  readonly remoteRaw?: string
  readonly merge?: ConflictMergePreview
  readonly rows: readonly FreezeRow[]
  readonly baseMineTree: Readonly<Record<string, unknown>>
  readonly choices: ReadonlyMap<string, "theirs" | "mine">
  readonly isBoot?: boolean
}

export interface EntryEditorProps {
  readonly entry: IndexedEntry
  /** Snapshot head commit — the base the form loads against. */
  readonly headSha: string
  /** Whole-repo index for relation existence checks (strict save gate). */
  readonly index: EntryIndex | undefined
  /** Read-only renderer for list/object/image/relation/slug/hidden fields. */
  readonly renderReadOnly: (field: FieldDescriptor, value: unknown) => ReactNode
  readonly isNew?: boolean
  readonly onCreated?: (collectionName: string, slug: string) => void
}

export function EntryEditor({
  entry,
  headSha,
  index,
  renderReadOnly,
  isNew = false,
  onCreated,
}: EntryEditorProps) {
  const { backend, config, repository, drafts, coordinator, lease, support, probe, signOut } =
    useRuntime()
  const publishEntry = usePublishEntry()
  const snapshot = useSnapshot()
  const [currentSlug, setCurrentSlug] = useState(entry.slug)
  const [slugManuallyEdited, setSlugManuallyEdited] = useState(false)

  const existingSlugs = useMemo(() => {
    const collSlugs = index?.bySlug.get(entry.collectionName)
    return collSlugs ? [...collSlugs.keys()] : []
  }, [index, entry.collectionName])

  const folderColl =
    entry.collection.kind === "folder"
      ? (entry.collection as FolderCollectionDescriptor)
      : undefined
  const collectionFolder = folderColl?.folder ?? ""
  const ext =
    (folderColl?.format as string) === "yaml" || (folderColl?.format as string) === "yml"
      ? "yml"
      : "json"
  const entryPath = isNew
    ? `${collectionFolder.replace(/\/+$/, "")}/${currentSlug}.${ext}`
    : entry.path

  const publishedSha = usePublishedSha(entryPath)
  const draftKey = `${repository.repo}/${entry.collectionName}/${currentSlug}`

  const widgetServices: WidgetServices | undefined = useMemo(() => {
    if (!index) return undefined
    return {
      getEntries: (collName) => index.byCollection.get(collName) ?? [],
      getEntryBySlug: (collName, s) => index.bySlug.get(collName)?.get(s),
      searchEntries: (collName, query, searchFields) => {
        const list = index.byCollection.get(collName) ?? []
        const q = query.trim().toLowerCase()
        if (!q) return list
        return list.filter((e) =>
          searchFields.some((f) => {
            const val = e.value[f] ?? (e as unknown as Record<string, unknown>)[f]
            return typeof val === "string" && val.toLowerCase().includes(q)
          }),
        )
      },
      stageMedia: async (file, options) => {
        const coll = options?.collection ?? entry.collectionName
        const mediaFolders = resolveMediaFolders(config, coll)

        const bytes = new Uint8Array(await file.arrayBuffer())
        const normalized = await normalizeImage({
          bytes,
          filename: options?.targetFilename ?? file.name,
          mimeType: file.type,
        })

        const publicPathResult = repoPathToPublicPath(
          `${mediaFolders.folder.replace(/^\/+/, "")}/${normalized.sanitizedFilename}`,
          mediaFolders,
        )
        const publicPath = publicPathResult.ok
          ? publicPathResult.value
          : `/${mediaFolders.publicFolder.replace(/^\/+/, "")}/${normalized.sanitizedFilename}`

        const repoPath = `${mediaFolders.folder.replace(/^\/+/, "")}/${normalized.sanitizedFilename}`
        const tileId = `tile-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`

        const tile: StagedMediaTileRecord = {
          tileId,
          repoPath,
          publicPath,
          originalFilename: file.name,
          sanitizedFilename: normalized.sanitizedFilename,
          bytes: normalized.bytes,
          mimeType: normalized.mimeType,
          size: normalized.bytes.byteLength,
          sha: `staged-${tileId}`,
          status: "ready",
        }

        await drafts.put({
          key: `${draftKey}/media/${tileId}`,
          savedAt: new Date().toISOString(),
          value: tile,
        })

        return { publicPath, tile }
      },
      listStagedMedia: async () => {
        const records = await drafts.list(`${draftKey}/media/`)
        return records
          .map((r) => r.value as StagedMediaTileRecord)
          .filter((t) => Boolean(t?.repoPath))
      },
      resolveMediaSha: (path: string) => {
        if (!snapshot.data?.tree?.entries) return undefined
        const mediaFolders = resolveMediaFolders(config, entry.collectionName)
        const repoPathResult = publicPathToRepoPath(path, mediaFolders)
        const targetRepoPath = repoPathResult.ok ? repoPathResult.value : path.replace(/^\/+/, "")
        return snapshot.data.tree.entries.find((e) => e.path === targetRepoPath)?.sha
      },
    }
  }, [index, config, drafts, draftKey, entry.collectionName, snapshot.data?.tree?.entries])

  const [form, setForm] = useState<EntryFormState | null>(() => {
    const created = createEntryForm(entry, headSha)
    return created.ok ? created.form : null
  })
  const formRef = useRef(form)
  const [machine, setMachine] = useState<SaveMachineState | undefined>(undefined)
  const [boot, setBoot] = useState<BootOffer | BootConflict | undefined>(undefined)
  const [conflict, setConflict] = useState<ActiveConflict | undefined>(undefined)
  const [validationIssues, setValidationIssues] = useState<readonly ParseIssue[]>([])
  const [justSaved, setJustSaved] = useState(false)
  const [justNoop, setJustNoop] = useState(false)
  const [leaseLost, setLeaseLost] = useState(false)
  /** Post-publish advisory sweep (P2.7); undefined = never ran yet. */
  const [sweep, setSweep] = useState<SweepVerdict | undefined>(undefined)
  const [reauthOpen, setReauthOpen] = useState(false)
  const [reportCopied, setReportCopied] = useState(false)
  const [driftDrawerOpen, setDriftDrawerOpen] = useState(false)
  const { drift, clearDrift } = useDriftMonitor({
    branch: repository.branch,
    baseHeadSha: form?.baseSha,
    entryPath,
    backend,
    rateLimitRemaining: probe?.rateLimit?.remaining,
    enabled: !isNew && Boolean(backend),
  })
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

  useEffect(() => {
    if (machine?.phase === "paused" && machine.reason === "auth") {
      setReauthOpen(true)
    }
  }, [machine])

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
        await drafts.deletePrefix(`${draftKey}/media/`)
        return
      }
      if (adjudication.kind === "conflict") {
        const stored = asRecord(record.value.formValue) ?? {}
        if (adjudication.merge !== undefined) {
          const rows = createFreezeRows({
            frozenFieldPaths: adjudication.merge.frozenFieldPaths,
            remoteRaw: adjudication.merge.remoteRaw,
            mineTree: stored,
            fields: entry.fields,
          })
          setConflict({
            headSha: adjudication.headSha,
            remoteRaw: adjudication.merge.remoteRaw,
            merge: adjudication.merge,
            rows,
            baseMineTree: stored,
            choices: new Map(),
            isBoot: true,
          })
        } else {
          setConflict({
            headSha: adjudication.headSha,
            rows: [],
            baseMineTree: stored,
            choices: new Map(),
            isBoot: true,
          })
        }
        return
      }
      const stored = asRecord(record.value.formValue)
      if (stored === undefined && adjudication.mergedRaw === undefined) {
        // Nothing restorable was stored — the honest surface is the freeze
        // message, not an "offer" that would blank the entry.
        setConflict({
          headSha: adjudication.headSha,
          rows: [],
          baseMineTree: {},
          choices: new Map(),
          isBoot: true,
        })
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

  const handleFieldChange = (fieldName: string, value: unknown) => {
    if (isNew && fieldName === "title" && !slugManuallyEdited && typeof value === "string") {
      const derived = deriveSlugFromTitle(value, existingSlugs)
      setCurrentSlug(derived)
    }
    handleChange(fieldName, value)
  }

  const save = async (): Promise<void> => {
    const current = formRef.current
    if (current === null || coordinator === undefined) return
    if (current.dirtyPaths.length === 0 || saving.current) return
    saving.current = true
    const submitSnapshot = current.formValue
    try {
      const bytes = composeFormBytes(current, entry.fields)
      const validation = await validateEntryForSave({
        fields: entry.fields,
        raw: current.formValue,
        filePath: entryPath,
        media: entry.media,
        ...(index === undefined ? {} : { services: { hasEntry: hasEntryIn(index) } }),
      })
      if (!validation.ok) {
        if (!mounted.current) return
        setValidationIssues(validation.issues.filter((issue) => issue.severity === "error"))
        return
      }
      setValidationIssues([])

      const stagedRecords = await drafts.list(`${draftKey}/media/`)
      const stagedAdds: FileWrite[] = []
      for (const rec of stagedRecords) {
        const tile = rec.value as StagedMediaTileRecord
        if (tile?.repoPath && tile.bytes) {
          stagedAdds.push({ path: tile.repoPath, bytes: tile.bytes })
        }
      }

      const contentWrite: FileWrite = { path: entryPath, bytes: encodeUtf8(bytes) }
      const changes = isNew
        ? { adds: [contentWrite, ...stagedAdds] }
        : {
            updates: [contentWrite],
            ...(stagedAdds.length > 0 ? { adds: stagedAdds } : {}),
          }

      const verdict = await coordinator.save({
        draftKey,
        changes,
        baseSha: current.baseSha,
        draft: draftPayload({ ...entry, path: entryPath, slug: currentSlug }, current),
      })
      if (!mounted.current) return

      if (verdict.kind === "published") {
        // New base = the commit the ref was OBSERVED carrying + the bytes we
        // composed (or reconciled). Never a re-read; edits made during the save
        // stay dirty.
        const latest = formRef.current
        if (latest !== null) {
          if (verdict.reconciliation !== undefined) {
            updateForm(
              withReconciledBase(latest, {
                commitSha: verdict.commitSha,
                raw: verdict.reconciliation.reconciledRaw,
                submitSnapshot,
              }),
            )
          } else {
            updateForm(withPublishedBase(latest, { commitSha: verdict.commitSha, raw: bytes }))
          }
        }
        coordinator.reset(draftKey, verdict.commitSha)
        setJustSaved(true)
        setJustNoop(false)
        setConflict(undefined)
        const currentTitle =
          formRef.current?.formValue && typeof formRef.current.formValue === "object"
            ? (formRef.current.formValue as Record<string, unknown>).title
            : undefined
        publishEntry(entryPath, verdict.commitSha, {
          title: currentTitle ? String(currentTitle) : entry.title,
          collectionName: entry.collectionName,
        })
        // P2.7: sweep what the site does with the OBSERVED commit (her path
        // excluded). Never on noop; never in the save path's way — the sweep
        // reads standalone and its verdict can never gate a save.
        runSweep(verdict.commitSha)
        if (isNew && onCreated) {
          onCreated(entry.collectionName, currentSlug)
        }
      } else if (verdict.kind === "noop") {
        const latest = formRef.current
        if (latest !== null && verdict.reconciliation !== undefined) {
          updateForm(
            withReconciledBase(latest, {
              commitSha: verdict.reconciliation.reconciledSha,
              raw: verdict.reconciliation.reconciledRaw,
              submitSnapshot,
            }),
          )
          coordinator.reset(draftKey, verdict.reconciliation.reconciledSha)
        } else {
          coordinator.reset(draftKey, current.baseSha)
        }
        setJustSaved(true)
        setJustNoop(true)
        setConflict(undefined)
      } else if (verdict.kind === "conflict") {
        setJustSaved(false)
        const merge = verdict.details.merge
        if (merge !== undefined) {
          const rows = createFreezeRows({
            frozenFieldPaths: merge.frozenFieldPaths,
            remoteRaw: merge.remoteRaw,
            mineTree: submitSnapshot,
            fields: entry.fields,
          })
          setConflict({
            headSha: verdict.details.currentHeadSha,
            remoteRaw: merge.remoteRaw,
            merge,
            rows,
            baseMineTree: submitSnapshot,
            choices: new Map(),
          })
        } else {
          setConflict({
            headSha: verdict.details.currentHeadSha,
            rows: [],
            baseMineTree: submitSnapshot,
            choices: new Map(),
          })
        }
      } else {
        // failed: the bar reads the machine; drafts stay on device.
        setJustSaved(false)
      }
    } catch (error) {
      if (!(error instanceof SaveInFlightError)) throw error
    } finally {
      saving.current = false
    }
  }

  const handleFreezeChoice = (path: FieldPath, choice: "theirs" | "mine"): void => {
    if (conflict === undefined) return
    const key = fieldPathKey(path)
    const nextChoices = new Map(conflict.choices)
    nextChoices.set(key, choice)

    const nextRows = conflict.rows.map((r) => (r.key === key ? { ...r, choice } : r))

    if (!allFreezeRowsDecided(nextRows)) {
      setConflict({
        ...conflict,
        choices: nextChoices,
        rows: nextRows,
      })
      return
    }

    // All rows decided: reconcile tree, replay late keystrokes, adopt remote base.
    const reconciledTree = applyAllFreezeChoices(conflict.baseMineTree, nextRows)
    const current = formRef.current
    const finalTree =
      current === null || conflict.isBoot
        ? reconciledTree
        : replayLateKeystrokes({
            baseMineTree: conflict.baseMineTree,
            liveFormTree: current.formValue,
            reconciledTree,
          })

    const remoteRaw = conflict.remoteRaw ?? ""
    if (current !== null) {
      const updated = withBase(withFieldTree(current, finalTree), {
        baseSha: conflict.headSha,
        baseRaw: remoteRaw,
      })
      updateForm(updated)
      if (isFormDirty(updated)) {
        coordinator?.markDirty(draftKey, conflict.headSha)
      }
    }
    coordinator?.reset(draftKey, conflict.headSha)
    setConflict(undefined)
    setBoot(undefined)
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

  const handleCopyMessage = async (): Promise<void> => {
    if (machine?.phase !== "failed" && machine?.phase !== "paused") return
    const errorCode =
      machine.phase === "failed"
        ? machine.error.code
        : machine.reason === "auth"
          ? "AUTH_EXPIRED"
          : machine.reason === "quota"
            ? "RATE_LIMIT"
            : "NETWORK"
    const httpStatus = machine.phase === "failed" ? machine.error.status : undefined
    const dirty = formRef.current
      ? computeDirtyPaths(formRef.current.formValue, formRef.current.baseValue)
      : []
    const report = composeFailureReport({
      entryTitle: entry.title,
      filePath: entry.path,
      branch: repository.branch,
      repo: `${repository.owner}/${repository.repo}`,
      baseSha: machine.baseSha,
      changedFields: dirty.map((p) => p.join(".")),
      errorCode,
      httpStatus,
      timestamp: new Date().toISOString(),
      partnerName: support.name,
    })
    const ok = await copyToClipboard(report)
    if (ok) {
      setReportCopied(true)
      setTimeout(() => setReportCopied(false), 2500)
    }
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
    setConflict(undefined)
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

  /**
   * Post-publish sweep (P2.7 pin): one fresh read of the OBSERVED commit, her
   * own path excluded. The sweep never gates a save: the verdict occupies its
   * own advisory state and nothing in the save path reads it.
   */
  const runSweep = (headSha: string): void => {
    if (backend === undefined) return
    setSweep(undefined)
    void sweepSite({
      config,
      backend,
      branch: repository.branch,
      headSha,
      ourPath: entry.path,
    }).then((verdict) => {
      if (mounted.current) setSweep(verdict)
    })
  }

  const model = describeSaveBar({
    state: machine,
    dirty: form !== null && isFormDirty(form),
    justSaved,
    justNoop,
    leaseLost,
    freezePending: conflict !== undefined && !allFreezeRowsDecided(conflict.rows),
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
    <WidgetRegistryProvider registry={defaultWidgetRegistry}>
      <div>
        {isNew ? (
          <div
            className="mb-4 rounded-card border border-accent/30 bg-accent/10 px-4 py-2.5 text-xs text-text-secondary"
            data-testid="new-entry-banner"
          >
            <span className="font-semibold text-text-primary">{TEMPLATE_COPY.newEntry}</span> —{" "}
            {TEMPLATE_COPY.nothingPublished}
          </div>
        ) : null}

        <DriftDrawer
          open={driftDrawerOpen}
          onOpenChange={setDriftDrawerOpen}
          drift={drift}
          supportName={support.name}
          isDirty={form !== null && isFormDirty(form)}
          onReload={() => {
            void startOver()
            clearDrift()
          }}
        />

        <DriftBanner
          drift={drift}
          supportName={support.name}
          onOpenDrawer={() => setDriftDrawerOpen(true)}
        />

        <SlugChip
          isNew={isNew}
          collection={entry.collectionName}
          slug={currentSlug}
          onSlugChange={(newSlug) => {
            setCurrentSlug(newSlug)
            setSlugManuallyEdited(true)
          }}
          existingSlugs={existingSlugs}
          supportName={support.name}
          entryTitle={String(form.formValue.title || entry.title || "this item")}
        />

        {boot === undefined ? null : (
          <BootBanner
            boot={boot}
            supportName={support.name}
            onRestore={() => void restore()}
            onDismiss={dismissOffer}
            onStartOver={() => void startOver()}
          />
        )}

        {conflict === undefined ? null : (
          <FreezePanel
            rows={conflict.rows}
            ourFieldPaths={conflict.merge?.ourFieldPaths}
            onChoose={handleFreezeChoice}
            onStartOver={() => void startOver()}
            degraded={conflict.merge === undefined}
            supportName={support.name}
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
              const widgetKey =
                (field as { widget?: string }).widget ||
                (defaultWidgetRegistry.get(field.name) ? field.name : field.type)
              const binding = EDITABLE_FIELD_TYPES.has(widgetKey)
                ? defaultWidgetRegistry.get(widgetKey)
                : undefined
              const childIssues = stripIssuePrefix(validationIssues, field.name)
              const rawIssue = validationIssues.find((issue) => issue.path === field.name)
              const error = rawIssue ? humanizeIssue(rawIssue, field, support.name) : undefined
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
                      onChange={(value) => handleFieldChange(field.name, value)}
                      error={error}
                      fieldConfig={field}
                      services={widgetServices}
                      nestedIssues={childIssues}
                    />
                  )}
                </div>
              )
            })}
        </div>

        <BehindTheScenesDrawer
          fields={entry.fields}
          value={form.formValue}
          supportName={support.name}
        />

        <AdvisoryChips verdict={sweep} supportName={support.name} />

        <StatusChip sha={publishedSha} />

        {/* Rate limit live countdown (INV-N01) */}
        {machine?.phase === "paused" && machine.reason === "quota" && machine.waitMs !== null ? (
          <div className="mt-6">
            <RateLimitTimer
              waitMs={machine.waitMs}
              onManualResume={() => coordinator?.resume(draftKey)}
            />
          </div>
        ) : null}

        {/* Docked failure card (INV-A02) */}
        {machine?.phase === "failed" ||
        (machine?.phase === "paused" &&
          (machine.reason === "auth" ||
            machine.reason === "network" ||
            (machine.reason === "quota" && machine.waitMs === null))) ? (
          <div className="mt-6">
            <FailureCard
              errorCode={
                machine.phase === "failed"
                  ? machine.error.code
                  : machine.reason === "auth"
                    ? "AUTH_EXPIRED"
                    : machine.reason === "quota"
                      ? "RATE_LIMIT"
                      : "NETWORK"
              }
              httpStatus={machine.phase === "failed" ? machine.error.status : undefined}
              supportName={support.name}
              onRetry={retry}
              onCheckKey={
                (machine.phase === "failed" && machine.error.code === "AUTH_EXPIRED") ||
                (machine.phase === "paused" && machine.reason === "auth")
                  ? () => setReauthOpen(true)
                  : undefined
              }
              onStartOver={() => void startOver()}
              onCopyMessage={() => void handleCopyMessage()}
              copied={reportCopied}
              technicalContext={
                formRef.current
                  ? {
                      entryTitle: entry.title,
                      filePath: entryPath,
                      branch: repository.branch,
                      repo: `${repository.owner}/${repository.repo}`,
                      baseSha: machine.baseSha,
                      changedFields: computeDirtyPaths(
                        formRef.current.formValue,
                        formRef.current.baseValue,
                      ).map((p) => p.join(".")),
                    }
                  : undefined
              }
            />
          </div>
        ) : null}

        <ReauthSheet
          open={reauthOpen}
          supportName={support.name}
          onReauthenticated={() => setReauthOpen(false)}
          onCancel={() => setReauthOpen(false)}
          onSignOut={() => void signOut()}
        />

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
    </WidgetRegistryProvider>
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
