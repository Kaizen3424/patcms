import { expect, type Page, test } from "@playwright/test"
import { readIdbDraft } from "../support/idb"
import { installOriginAllowlist } from "../support/origin-allowlist"

/**
 * Parked transaction recovery journey (INV-P11 / INV-N01):
 *
 * An in-flight save encountering a 429 quota exhaustion enters a parked state.
 * Because the draft was persisted to IndexedDB BEFORE the first network call (INV-P11),
 * killing the tab mid-pause leaves the draft intact. When the founder reopens the
 * entry in a fresh tab, boot adjudication replays the surviving draft as an `offer`,
 * allowing the founder to restore their changes and publish cleanly.
 */

const PRODUCT_PATH = "src/content/products/the-rock-pendant.json"
const DRAFT_KEY = "demo/products/the-rock-pendant"

// Two-tab journey under parallel worker load (ADR-0004 lease/kill-tab recipe).
test.setTimeout(120_000)

interface Harness {
  readFile(path: string): string | null
  commitCount(): number
  head(): string | undefined
  readonly requestLog: readonly { readonly method: string; readonly status: number }[]
}

test("parked tx recovery: 429 quota pause -> tab killed mid-pause -> reopen restores draft as offer -> publishes cleanly", async ({
  browser,
  baseURL,
}) => {
  test.slow()
  if (baseURL === undefined) throw new Error("playwright config must set use.baseURL")
  const origin = new URL(baseURL).origin
  const context = await browser.newContext()

  // Tab 1: Mount with rate-limit quota chaos on write (Retry-After: 60s)
  const tab1 = await context.newPage()
  const guard1 = await installOriginAllowlist(tab1, origin)

  await tab1.goto("/?rateLimitWrite=60")
  await expect(tab1.getByRole("heading", { name: "Content studio" })).toBeVisible({
    timeout: 15_000,
  })
  await tab1.getByLabel("Access key").fill("github_pat_e2e_fixture")
  await tab1.getByRole("button", { name: "Continue" }).click()

  await tab1
    .getByRole("link", { name: /^Products/ })
    .first()
    .click()
  await tab1
    .getByRole("link", { name: /^The Rock Pendant/ })
    .first()
    .click()
  await expect(tab1.getByRole("heading", { level: 1, name: "The Rock Pendant" })).toBeVisible()

  const material = tab1.getByLabel("Material", { exact: true })
  await material.fill("Wool felt · Leather (parked tx kill tab test)")

  const bar = tab1.getByTestId("save-bar")
  const save = tab1.getByRole("button", { name: "Save changes" })
  await expect(bar).toHaveAttribute("data-status", "dirty")
  await expect(save).toBeEnabled()

  // Save changes — write hits 429 quota chaos and enters paused(quota)
  await save.click()

  // RateLimitTimer appears and SaveBar transitions to busy state
  const timer = tab1.getByTestId("rate-limit-timer")
  await expect(timer).toBeVisible({ timeout: 10_000 })
  await expect(bar.getByText("The site is busy right now.")).toBeVisible()

  // Draft was written to IDB before the network call
  const draftBefore = await readIdbDraft(tab1, DRAFT_KEY)
  expect(draftBefore).toBeDefined()

  // Abruptly kill Tab 1 while transaction is parked
  await tab1.close()

  // Tab 2: Reopen in same browser context
  const tab2 = await context.newPage()
  const guard2 = await installOriginAllowlist(tab2, origin)

  await tab2.goto("/")
  await expect(tab2.getByRole("navigation", { name: "Content folders" })).toBeVisible({
    timeout: 15_000,
  })

  await tab2
    .getByRole("link", { name: /^Products/ })
    .first()
    .click()
  await tab2
    .getByRole("link", { name: /^The Rock Pendant/ })
    .first()
    .click()
  await expect(tab2.getByRole("heading", { level: 1, name: "The Rock Pendant" })).toBeVisible()

  // Boot adjudication replays the parked draft as an offer
  const bootBanner = tab2.getByTestId("boot-offer")
  await expect(bootBanner).toBeVisible({ timeout: 15_000 })
  await expect(bootBanner.getByText("We found unsaved changes on this device.")).toBeVisible()

  // Restore unsaved changes
  const restoreButton = bootBanner.getByRole("button", { name: "Restore changes" })
  await restoreButton.click()

  // Form value restored, SaveBar is dirty
  const tab2Material = tab2.getByLabel("Material", { exact: true })
  await expect(tab2Material).toHaveValue("Wool felt · Leather (parked tx kill tab test)")
  const tab2Bar = tab2.getByTestId("save-bar")
  await expect(tab2Bar).toHaveAttribute("data-status", "dirty")

  const commitsBefore = await commitCount(tab2)

  // Save now succeeds
  const tab2Save = tab2.getByRole("button", { name: "Save changes" })
  await tab2Save.click()
  await expect(tab2Bar).toHaveAttribute("data-status", "saved", { timeout: 15_000 })
  await expect(tab2Bar.getByText("Saved.")).toBeVisible()

  // 1 commit landed
  expect(await commitCount(tab2)).toBe(commitsBefore + 1)
  const bytes = await readRepoFile(tab2, PRODUCT_PATH)
  const saved = JSON.parse(bytes) as Record<string, unknown>
  expect(saved.material).toBe("Wool felt · Leather (parked tx kill tab test)")

  // Draft deleted post-ref-verify
  expect(await readIdbDraft(tab2, DRAFT_KEY)).toBeUndefined()

  expect(guard1.violations()).toEqual([])
  expect(guard2.violations()).toEqual([])
  await context.close()
})

async function commitCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    const harness = (globalThis as unknown as { __mycmsHarness?: Harness }).__mycmsHarness
    if (harness === undefined) throw new Error("e2e harness missing on window")
    return harness.commitCount()
  })
}

async function readRepoFile(page: Page, path: string): Promise<string> {
  const raw = await page.evaluate((filePath) => {
    const harness = (globalThis as unknown as { __mycmsHarness?: Harness }).__mycmsHarness
    if (harness === undefined) throw new Error("e2e harness missing on window")
    return harness.readFile(filePath)
  }, path)
  if (raw === null) throw new Error(`harness: ${path} is missing from the fake repo`)
  return raw
}
