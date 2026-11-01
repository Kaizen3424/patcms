/**
 * Playground host — boots the MSW FakeGithub, loads the shared fixture
 * mirror, and mounts the EXAMPLE PANEL against it. No real network target is
 * reachable here; the panel itself imports only `patcms` + `patcms/web`.
 *
 * Dev knobs (query parameters, fake-only):
 * - `conflictDemo=save` — a foreign commit lands right before the CAS check.
 * - `tokenChaos=expire-on-write` — the token expires after the first write.
 * - `rateLimitWriteSeconds=<n>` — writes rate-limited for n seconds.
 * - `failBlobUploadIndex=<n>` — the n-th blob POST fails with a 503.
 */

import { setupWorker } from "msw/browser"
import type { CreateCMSOptions } from "patcms"
import { yveConfig } from "./config/yve"
import { loadFixtureRepoFromBrowser } from "./fake-github/browser-fixture-repo"
import { pushForeignEntryCommit } from "./fake-github/foreign-commit"
import { createFakeGithubHandlers, DEFAULT_TAGS } from "./fake-github/handlers"
import type { FakeGithubServer } from "./fake-github/server"
import { mountPanel } from "./panel"

const TARGET_PATH = "src/content/products/the-rock-pendant.json"

async function main(): Promise<void> {
  const snapshot = await loadFixtureRepoFromBrowser()
  const params = new URLSearchParams(window.location.search)

  const conflictDemo = params.get("conflictDemo")
  let conflictInjected = false
  const beforeRefPatch =
    conflictDemo === "save"
      ? async ({ server, branch }: { server: FakeGithubServer; branch: string }) => {
          if (conflictInjected) return
          conflictInjected = true
          await pushForeignEntryCommit({
            server,
            branch,
            path: TARGET_PATH,
            mutator: (content) => ({
              ...content,
              material: "Wool felt · Leather (foreign push)",
            }),
            message: "foreign push at CAS (conflict demo)",
          })
        }
      : undefined

  const tokenChaos = params.get("tokenChaos")
  const rateLimitWrite = params.get("rateLimitWrite")
  const rateLimitWriteSeconds =
    rateLimitWrite !== null && Number(rateLimitWrite) > 0 ? Number(rateLimitWrite) : undefined
  const failBlobParam = params.get("failBlobUploadIndex")
  const failBlobUploadIndex =
    failBlobParam !== null && Number(failBlobParam) > 0 ? Number(failBlobParam) : undefined

  const { handlers } = createFakeGithubHandlers(snapshot, DEFAULT_TAGS, {
    requireAuth: true,
    chaos: {
      expireTokenOnWrite: tokenChaos === "expire-on-write",
      invalidTokens: tokenChaos === "expire-on-write" ? ["invalid_key", "bad_pat"] : undefined,
      ...(rateLimitWriteSeconds === undefined ? {} : { rateLimitWriteSeconds }),
      ...(failBlobUploadIndex === undefined ? {} : { failBlobUploadIndex }),
    },
    ...(beforeRefPatch === undefined ? {} : { beforeRefPatch }),
  })
  const worker = setupWorker(...handlers)
  await worker.start()

  // Harness guard: if the MSW service worker is not controlling this page (a
  // reload/HMR race can leave a window where it is not), a GitHub request
  // would silently reach the REAL api.github.com. Refuse loudly instead.
  const guardFetch: CreateCMSOptions["fetch"] = (input, init) => {
    if (navigator.serviceWorker.controller === null) {
      return Promise.reject(
        new Error("playground guard: MSW worker not controlling the page; GitHub request refused"),
      )
    }
    // Forward through the DOM fetch; the SDK's init type is structurally the
    // same object the browser expects, only named differently.
    return fetch(input as Parameters<typeof fetch>[0], init as Parameters<typeof fetch>[1])
  }

  const host = document.getElementById("app")
  if (host === null) throw new Error("playground host element missing")

  mountPanel(host, {
    config: yveConfig,
    repository: {
      owner: DEFAULT_TAGS.owner,
      repo: DEFAULT_TAGS.repo,
      branch: snapshot.defaultBranch,
    },
    fetch: guardFetch,
    title: "patcms example panel",
  })
}

void main().catch((error: unknown) => {
  const host = document.getElementById("app")
  if (host === null) return
  const message = error instanceof Error ? error.message : "The playground could not start."
  const heading = document.createElement("h1")
  heading.textContent = "The playground could not start"
  const detail = document.createElement("p")
  detail.textContent = message
  host.replaceChildren(heading, detail)
})
