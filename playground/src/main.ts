import { mountAdmin } from "@mycms/admin"
import "@mycms/admin/styles.css"
import {
  createIdbDraftStore,
  type FakeGithubServer,
  type SaveDraftPayload,
  type StatusTiming,
} from "@mycms/core"
import { setupWorker } from "msw/browser"
import { yveAdminConfig } from "./config/yve"
import { loadFixtureRepoFromBrowser } from "./fake-github/browser-fixture-repo"
import { pushForeignEntryCommit } from "./fake-github/foreign-commit"
import { createFakeGithubHandlers, DEFAULT_TAGS } from "./fake-github/handlers"
import { installHarness } from "./harness"

/**
 * Playground host — boots MSW FakeGithub, loads the shared fixture mirror, and
 * mounts the real admin against it. No real network target is reachable here.
 */
async function main(): Promise<void> {
  const snapshot = await loadFixtureRepoFromBrowser()
  const conflictDemo = new URLSearchParams(window.location.search).get("conflictDemo")

  let conflictInjected = false
  const beforeRefPatch =
    conflictDemo === "save"
      ? async ({ server, branch }: { server: FakeGithubServer; branch: string }) => {
          if (conflictInjected) return
          conflictInjected = true
          await pushForeignEntryCommit({
            server,
            branch,
            path: "src/content/products/the-rock-pendant.json",
            mutator: (content) => ({
              ...content,
              material: "Wool felt · Leather (foreign push)",
            }),
            message: "foreign push at CAS (conflict demo)",
          })
        }
      : undefined

  const tokenChaos = new URLSearchParams(window.location.search).get("tokenChaos")
  const rateLimitWrite = new URLSearchParams(window.location.search).get("rateLimitWrite")
  const rateLimitWriteSeconds =
    rateLimitWrite !== null && Number(rateLimitWrite) > 0 ? Number(rateLimitWrite) : undefined

  const { handlers, server } = createFakeGithubHandlers(snapshot, DEFAULT_TAGS, {
    requireAuth: true,
    chaos: {
      expireTokenOnWrite: tokenChaos === "expire-on-write",
      invalidTokens: tokenChaos === "expire-on-write" ? ["invalid_key", "bad_pat"] : undefined,
      ...(rateLimitWriteSeconds === undefined ? {} : { rateLimitWriteSeconds }),
    },
    ...(beforeRefPatch === undefined ? {} : { beforeRefPatch }),
  })
  const worker = setupWorker(...handlers)
  await worker.start()
  installHarness({ server, defaultBranch: snapshot.defaultBranch })

  if (conflictDemo === "boot") {
    const targetPath = "src/content/products/the-rock-pendant.json"
    const file = server.contents(snapshot.defaultBranch, targetPath)
    if (file) {
      const initialText = new TextDecoder().decode(file.bytes)
      const initialParsed = JSON.parse(initialText) as Record<string, unknown>
      const initialHeadSha = server.ref(snapshot.defaultBranch) ?? snapshot.headSha

      const draftStore = createIdbDraftStore()
      await draftStore.put<SaveDraftPayload>({
        key: `${DEFAULT_TAGS.repo}/products/the-rock-pendant`,
        savedAt: new Date().toISOString(),
        value: {
          filePath: targetPath,
          baseSha: initialHeadSha,
          baseRaw: initialText,
          formValue: {
            ...initialParsed,
            title: "The Rock Pendant (draft edit)",
            material: "Wool felt · Leather (stored in draft)",
          },
        },
      })

      await pushForeignEntryCommit({
        server,
        branch: snapshot.defaultBranch,
        path: targetPath,
        mutator: (content) => ({
          ...content,
          material: "Wool felt · Leather (foreign push)",
        }),
        message: "foreign push pre-boot (conflict demo)",
      })
    }
  }

  const host = document.getElementById("app")
  if (host === null) {
    const message = "playground host element missing"
    throw new Error(message)
  }

  // E2e determinism seam (ADR-0004 P2.7 pins): hosts may override the lease TTL;
  // shipped admin behavior keeps the 15s default when no parameter is present.
  const requested = new URLSearchParams(window.location.search).get("leaseTtlMs")
  const leaseTtlMs = requested === null ? undefined : parseLeaseTtl(requested)

  // Deploy-status cadence seam (ADR-0008 P2.8): the six parameters let a
  // journey reach terminal states without waiting out real minutes. Absent or
  // invalid values keep the shipped defaults.
  const statusTiming = parseStatusTiming(window.location.search)

  mountAdmin(host, {
    config: yveAdminConfig,
    support: { name: "Ing" },
    repository: {
      owner: DEFAULT_TAGS.owner,
      repo: DEFAULT_TAGS.repo,
      branch: snapshot.defaultBranch,
    },
    ...(leaseTtlMs === undefined ? {} : { leaseTtlMs }),
    ...(statusTiming === undefined ? {} : { statusTiming }),
  })
}

function parseLeaseTtl(value: string): number | undefined {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined
  return Math.round(parsed)
}

/**
 * `statusFastPollMs` / `statusSlowPollMs` / `statusFastWindowMs` /
 * `statusGraceMs` / `statusMaxWatchMs` / `statusJitterRatio` on the playground
 * URL map onto `AdminMountOptions.statusTiming`. Jitter may be 0 (exact
 * cadence); everything else must be a positive number of milliseconds.
 */
function parseStatusTiming(search: string): Partial<StatusTiming> | undefined {
  const params = new URLSearchParams(search)
  const read = (key: string, allowZero = false): number | undefined => {
    const raw = params.get(key)
    if (raw === null) return undefined
    const parsed = Number(raw)
    if (!Number.isFinite(parsed) || parsed < 0 || (!allowZero && parsed === 0)) return undefined
    return Math.round(parsed)
  }
  const timing: { -readonly [K in keyof StatusTiming]?: number } = {}
  const assign = (field: keyof StatusTiming, param: string): void => {
    const value = read(param)
    if (value !== undefined) timing[field] = value
  }
  assign("fastPollMs", "statusFastPollMs")
  assign("slowPollMs", "statusSlowPollMs")
  assign("fastWindowMs", "statusFastWindowMs")
  assign("graceMs", "statusGraceMs")
  assign("maxWatchMs", "statusMaxWatchMs")
  const jitter = read("statusJitterRatio", true)
  if (jitter !== undefined && jitter <= 1) timing.jitterRatio = jitter
  return Object.keys(timing).length === 0 ? undefined : timing
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
