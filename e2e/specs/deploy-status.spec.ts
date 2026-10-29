import { expect, type Page, test } from "@playwright/test"
import { installOriginAllowlist } from "../support/origin-allowlist"

/**
 * P2.8 deploy-status journeys (L2 - ADR-0008 P2.8 appendix): the founder sees
 * honest site truth after a save, never a spinner loop and never a raw
 * dashboard. Four terminal paths are pinned here:
 *
 *  - a decisive success run paints the banner "live";
 *  - no run inside the configured grace degrades to "unavailable" with its
 *    cause hint (her words are saved, never blamed);
 *  - a failing run links THAT run, not a dashboard;
 *  - when the head moves on, an entry's chip keeps ITS commit's truth and
 *    annotates the newer head instead of repainting (INV-D03).
 *
 * The playground URL carries the six status-timing seams; every journey runs
 * at 200ms polls with zero jitter so results are observed, not waited out.
 */

const ACCESS_KEY = "github_pat_e2e_fixture"
const FAILURE_URL = "https://github.com/example/run/7"
const MATERIAL = "Material"
const MATERIAL_EDITED = "Wool felt · Leather (status journey)"

type RunStatus = "queued" | "in_progress" | "completed" | "pending" | "requested" | "waiting"
type RunConclusion =
  | "success"
  | "failure"
  | "neutral"
  | "cancelled"
  | "skipped"
  | "timed_out"
  | "action_required"
  | "stale"

interface FakeRun {
  readonly id?: number
  readonly name?: string
  readonly status?: RunStatus
  readonly conclusion?: RunConclusion | null
  readonly detailsUrl?: string
}

/** Mirror of the harness surface this spec drives (playground/src/harness.ts). */
interface Harness {
  readonly server: {
    setCheckRuns(sha: string, runs: readonly FakeRun[]): void
    setRef(branch: string, sha: string): void
  }
  readonly defaultBranch: string
  head(): string | undefined
}

/** The six cadence seams, fast enough for a journey, jitter off. */
function timing(options: { readonly graceMs?: number } = {}): string {
  return new URLSearchParams({
    statusFastPollMs: "200",
    statusSlowPollMs: "200",
    statusFastWindowMs: "60000",
    statusGraceMs: String(options.graceMs ?? 60_000),
    statusMaxWatchMs: "60000",
    statusJitterRatio: "0",
  }).toString()
}

test("a decisive success run paints the site banner live", async ({ baseURL, page }) => {
  if (baseURL === undefined) throw new Error("playwright config must set use.baseURL")
  const origins = await installOriginAllowlist(page, new URL(baseURL).origin)

  await boot(page, timing())
  const sha = await head(page)
  await setCheckRuns(page, sha, [{ name: "site", status: "completed", conclusion: "success" }])
  await signIn(page)

  const banner = page.getByTestId("deploy-status-banner")
  await expect(banner).toHaveAttribute("data-status-kind", "live", { timeout: 15_000 })
  await expect(banner).toContainText("The public site is up to date.")

  expect(origins.violations()).toEqual([])
})

test("no result inside the grace turns into the honest unavailable line", async ({
  baseURL,
  page,
}) => {
  if (baseURL === undefined) throw new Error("playwright config must set use.baseURL")
  const origins = await installOriginAllowlist(page, new URL(baseURL).origin)

  // The fixture head carries no run: the watcher has only its grace to go on.
  await boot(page, timing({ graceMs: 1_500 }))
  await signIn(page)

  const banner = page.getByTestId("deploy-status-banner")
  await expect(banner).toHaveAttribute("data-status-kind", "unavailable", { timeout: 15_000 })
  await expect(banner).toContainText("Status unavailable — your words are saved.")
  await expect(banner).toContainText("We have not seen a result yet — give it a little longer.")

  expect(origins.violations()).toEqual([])
})

