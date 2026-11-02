/** Playground dev/build config - serves the shared fixture mirror + example panel. */
import { createReadStream, statSync } from "node:fs"
import { extname, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"
import react from "@vitejs/plugin-react"
import type { Plugin, PreviewServer, ViteDevServer } from "vite"
import { defineConfig } from "vite"

const ROOT = fileURLToPath(new URL(".", import.meta.url))
const FIXTURE_ROOT = resolve(ROOT, "fixtures", "repo")
const IMAGE_ROOT = resolve(FIXTURE_ROOT, "public", "images")

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  ".json": "application/json; charset=utf-8",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".svg": "image/svg+xml",
  ".gif": "image/gif",
}

/**
 * Vite serves the fixture repository from disk in dev AND preview. The preview
 * server is what Playwright uses; keeping one handler for both avoids a second
 * copied fixture tree (the manifest is the single source of truth).
 */
function fixtureServer(): Plugin {
  const mount = (middlewares: ViteDevServer["middlewares"] | PreviewServer["middlewares"]) => {
    middlewares.use((request, response, next) => {
      const rawUrl = request.url ?? ""
      const pathname = decodeURIComponent(rawUrl.split("?")[0] ?? "")
      const mapping = pathname.startsWith("/fixtures/repo/")
        ? { prefix: "/fixtures/repo/", root: FIXTURE_ROOT }
        : pathname.startsWith("/images/")
          ? { prefix: "/images/", root: IMAGE_ROOT }
          : null
      if (mapping === null) {
        next()
        return
      }
      const relative = pathname.slice(mapping.prefix.length)
      const absolute = resolve(mapping.root, relative)
      if (!absolute.startsWith(mapping.root + sep) && absolute !== mapping.root) {
        response.statusCode = 404
        response.end("not found")
        return
      }
      let size: number
      try {
        const stat = statSync(absolute)
        if (!stat.isFile()) throw new Error("not a file")
        size = stat.size
      } catch {
        response.statusCode = 404
        response.end("not found")
        return
      }
      response.setHeader(
        "Content-Type",
        CONTENT_TYPES[extname(absolute).toLowerCase()] ?? "application/octet-stream",
      )
      response.setHeader("Content-Length", String(size))
      response.setHeader("Cache-Control", "no-store")
      createReadStream(absolute).pipe(response)
    })
  }
  return {
    name: "patcms-fixture-server",
    configureServer(server) {
      mount(server.middlewares)
    },
    configurePreviewServer(server) {
      mount(server.middlewares)
    },
  }
}

export default defineConfig({
  envPrefix: ["VITE_", "PATCMS_"],
  plugins: [react(), fixtureServer()],
  resolve: {
    dedupe: ["react", "react-dom"],
  },
  build: {
    target: "es2022",
    sourcemap: false,
  },
})
