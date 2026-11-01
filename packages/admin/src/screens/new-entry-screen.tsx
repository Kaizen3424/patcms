import { useQueryClient } from "@tanstack/react-query"
import { Link, useNavigate, useParams, useSearch } from "@tanstack/react-router"
import type { FolderCollectionDescriptor } from "patcms/advanced"
import { useMemo } from "react"
import { EntryEditor } from "../editor/entry-editor"
import { deriveSlugFromTitle } from "../editor/slug-chip"
import {
  cloneEntryAsTemplate,
  createNewBlankEntry,
  createSyntheticNewIndexedEntry,
} from "../editor/template-clone"
import { useEntryIndex, useRuntime, useSnapshot } from "../runtime/context"
import { FieldValue } from "./entry-screen"

export function NewEntryScreen() {
  const { config } = useRuntime()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const params = useParams({ strict: false }) as { readonly collection?: string }
  const search = useSearch({ strict: false }) as { readonly from?: string }
  const index = useEntryIndex()
  const snapshot = useSnapshot()

  const collection = config.collections.find(
    (c): c is FolderCollectionDescriptor =>
      c.kind === "folder" && c.name === params.collection && c.create !== false,
  )

  const sourceEntry = useMemo(() => {
    if (!search.from || !params.collection || !index.data) return undefined
    return index.data.bySlug.get(params.collection)?.get(search.from)
  }, [search.from, params.collection, index.data])

  const initialValue = useMemo(() => {
    if (!collection) return {}
    if (sourceEntry) {
      return cloneEntryAsTemplate(sourceEntry, collection)
    }
    return createNewBlankEntry(collection)
  }, [collection, sourceEntry])

  const existingSlugs = useMemo(() => {
    if (!params.collection || !index.data) return []
    const collSlugs = index.data.bySlug.get(params.collection)
    return collSlugs ? [...collSlugs.keys()] : []
  }, [params.collection, index.data])

  const starterSlug = useMemo(() => {
    const rawTitle = typeof initialValue.title === "string" ? initialValue.title : ""
    return deriveSlugFromTitle(rawTitle || "new-item", existingSlugs)
  }, [initialValue.title, existingSlugs])

  const syntheticEntry = useMemo(() => {
    if (!collection) return undefined
    return createSyntheticNewIndexedEntry(collection, starterSlug, initialValue)
  }, [collection, starterSlug, initialValue])

  if (index.isLoading || snapshot.isLoading) {
    return <p className="text-sm text-text-muted">Preparing new entry...</p>
  }

  if (collection === undefined || syntheticEntry === undefined) {
    return (
      <div className="rounded-card border border-dashed border-border-strong bg-surface/40 px-6 py-12 text-center">
        <h1 className="text-base font-semibold">Cannot create new entry</h1>
        <p className="mt-2 text-sm text-text-muted">New entries are not enabled for this folder.</p>
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

  const headSha = snapshot.data?.head ?? ""

  return (
    <article className="mx-auto max-w-4xl" data-testid="new-entry-screen">
      <nav className="flex items-center gap-2 text-xs text-text-muted" aria-label="Breadcrumb">
        <Link
          to="/c/$collection"
          params={{ collection: collection.name }}
          className="hover:text-text-primary"
        >
          {collection.label}
        </Link>
        <span aria-hidden="true">/</span>
        <span className="truncate text-text-primary">New {collection.labelSingular || "item"}</span>
      </nav>

      <header className="mt-4 border-b border-border-soft pb-6">
        <p className="text-xs font-medium uppercase tracking-[0.14em] text-accent">Creating</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">
          New {collection.labelSingular || collection.label}
        </h1>
        {sourceEntry ? (
          <p className="mt-1 text-xs text-text-muted">
            Started from template: <span className="text-text-primary">{sourceEntry.title}</span>
          </p>
        ) : null}
      </header>

      <div className="mt-6">
        <EntryEditor
          key={starterSlug}
          isNew={true}
          entry={syntheticEntry}
          headSha={headSha}
          index={index.data}
          renderReadOnly={(field, value) => (
            <FieldValue
              field={field}
              raw={value}
              entry={syntheticEntry}
              index={index.data}
              depth={0}
            />
          )}
          onCreated={(collName, newSlug) => {
            void queryClient.invalidateQueries({ queryKey: ["snapshot"] })
            void queryClient.invalidateQueries({ queryKey: ["entries"] })
            void navigate({
              to: "/c/$collection/e/$entry",
              params: { collection: collName, entry: newSlug },
            })
          }}
        />
      </div>

      <footer className="mt-8 border-t border-border-soft pt-4">
        <Link
          to="/c/$collection"
          params={{ collection: collection.name }}
          className="text-sm text-accent underline-offset-4 hover:underline"
        >
          Back to {collection.label}
        </Link>
      </footer>
    </article>
  )
}
