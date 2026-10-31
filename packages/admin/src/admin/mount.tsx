/**
 * Admin composition root — ADR-0001 canon: ONE mount call.
 * `mountAdmin(el, {config, support, repository})` owns the query client, auth
 * runtime, and router. The query client is the ONLY UI cache (master-plan §4.3).
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { createRouter, RouterProvider } from "@tanstack/react-router"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { AdminRuntimeProvider } from "../runtime/context"
import { routeTree } from "./routes"
import type { AdminMountOptions } from "./types"

const QUERY_CLIENT = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: false,
    },
  },
})

export function mountAdmin(el: HTMLElement, options: AdminMountOptions): void {
  const router = createRouter({ routeTree })
  createRoot(el).render(
    <StrictMode>
      <QueryClientProvider client={QUERY_CLIENT}>
        <AdminRuntimeProvider options={options}>
          <RouterProvider router={router} />
        </AdminRuntimeProvider>
      </QueryClientProvider>
    </StrictMode>,
  )
}

export {
  BlobCacheManager,
  BlobCacheProvider,
  useBlobCache,
  useBlobPreview,
} from "../runtime/blob-cache"
