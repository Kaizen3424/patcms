import { mountAdmin } from "@mycms/admin"
import "@mycms/admin/styles.css"
import { setupWorker } from "msw/browser"
import { yveAdminConfig } from "./config/yve"
import { loadFixtureRepoFromBrowser } from "./fake-github/browser-fixture-repo"
import { createFakeGithubHandlers, DEFAULT_TAGS } from "./fake-github/handlers"
import { installHarness } from "./harness"

/**
 * Playground host — boots MSW FakeGithub, loads the shared fixture mirror, and
 * mounts the real admin against it. No real network target is reachable here.
 */
async function main(): Promise<void> {
  const snapshot = await loadFixtureRepoFromBrowser()
  const { handlers, server } = createFakeGithubHandlers(snapshot, DEFAULT_TAGS, {
    requireAuth: true,
  })
  const worker = setupWorker(...handlers)
  await worker.start()
  installHarness({ server, defaultBranch: snapshot.defaultBranch })

  const host = document.getElementById("app")
  if (host === null) {
    const message = "playground host element missing"
    throw new Error(message)
  }

  mountAdmin(host, {
    config: yveAdminConfig,
    support: { name: "Ing" },
    repository: {
      owner: DEFAULT_TAGS.owner,
      repo: DEFAULT_TAGS.repo,
      branch: snapshot.defaultBranch,
    },
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
