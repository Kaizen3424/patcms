/** Router — P1 login gate, collection library, read-only entry view. */
import { createRootRoute, createRoute, Navigate, Outlet } from "@tanstack/react-router"
import { useRuntime } from "../runtime/context"
import { AppShell } from "../screens/app-shell"
import { EntryScreen } from "../screens/entry-screen"
import { LibraryScreen } from "../screens/library-screen"
import { LoginScreen } from "../screens/login-screen"
import { MediaLibraryScreen } from "../screens/media-library-screen"
import { NewEntryScreen } from "../screens/new-entry-screen"
import { RecentlyDeletedScreen } from "../screens/recently-deleted-screen"

function RootLayout() {
  const { status } = useRuntime()
  if (status === "loading") return <BootScreen />
  if (status !== "signedIn") return <LoginScreen />
  return (
    <AppShell>
      <Outlet />
    </AppShell>
  )
}

function BootScreen() {
  return (
    <main className="grid min-h-dvh place-items-center bg-bg px-6 text-text-primary">
      <div className="text-center">
        <span
          aria-hidden="true"
          className="mx-auto grid size-11 place-items-center rounded-card border border-accent/40 bg-accent-soft text-sm font-semibold text-accent"
        >
          I&Y
        </span>
        <p className="mt-4 text-sm text-text-muted">Checking this device...</p>
      </div>
    </main>
  )
}

function IndexRedirect() {
  const { config } = useRuntime()
  const first = config.collections.find((collection) => collection.kind !== "divider")
  if (first === undefined) {
    return (
      <div className="mx-auto max-w-xl rounded-card border border-dashed border-border-strong bg-surface/40 p-8 text-center">
        <h1 className="text-lg font-semibold">No content folders yet</h1>
        <p className="mt-2 text-sm leading-6 text-text-muted">
          Add a collection to the studio config to start browsing this site.
        </p>
      </div>
    )
  }
  return <Navigate to="/c/$collection" params={{ collection: first.name }} replace />
}

const rootRoute = createRootRoute({ component: RootLayout })

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: IndexRedirect,
})

const collectionRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/c/$collection",
  component: LibraryScreen,
})

const newEntryRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/c/$collection/new",
  component: NewEntryScreen,
  validateSearch: (search: Record<string, unknown>) => ({
    from: typeof search.from === "string" ? search.from : undefined,
  }),
})

const entryRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/c/$collection/e/$entry",
  component: EntryScreen,
})

const mediaRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/media",
  component: MediaLibraryScreen,
})

const trashRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/trash",
  component: RecentlyDeletedScreen,
})

export const routeTree = rootRoute.addChildren([
  indexRoute,
  collectionRoute,
  newEntryRoute,
  entryRoute,
  mediaRoute,
  trashRoute,
])
