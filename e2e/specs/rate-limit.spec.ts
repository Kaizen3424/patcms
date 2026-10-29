import { expect, type Page, test } from "@playwright/test"
import { installOriginAllowlist } from "../support/origin-allowlist"

/**
 * P2.10 primary rate limit countdown journey (INV-N01):
 *
 * Primary rate limit exhaustion (429 with retry-after) displays a live countdown
 * UI calculated from absolute target epoch, screen-reader friendly milestone
 * announcements, auto-wake event-driven resume on expiration, and a manual
 * "Try saving now" override button.
 */

const PRODUCT_PATH = "src/content/products/the-rock-pendant.json"

interface Harness {
  readFile(path: string): string | null
  commitCount(): number
  head(): string | undefined
  readonly requestLog: readonly { readonly method: string; readonly status: number }[]
}

test("primary rate limit -> live countdown UI -> auto-wake event-driven resume to saved", async ({
  baseURL,
  page,
}) => {
  if (baseURL === undefined) throw new Error("playwright config must set use.baseURL")
  const origins = await installOriginAllowlist(page, new URL(baseURL).origin)

  // Mount against MSW FakeGithub configured to return 429 with Retry-After: 4
  await page.goto("/?rateLimitWrite=4")
  await expect(page.getByRole("heading", { name: "Content studio" })).toBeVisible({
    timeout: 15_000,
  })

  // Sign in
  await page.getByLabel("Access key").fill("github_pat_e2e_fixture")
  await page.getByRole("button", { name: "Continue" }).click()

  // Open entry
  await page
    .getByRole("link", { name: /^Products/ })
    .first()
    .click()
  await page
    .getByRole("link", { name: /^The Rock Pendant/ })
    .first()
    .click()
  await expect(page.getByRole("heading", { level: 1, name: "The Rock Pendant" })).toBeVisible()

  const bar = page.getByTestId("save-bar")
  const save = page.getByRole("button", { name: "Save changes" })
  const material = page.getByLabel("Material", { exact: true })

  const commitsBefore = await commitCount(page)

  // Edit field
  await material.fill("Wool felt · Leather (rate limit auto-resume)")
  await expect(bar).toHaveAttribute("data-status", "dirty")
  await expect(save).toBeEnabled()

  // Trigger save — hits 429 quota chaos
  await save.click()

  // Rate limit countdown UI appears
  const timer = page.getByTestId("rate-limit-timer")
  await expect(timer).toBeVisible({ timeout: 10_000 })
  await expect(bar.getByText("The site is busy right now.")).toBeVisible()
  await expect(timer.getByRole("button", { name: "Try saving now" })).toBeVisible()

  // Auto-wake resumes save once countdown elapses (4 seconds)
  await expect(bar).toHaveAttribute("data-status", "saved", { timeout: 15_000 })
  await expect(bar.getByText("Saved.")).toBeVisible()

  // RateLimitTimer clears on completion
  await expect(timer).not.toBeVisible()

  // Commit was recorded
  expect(await commitCount(page)).toBe(commitsBefore + 1)
  const bytes = await readRepoFile(page, PRODUCT_PATH)
  const saved = JSON.parse(bytes) as Record<string, unknown>
  expect(saved.material).toBe("Wool felt · Leather (rate limit auto-resume)")

  expect(origins.violations()).toEqual([])
})

test("primary rate limit -> manual override 'Try saving now' immediately resumes save", async ({
  baseURL,
  page,
}) => {
  if (baseURL === undefined) throw new Error("playwright config must set use.baseURL")
  const origins = await installOriginAllowlist(page, new URL(baseURL).origin)

  // Mount with long wait time (20s) so manual override is verified before timer expires
  await page.goto("/?rateLimitWrite=20")
  await expect(page.getByRole("heading", { name: "Content studio" })).toBeVisible({
    timeout: 15_000,
  })

  // Sign in
  await page.getByLabel("Access key").fill("github_pat_e2e_fixture")
  await page.getByRole("button", { name: "Continue" }).click()

  // Open entry
  await page
    .getByRole("link", { name: /^Products/ })
    .first()
    .click()
  await page
    .getByRole("link", { name: /^The Rock Pendant/ })
    .first()
    .click()
  await expect(page.getByRole("heading", { level: 1, name: "The Rock Pendant" })).toBeVisible()

  const bar = page.getByTestId("save-bar")
  const save = page.getByRole("button", { name: "Save changes" })
  const material = page.getByLabel("Material", { exact: true })

  const commitsBefore = await commitCount(page)

  // Edit field
  await material.fill("Wool felt · Leather (rate limit manual override)")
  await expect(bar).toHaveAttribute("data-status", "dirty")
  await expect(save).toBeEnabled()

  // Trigger save — hits 429 quota chaos
  await save.click()

  // Rate limit countdown UI appears
  const timer = page.getByTestId("rate-limit-timer")
  await expect(timer).toBeVisible({ timeout: 10_000 })
  await expect(bar.getByText("The site is busy right now.")).toBeVisible()

  // Click manual override button immediately
  const tryNowButton = timer.getByRole("button", { name: "Try saving now" })
  await expect(tryNowButton).toBeVisible()
  await tryNowButton.click()

  // Resumes immediately and completes without waiting 20s
  await expect(bar).toHaveAttribute("data-status", "saved", { timeout: 10_000 })
  await expect(bar.getByText("Saved.")).toBeVisible()

  // Commit was recorded
  expect(await commitCount(page)).toBe(commitsBefore + 1)
  const bytes = await readRepoFile(page, PRODUCT_PATH)
  const saved = JSON.parse(bytes) as Record<string, unknown>
  expect(saved.material).toBe("Wool felt · Leather (rate limit manual override)")

  expect(origins.violations()).toEqual([])
})

async function commitCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    const harness = (globalThis as unknown as { __mycmsHarness?: Harness }).__mycmsHarness
    if (harness === undefined) throw new Error("e2e harness missing on window")
    return harness.commitCount()
  })
}

async function readRepoFile(page: Page, path: string): Promise<string> {
  return page.evaluate((evaluatedPath) => {
    const harness = (globalThis as unknown as { __mycmsHarness?: Harness }).__mycmsHarness
    if (harness === undefined) throw new Error("e2e harness missing on window")
    const bytes = harness.readFile(evaluatedPath)
    if (bytes === null) throw new Error(`file ${evaluatedPath} not found in fake repo`)
    return bytes
  }, path)
}