test("a failing run links that run, not a raw dashboard", async ({ baseURL, page }) => {
  if (baseURL === undefined) throw new Error("playwright config must set use.baseURL")
  const origins = await installOriginAllowlist(page, new URL(baseURL).origin)

  await boot(page, timing())
  const sha = await head(page)
  await setCheckRuns(page, sha, [
    {
      id: 7,
      name: "site",
      status: "completed",
      conclusion: "failure",
      detailsUrl: FAILURE_URL,
    },
  ])
  await signIn(page)

  const banner = page.getByTestId("deploy-status-banner")
  await expect(banner).toHaveAttribute("data-status-kind", "failed", { timeout: 15_000 })
  await expect(banner).toContainText("The public site did not update.")
  await expect(banner.getByRole("link", { name: "Details" })).toHaveAttribute("href", FAILURE_URL)

  expect(origins.violations()).toEqual([])
})

test("a save's chip is annotated when the head moves on", async ({ baseURL, page }) => {
  if (baseURL === undefined) throw new Error("playwright config must set use.baseURL")
  const origins = await installOriginAllowlist(page, new URL(baseURL).origin)

  await boot(page, timing())
  const baseHead = await head(page)
  await signIn(page)

  const folders = page.getByRole("navigation", { name: "Content folders" })
  await folders
    .getByRole("link", { name: /^Products/ })
    .first()
    .click()
  await page
    .getByRole("link", { name: /^The Rock Pendant/ })
    .first()
    .click()
  await expect(page.getByRole("heading", { level: 1, name: "The Rock Pendant" })).toBeVisible()

  await page.getByLabel(MATERIAL, { exact: true }).fill(MATERIAL_EDITED)
  await page.getByRole("button", { name: "Save changes" }).click()
  await expect(page.getByTestId("save-bar")).toHaveAttribute("data-status", "saved", {
    timeout: 15_000,
  })

  // The journal keys the chip to the commit this save produced.
  const chip = page.getByTestId("deploy-status-chip")
  await expect(chip).toBeVisible({ timeout: 15_000 })
  await expect(chip).toHaveAttribute("data-status-kind", "awaiting")

  // Someone else moves the site on. The chip keeps ITS commit's truth and
  // annotates the newer head; a late run never repaints newer state (INV-D03).
  await setRef(page, baseHead)

  await expect(chip).toContainText("A newer save is live.", { timeout: 15_000 })
  await expect(chip).toContainText("Waiting for the public site to start updating.")

  expect(origins.violations()).toEqual([])
})

async function boot(page: Page, query: string): Promise<void> {
  await page.goto(`/?${query}`)
  await expect(page.getByRole("heading", { level: 1, name: "Content studio" })).toBeVisible({
    timeout: 15_000,
  })
}

async function signIn(page: Page): Promise<void> {
  await page.getByLabel("Access key").fill(ACCESS_KEY)
  await page.getByRole("button", { name: "Continue" }).click()
  await expect(page.getByRole("navigation", { name: "Content folders" })).toBeVisible({
    timeout: 15_000,
  })
}

async function head(page: Page): Promise<string> {
  const sha = await page.evaluate(() => {
    const harness = (globalThis as unknown as { __mycmsHarness?: Harness }).__mycmsHarness
    if (harness === undefined) throw new Error("e2e harness missing on window")
    return harness.head()
  })
  if (sha === undefined) throw new Error("fake repo has no head")
  return sha
}

async function setCheckRuns(page: Page, sha: string, runs: readonly FakeRun[]): Promise<void> {
  await page.evaluate(
    (input: { readonly sha: string; readonly runs: readonly FakeRun[] }) => {
      const harness = (globalThis as unknown as { __mycmsHarness?: Harness }).__mycmsHarness
      if (harness === undefined) throw new Error("e2e harness missing on window")
      harness.server.setCheckRuns(input.sha, input.runs)
    },
    { sha, runs },
  )
}

async function setRef(page: Page, sha: string): Promise<void> {
  await page.evaluate((target: string) => {
    const harness = (globalThis as unknown as { __mycmsHarness?: Harness }).__mycmsHarness
    if (harness === undefined) throw new Error("e2e harness missing on window")
    harness.server.setRef(harness.defaultBranch, target)
  }, sha)
}
