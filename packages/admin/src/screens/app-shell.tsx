import { Link, Outlet, useRouterState } from "@tanstack/react-router"
import type { ReactNode } from "react"
import { useEffect, useState } from "react"
import { useEntryIndex, useRuntime } from "../runtime/context"
import { GlobalSearchModal } from "../search/global-search-modal"
import { StatusBanner } from "../status/chip"

export function AppShell({ children }: { readonly children?: ReactNode }) {
  const { config, support, probe, signOut } = useRuntime()
  const index = useEntryIndex()
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  const collections = config.collections.filter((collection) => collection.kind !== "divider")
  const [searchOpen, setSearchOpen] = useState(false)

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "k") {
        event.preventDefault()
        setSearchOpen((prev) => !prev)
      }
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [])

  return (
    <div className="flex min-h-dvh flex-col bg-bg text-text-primary md:flex-row">
      <GlobalSearchModal open={searchOpen} onOpenChange={setSearchOpen} />
      <aside className="flex shrink-0 flex-col border-b border-border-soft bg-surface/80 md:min-h-dvh md:w-72 md:border-b-0 md:border-r">
        <div className="flex items-center gap-3 px-5 py-5">
          <span
            aria-hidden="true"
            className="grid size-9 place-items-center rounded-lg border border-accent/40 bg-accent-soft text-xs font-semibold text-accent"
          >
            I&Y
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold tracking-tight">
              {config.site?.name ?? "Content studio"}
            </p>
            <p className="text-xs text-text-muted">Content studio</p>
          </div>
        </div>

        <div className="px-3 pb-3">
          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            data-testid="global-search-trigger"
            aria-label="Search content (⌘K)"
            className="flex w-full items-center justify-between rounded-lg border border-border-soft bg-surface-raised/40 px-3 py-2 text-xs text-text-muted transition-colors hover:border-border-strong hover:text-text-primary focus-visible:outline-2 focus-visible:outline-accent"
          >
            <span className="flex items-center gap-2">
              <span aria-hidden="true">🔍</span>
              <span>Search content...</span>
            </span>
            <kbd className="rounded border border-border-soft bg-surface px-1.5 py-0.5 font-mono text-[10px] text-text-muted">
              ⌘K
            </kbd>
          </button>
        </div>

        <nav
          aria-label="Content folders"
          className="flex gap-1 overflow-x-auto px-3 pb-3 md:block md:space-y-1"
        >
          {collections.map((collection) => {
            const active =
              pathname === `/c/${collection.name}` || pathname.startsWith(`/c/${collection.name}/`)
            const count = index.data?.byCollection.get(collection.name)?.length
            return (
              <Link
                key={collection.name}
                to="/c/$collection"
                params={{ collection: collection.name }}
                className={`flex shrink-0 items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors ${
                  active
                    ? "bg-surface-raised text-text-primary"
                    : "text-text-muted hover:bg-surface-raised/60 hover:text-text-primary"
                }`}
              >
                <span className="flex items-center gap-2.5">
                  <span
                    aria-hidden="true"
                    className={`size-1.5 rounded-full ${active ? "bg-accent" : "bg-border-strong"}`}
                  />
                  <span>{collection.label}</span>
                </span>
                <span className="text-xs tabular-nums text-text-muted">
                  {count === undefined ? "" : count}
                </span>
              </Link>
            )
          })}

          <div className="my-2 border-t border-border-soft pt-2">
            <Link
              to="/media"
              className={`flex shrink-0 items-center justify-between gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
                pathname === "/media"
                  ? "bg-surface-raised text-text-primary"
                  : "text-text-muted hover:bg-surface-raised/60 hover:text-text-primary"
              }`}
            >
              <span className="flex items-center gap-2.5">
                <span
                  aria-hidden="true"
                  className={`size-1.5 rounded-full ${pathname === "/media" ? "bg-accent" : "bg-border-strong"}`}
                />
                <span>Media</span>
              </span>
            </Link>
            <Link
              to="/trash"
              className={`flex shrink-0 items-center justify-between gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
                pathname === "/trash"
                  ? "bg-surface-raised text-text-primary"
                  : "text-text-muted hover:bg-surface-raised/60 hover:text-text-primary"
              }`}
            >
              <span className="flex items-center gap-2.5">
                <span
                  aria-hidden="true"
                  className={`size-1.5 rounded-full ${pathname === "/trash" ? "bg-accent" : "bg-border-strong"}`}
                />
                <span>Recently deleted</span>
              </span>
            </Link>
          </div>
        </nav>

        <div className="mt-auto hidden border-t border-border-soft px-5 py-4 md:block">
          <p className="text-xs text-text-muted">Signed in for {support.name}</p>
          <p className="mt-1 text-xs text-text-muted/80">Connected to this site&apos;s content</p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            <Badge tone={probe?.repo === "ok" ? "good" : "warn"}>Read access</Badge>
            <Badge tone="neutral">Read-only preview</Badge>
          </div>
          <button
            type="button"
            onClick={() => void signOut()}
            className="mt-4 rounded-lg border border-border-soft px-3 py-2 text-xs font-medium text-text-muted transition-colors hover:border-border-strong hover:text-text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            Sign out
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border-soft px-5 py-3 md:px-8">
          <div className="flex min-w-0 flex-wrap items-center gap-3">
            <p className="text-xs text-text-muted">
              Read-only preview <span className="px-1.5 text-border-strong">/</span>{" "}
              {probe?.rateLimit === null || probe?.rateLimit === undefined
                ? "GitHub"
                : `${probe.rateLimit.remaining} of ${probe.rateLimit.limit} requests left`}
            </p>
            <StatusBanner />
          </div>
          <div className="flex items-center gap-2 md:hidden">
            <button
              type="button"
              onClick={() => void signOut()}
              className="rounded-lg border border-border-soft px-3 py-2 text-xs font-medium text-text-muted"
            >
              Sign out
            </button>
          </div>
        </header>
        <main className="min-w-0 flex-1 px-5 py-6 md:px-8 md:py-8">{children ?? <Outlet />}</main>
      </div>
    </div>
  )
}

function Badge({
  children,
  tone,
}: {
  readonly children: ReactNode
  readonly tone: "good" | "warn" | "neutral"
}) {
  const classes =
    tone === "good"
      ? "border-success/30 bg-success/10 text-success"
      : tone === "warn"
        ? "border-accent/30 bg-accent-soft text-accent"
        : "border-border-soft bg-surface-raised text-text-muted"
  return (
    <span className={`rounded-full border px-2 py-1 text-[11px] font-medium ${classes}`}>
      {children}
    </span>
  )
}
