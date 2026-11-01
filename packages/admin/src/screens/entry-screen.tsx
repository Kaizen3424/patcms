import { Link, useParams } from "@tanstack/react-router"
import type { FieldDescriptor, ParseIssue } from "patcms/advanced"
import { formatMoney, isBackendReadError } from "patcms/advanced"
import { useState } from "react"
import {
  FAILURE_CARD_COPY,
  FAILURE_COPY,
  fillName,
  personalize,
  READ_ERROR_COPY,
} from "../editor/copy"
import { EntryEditor } from "../editor/entry-editor"
import { composeFailureReport, copyToClipboard } from "../editor/failure-report"
import { ReauthSheet } from "../editor/reauth-sheet"
import { useEntryIndex, useRuntime, useSnapshot } from "../runtime/context"
import type { EntryIndex, IndexedEntry } from "../runtime/entry-index"
import { findRelationEntry, issueCounts } from "../runtime/entry-index"
import { imageSource, previewUrl } from "../runtime/media"

export function EntryScreen() {
  const { config, support, repository, signOut } = useRuntime()
  const params = useParams({ strict: false }) as {
    readonly collection?: string
    readonly entry?: string
  }
  const index = useEntryIndex()
  const snapshot = useSnapshot()
  const [reauthOpen, setReauthOpen] = useState(false)
  const [reportCopied, setReportCopied] = useState(false)

  const collection = config.collections.find(
    (candidate) => candidate.kind !== "divider" && candidate.name === params.collection,
  )
  const entry =
    params.collection === undefined || params.entry === undefined
      ? undefined
      : index.data?.bySlug.get(params.collection)?.get(params.entry)

  if (
    index.isLoading ||
    snapshot.isLoading ||
    ((snapshot.isFetching || index.isFetching) && entry === undefined)
  ) {
    return <p className="text-sm text-text-muted">Reading the entry...</p>
  }

  const readError = index.error ?? snapshot.error
  if (readError !== null && readError !== undefined && isBackendReadError(readError)) {
    const errorCode = readError.code
    const fallback = FAILURE_COPY.UNKNOWN
    const line =
      (errorCode && errorCode in FAILURE_COPY ? FAILURE_COPY[errorCode] : undefined) ?? fallback
    const copy = personalize(
      line ?? { title: "Something went wrong.", detail: "Please contact {name}." },
      support.name,
    )

    const handleCopy = async () => {
      const report = composeFailureReport({
        entryTitle: params.entry ?? "entry",
        filePath: `${params.collection ?? "collection"}/${params.entry ?? "entry"}`,
        branch: repository.branch,
        repo: `${repository.owner}/${repository.repo}`,
        baseSha: "",
        errorCode,
        httpStatus: readError.status,
        timestamp: new Date().toISOString(),
        partnerName: support.name,
        kind: "read",
      })
      const ok = await copyToClipboard(report)
      if (ok) {
        setReportCopied(true)
        setTimeout(() => setReportCopied(false), 2500)
      }
    }

    return (
      <div
        className="rounded-card border border-danger/40 bg-danger/10 p-8 text-center"
        data-testid="read-error-screen"
      >
        <h1 className="text-base font-semibold text-text-primary">{copy.title}</h1>
        {copy.detail ? <p className="mt-2 text-sm text-text-muted">{copy.detail}</p> : null}
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          {errorCode === "AUTH_EXPIRED" ? (
            <button
              type="button"
              className="rounded-lg bg-accent px-4 py-2 text-xs font-semibold text-[#111]"
              onClick={() => setReauthOpen(true)}
            >
              {FAILURE_CARD_COPY.checkKey}
            </button>
          ) : (
            <button
              type="button"
              className="rounded-lg bg-accent px-4 py-2 text-xs font-semibold text-[#111]"
              onClick={() => {
                void index.refetch()
                void snapshot.refetch()
              }}
            >
              {READ_ERROR_COPY.retry}
            </button>
          )}
          <Link
            to="/c/$collection"
            params={{ collection: params.collection ?? "products" }}
            className="rounded-lg border border-border-strong bg-surface px-4 py-2 text-xs font-medium text-text-primary"
          >
            {READ_ERROR_COPY.backToFolder}
          </Link>
          <button
            type="button"
            className="rounded-lg border border-border-strong bg-surface px-4 py-2 text-xs font-medium text-text-primary"
            onClick={() => void handleCopy()}
          >
            {reportCopied
              ? FAILURE_CARD_COPY.copied
              : fillName(READ_ERROR_COPY.copyMessage, support.name)}
          </button>
        </div>
        <ReauthSheet
          open={reauthOpen}
          supportName={support.name}
          isRead={true}
          onReauthenticated={() => {
            setReauthOpen(false)
            void index.refetch()
            void snapshot.refetch()
          }}
          onCancel={() => setReauthOpen(false)}
          onSignOut={() => void signOut()}
        />
      </div>
    )
  }
  if (
    index.isError ||
    collection === undefined ||
    collection.kind === "divider" ||
    entry === undefined
  ) {
    return (
      <div className="rounded-card border border-dashed border-border-strong bg-surface/40 px-6 py-12 text-center">
        <h1 className="text-base font-semibold">Entry not found</h1>
        <p className="mt-2 text-sm text-text-muted">
          It may have moved, or the folder may not be part of this studio.
        </p>
        <Link
          to="/c/$collection"
          params={{ collection: params.collection ?? "products" }}
          className="mt-4 inline-block text-sm text-accent underline-offset-4 hover:underline"
        >
          Back to the folder
        </Link>
      </div>
    )
  }

  const counts = issueCounts(entry)
  const headSha = snapshot.data?.head
  const hidden = collectHidden(entry.fields, entry.value, "")
  const untouched = Object.entries(entry.untouched)
  const preview = previewUrl(
    entry.collection.kind === "folder" ? entry.collection.previewPath : undefined,
    { ...entry.value, slug: entry.slug },
    config.site?.url,
  )

  return (
    <article className="mx-auto max-w-4xl">
      <nav className="flex items-center gap-2 text-xs text-text-muted" aria-label="Breadcrumb">
        <Link
          to="/c/$collection"
          params={{ collection: entry.collectionName }}
          className="hover:text-text-primary"
        >
          {entry.collection.label}
        </Link>
        <span aria-hidden="true">/</span>
        <span className="truncate text-text-primary">{entry.title}</span>
      </nav>

      <header className="mt-4 flex flex-wrap items-start justify-between gap-4 border-b border-border-soft pb-6">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-[0.14em] text-accent">Editing</p>
          <h1 className="mt-2 break-words text-3xl font-semibold tracking-tight">{entry.title}</h1>
          <p className="mt-2 break-all text-xs text-text-muted">{entry.path}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {preview === undefined ? null : (
            <a
              href={preview}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-full border border-border-soft bg-surface px-3 py-1.5 text-[11px] text-text-muted transition-colors hover:border-accent/50 hover:text-text-primary"
            >
              View on the site
            </a>
          )}
          <span className="rounded-full border border-border-soft bg-surface px-3 py-1.5 text-[11px] text-text-muted">
            {entry.blobSha.slice(0, 10)}
          </span>
        </div>
      </header>

      {entry.issues.length > 0 ? (
        <IssueBanner issues={entry.issues} errors={counts.errors} warnings={counts.warnings} />
      ) : (
        <p className="mt-5 flex items-center gap-2 text-xs text-success">
          <span className="size-1.5 rounded-full bg-success" aria-hidden="true" />
          No drift detected in this entry.
        </p>
      )}

      <div className="mt-7">
        {headSha === undefined ? (
          <FieldList
            fields={entry.fields}
            value={entry.value}
            entry={entry}
            index={index.data}
            depth={0}
          />
        ) : (
          <EntryEditor
            key={entry.path}
            entry={entry}
            headSha={headSha}
            index={index.data}
            renderReadOnly={(field, value) => (
              <FieldValue field={field} raw={value} entry={entry} index={index.data} depth={0} />
            )}
          />
        )}
      </div>

      {hidden.length > 0 ? (
        <section className="mt-8 border-t border-border-soft pt-5">
          <details>
            <summary className="cursor-pointer text-sm font-medium text-text-muted hover:text-text-primary">
              Preserved content ({hidden.length})
            </summary>
            <p className="mt-2 max-w-2xl text-xs leading-5 text-text-muted">
              These values are part of the entry but are not edited here yet. They are preserved
              exactly as they are.
            </p>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              {hidden.map((item) => (
                <div
                  key={item.path}
                  className="rounded-lg border border-border-soft bg-surface p-3"
                >
                  <p className="text-xs font-medium text-text-muted">{item.path}</p>
                  <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words text-xs leading-5 text-text-primary">
                    {JSON.stringify(item.value, null, 2)}
                  </pre>
                </div>
              ))}
            </div>
          </details>
        </section>
      ) : null}

      {untouched.length > 0 ? (
        <section
          className="mt-6 border-t border-border-soft pt-5"
          aria-label="Preserved unknown keys"
        >
          <h2 className="text-sm font-medium text-text-muted">Preserved unknown keys</h2>
          <p className="mt-2 max-w-2xl text-xs leading-5 text-text-muted">
            The site content has keys this version does not recognise. They are shown here and will
            not be removed.
          </p>
          <ul className="mt-3 space-y-2">
            {untouched.map(([pointer, value]) => (
              <li key={pointer} className="rounded-lg border border-border-soft bg-surface p-3">
                <p className="font-mono text-xs text-accent">{pointer}</p>
                <pre className="mt-2 whitespace-pre-wrap break-words text-xs text-text-primary">
                  {JSON.stringify(value, null, 2)}
                </pre>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <footer className="mt-8 border-t border-border-soft pt-4">
        <Link
          to="/c/$collection"
          params={{ collection: entry.collectionName }}
          className="text-sm text-accent underline-offset-4 hover:underline"
        >
          Back to {entry.collection.label}
        </Link>
      </footer>
    </article>
  )
}

interface HiddenValue {
  readonly path: string
  readonly value: unknown
}

function FieldList({
  fields,
  value,
  entry,
  index,
  depth,
}: {
  readonly fields: readonly FieldDescriptor[]
  readonly value: Readonly<Record<string, unknown>>
  readonly entry: IndexedEntry
  readonly index: EntryIndex | undefined
  readonly depth: number
}) {
  return (
    <dl className="grid gap-x-8 gap-y-6 sm:grid-cols-2">
      {fields.map((field) => {
        if (field.type === "divider" || field.type === "hidden") return null
        return (
          <FieldView
            key={field.name}
            field={field}
            raw={value[field.name]}
            entry={entry}
            index={index}
            depth={depth}
          />
        )
      })}
    </dl>
  )
}

function FieldView({
  field,
  raw,
  entry,
  index,
  depth,
}: {
  readonly field: FieldDescriptor
  readonly raw: unknown
  readonly entry: IndexedEntry
  readonly index: EntryIndex | undefined
  readonly depth: number
}) {
  if (field.type === "divider") return null
  const half = field.width === "half" && depth === 0
  return (
    <div className={half ? "sm:col-span-1" : "sm:col-span-2"}>
      <dt className="text-xs font-medium uppercase tracking-[0.1em] text-text-muted">
        {field.label}
      </dt>
      <dd className="mt-1.5 text-sm leading-6 text-text-primary">
        <FieldValue field={field} raw={raw} entry={entry} index={index} depth={depth} />
      </dd>
    </div>
  )
}

export function FieldValue({
  field,
  raw,
  entry,
  index,
  depth,
}: {
  readonly field: FieldDescriptor
  readonly raw: unknown
  readonly entry: IndexedEntry
  readonly index: EntryIndex | undefined
  readonly depth: number
}) {
  if (raw === undefined) return <NotSet />
  if (raw === null) return <NotSet />

  switch (field.type) {
    case "string":
    case "text":
      return typeof raw === "string" && raw.length > 0 ? (
        <span className="whitespace-pre-wrap break-words">{raw}</span>
      ) : (
        <NotSet />
      )
    case "number":
      if (typeof raw !== "number" || !Number.isFinite(raw)) return <NotSet />
      return (
        <span className="font-mono text-[13px]">
          {field.name.toLowerCase().includes("price") || field.label.toLowerCase().includes("price")
            ? formatMoney(raw)
            : String(raw)}
        </span>
      )
    case "boolean":
      return <span>{raw === true ? "Yes" : "No"}</span>
    case "select": {
      if (field.multiple === true && Array.isArray(raw)) {
        return (
          <span className="flex flex-wrap gap-1.5">
            {raw.map((item, index) => (
              <span
                key={`${String(item)}-${index}`}
                className="rounded-full border border-border-soft px-2 py-0.5 text-xs"
              >
                {optionLabel(field, item)}
              </span>
            ))}
          </span>
        )
      }
      return <span>{optionLabel(field, raw)}</span>
    }
    case "datetime":
      return <span>{formatDate(raw)}</span>
    case "image": {
      const source = imageSource(raw, entry.media.publicFolder)
      if (source === undefined)
        return <span className="break-all font-mono text-xs">{String(raw)}</span>
      return (
        <a
          href={source}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block max-w-full"
        >
          <img
            src={source}
            alt=""
            loading="lazy"
            className="max-h-56 rounded-lg border border-border-soft object-contain"
          />
          <span className="mt-1 block break-all font-mono text-[11px] text-text-muted">
            {source}
          </span>
        </a>
      )
    }
    case "relation":
      return <RelationValue field={field} raw={raw} entry={entry} index={index} />
    case "object":
      return isRecord(raw) ? (
        <div className="grid gap-4 rounded-lg border border-border-soft bg-surface/60 p-4 sm:grid-cols-2">
          <FieldList
            fields={field.fields}
            value={raw}
            entry={entry}
            index={index}
            depth={depth + 1}
          />
        </div>
      ) : (
        <NotSet />
      )
    case "list":
      return <ListValue field={field} raw={raw} entry={entry} index={index} depth={depth} />
    case "slug":
      return <span className="font-mono text-xs text-text-muted">{String(raw)}</span>
    case "hidden":
      return (
        <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-border-soft bg-surface p-3 text-xs">
          {JSON.stringify(raw, null, 2)}
        </pre>
      )
    default:
      return <pre className="whitespace-pre-wrap text-xs">{JSON.stringify(raw, null, 2)}</pre>
  }
}

function ListValue({
  field,
  raw,
  entry,
  index,
  depth,
}: {
  readonly field: Extract<FieldDescriptor, { type: "list" }>
  readonly raw: unknown
  readonly entry: IndexedEntry
  readonly index: EntryIndex | undefined
  readonly depth: number
}) {
  if (!Array.isArray(raw)) return <NotSet />
  if (raw.length === 0) return <span className="text-text-muted">No items</span>
  if (field.itemMode === "scalar") {
    const child = field.fields[0]
    if (child === undefined) return <span>{raw.map(String).join(", ")}</span>
    return (
      <span className="flex flex-wrap gap-1.5">
        {raw.map((item, itemIndex) => (
          <span
            key={itemIndex}
            className="rounded-full border border-border-soft px-2 py-0.5 text-xs"
          >
            {child.type === "relation" ? relationLabel(child, item, index) : String(item)}
          </span>
        ))}
      </span>
    )
  }
  return (
    <ol className="space-y-3">
      {raw.map((item, itemIndex) => {
        const record = isRecord(item) ? item : {}
        return (
          <li key={itemIndex} className="rounded-lg border border-border-soft bg-surface/60 p-4">
            <p className="mb-3 text-[11px] font-medium uppercase tracking-[0.1em] text-text-muted">
              {field.label} {itemIndex + 1}
            </p>
            <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
              <FieldList
                fields={field.fields}
                value={record}
                entry={entry}
                index={index}
                depth={depth + 1}
              />
            </div>
          </li>
        )
      })}
    </ol>
  )
}

function RelationValue({
  field,
  raw,
  entry,
  index,
}: {
  readonly field: Extract<FieldDescriptor, { type: "relation" }>
  readonly raw: unknown
  readonly entry: IndexedEntry
  readonly index: EntryIndex | undefined
}) {
  const values = field.multiple === true ? (Array.isArray(raw) ? raw : []) : [raw]
  if (values.length === 0) return <NotSet />
  return (
    <span className="flex flex-wrap gap-2">
      {values.map((value, valueIndex) => {
        if (typeof value !== "string") return <span key={valueIndex}>{String(value)}</span>
        const related = findRelationEntry(index, field.collection, value)
        return related === undefined ? (
          <span
            key={valueIndex}
            className="rounded-full border border-danger/40 bg-danger/10 px-2 py-0.5 text-xs text-danger"
          >
            Missing: {value}
          </span>
        ) : (
          <Link
            key={valueIndex}
            to="/c/$collection/e/$entry"
            params={{ collection: field.collection, entry: related.slug }}
            className="rounded-full border border-border-soft bg-surface px-2 py-0.5 text-xs text-text-primary underline-offset-4 hover:border-accent/50 hover:underline"
          >
            {related.title}
          </Link>
        )
      })}
      <span className="sr-only">Reference from {entry.title}</span>
    </span>
  )
}

function relationLabel(
  field: Extract<FieldDescriptor, { type: "relation" }>,
  value: unknown,
  index: EntryIndex | undefined,
): string {
  if (typeof value !== "string") return String(value)
  return findRelationEntry(index, field.collection, value)?.title ?? `Missing: ${value}`
}

function IssueBanner({
  issues,
  errors,
  warnings,
}: {
  readonly issues: readonly ParseIssue[]
  readonly errors: number
  readonly warnings: number
}) {
  const tone = errors > 0 ? "danger" : "warning"
  return (
    <section
      data-testid="drift-banner"
      role="status"
      className={`mt-5 rounded-card border p-4 ${
        tone === "danger" ? "border-danger/40 bg-danger/10" : "border-accent/40 bg-accent-soft"
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold tracking-tight">
          {errors > 0 ? "This entry needs attention" : "This entry has preserved notes"}
        </h2>
        <span className="text-xs text-text-muted">
          {errors} {errors === 1 ? "problem" : "problems"} · {warnings}{" "}
          {warnings === 1 ? "note" : "notes"}
        </span>
      </div>
      <ul className="mt-3 space-y-2">
        {issues.map((issue, index) => (
          <li
            key={`${issue.path}-${issue.code}-${index}`}
            className="flex flex-wrap gap-x-2 gap-y-1 text-xs leading-5"
          >
            <span
              className={`rounded px-1.5 py-0.5 font-mono text-[10px] uppercase ${
                issue.severity === "error" ? "bg-danger/15 text-danger" : "bg-accent/15 text-accent"
              }`}
            >
              {issue.code}
            </span>
            {issue.path.length === 0 ? null : (
              <span className="font-mono text-text-muted">{issue.path}</span>
            )}
            <span className="text-text-primary">{issue.message}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

function collectHidden(
  fields: readonly FieldDescriptor[],
  value: Readonly<Record<string, unknown>>,
  prefix: string,
): HiddenValue[] {
  const hidden: HiddenValue[] = []
  for (const field of fields) {
    if (field.type === "divider") continue
    const path = prefix.length === 0 ? field.name : `${prefix}.${field.name}`
    if (field.type === "hidden") {
      if (Object.hasOwn(value, field.name)) hidden.push({ path, value: value[field.name] })
      continue
    }
    if (field.type === "object" && isRecord(value[field.name])) {
      hidden.push(
        ...collectHidden(
          field.fields,
          value[field.name] as Readonly<Record<string, unknown>>,
          path,
        ),
      )
    }
  }
  return hidden
}

function optionLabel(field: Extract<FieldDescriptor, { type: "select" }>, raw: unknown): string {
  const value = typeof raw === "string" ? raw : String(raw)
  return field.options.find((option) => option.value === value)?.label ?? value
}

function formatDate(raw: unknown): string {
  if (typeof raw !== "string") return String(raw)
  const date = new Date(raw)
  if (Number.isNaN(date.getTime())) return raw
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" }).format(date)
}

function NotSet() {
  return <span className="text-text-muted">Not set</span>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
