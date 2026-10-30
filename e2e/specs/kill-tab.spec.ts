import { expect, type Page, test } from "@playwright/test"
import { readIdbDraft } from "../support/idb"
import { installOriginAllowlist } from "../support/origin-allowlist"

/**
 * INV-P12 — Crash-recovery replay e2e journey (L2):
 *
 *  1. canon-diff -> offer: Unsaved edits survive tab kill (written to IDB pre-network);
 *     reopening the entry adjudicates `offer`, displays the recovery banner, restores
 *     the user's edits, and deletes the draft only post-ref-verify.
 *  2. equal -> discard: A pre-armed draft matching the remote head is silently deleted
 *     from IDB on mount with zero recovery banners and a clean form.
 *  3. draft deleted ONLY post-ref-verify: Draft remains in IDB while editing and during
 *     in-flight processing; only purged once updateRef succeeds.
 */

const PRODUCT_PATH = "src/content/products/the-rock-pendant.json"
const DRAFT_KEY = "demo/products/the-rock-pendant"

// Two-tab journeys under parallel worker load (ADR-0004 lease/kill-tab recipe).
test.setTimeout(120_000)

interface Harness {
  readFile(path: string): string | null
  commitCount(): number
  head(): string | undefined
  readonly requestLog: readonly { readonly method: string; readonly status: number }[]
}

test("INV-P12 canon-diff -> offer: unsaved edit survives tab close, offers recovery on reopen, saves and deletes draft", async ({
  browser,
  baseURL,
}) => {
  test.slow()
  if (baseURL === undefined) throw new Error("playwright config must set use.baseURL")
  const origin = new URL(baseURL).origin
  const context = await browser.newContext()

  // Tab 1: Start editing and trigger IDB debounce
  const tab1 = await context.newPage()
  const guard1 = await installOriginAllowlist(tab1, origin)

  await tab1.goto("/")
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
  await material.fill("Wool felt · Leather (crash recovery test)")

  // Wait past the 800ms draft debounce
  await tab1.waitForTimeout(1100)

  // Verify draft exists in IndexedDB before tab death
  const draftBefore = await readIdbDraft(tab1, DRAFT_KEY)
  expect(draftBefore).toBeDefined()
  const payloadBefore = (draftBefore as { value?: { formValue?: { material?: string } } })?.value
  expect(payloadBefore?.formValue?.material).toBe("Wool felt · Leather (crash recovery test)")

  // Abruptly kill Tab 1
  await tab1.close()

  // Tab 2: Reopen in same browser context (PAT remembered in IDB)
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

  // Boot adjudication caught the draft: BootBanner appears
  const bootBanner = tab2.getByTestId("boot-offer")
  await expect(bootBanner).toBeVisible({ timeout: 15_000 })
  await expect(bootBanner.getByText("We found unsaved changes on this device.")).toBeVisible()

  // Restore unsaved changes
  const restoreButton = bootBanner.getByRole("button", { name: "Restore changes" })
  await restoreButton.click()

  // Form rebinds with recovered edits and Save bar becomes dirty
  const tab2Material = tab2.getByLabel("Material", { exact: true })
  await expect(tab2Material).toHaveValue("Wool felt · Leather (crash recovery test)")
  const bar = tab2.getByTestId("save-bar")
  await expect(bar).toHaveAttribute("data-status", "dirty")

  const commitsBefore = await commitCount(tab2)

  // Save changes
  const save = tab2.getByRole("button", { name: "Save changes" })
  await save.click()
  await expect(bar).toHaveAttribute("data-status", "saved", { timeout: 15_000 })
  await expect(bar.getByText("Saved.")).toBeVisible()

  // Verified commit in Git
  expect(await commitCount(tab2)).toBe(commitsBefore + 1)
  const bytes = await readRepoFile(tab2, PRODUCT_PATH)
  const saved = JSON.parse(bytes) as Record<string, unknown>
  expect(saved.material).toBe("Wool felt · Leather (crash recovery test)")

  // Draft is deleted post-ref-verify
  const draftAfter = await readIdbDraft(tab2, DRAFT_KEY)
  expect(draftAfter).toBeUndefined()

  expect(guard1.violations()).toEqual([])
  expect(guard2.violations()).toEqual([])
  await context.close()
})

test("INV-P12 equal -> discard: draft matching remote head is silently deleted with clean form and zero banner", async ({
  baseURL,
  page,
}) => {
  if (baseURL === undefined) throw new Error("playwright config must set use.baseURL")
  const origins = await installOriginAllowlist(page, new URL(baseURL).origin)

  // Mount with ?bootDraftDemo=equal (seeds matching remote commit and local draft)
  await page.goto("/?bootDraftDemo=equal")
  await expect(page.getByRole("heading", { name: "Content studio" })).toBeVisible({
    timeout: 15_000,
  })
  await page.getByLabel("Access key").fill("github_pat_e2e_fixture")
  await page.getByRole("button", { name: "Continue" }).click()

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
  const material = page.getByLabel("Material", { exact: true })

  // Head content is already live
  await expect(material).toHaveValue("Wool felt · Leather (already live on site)")

  // No boot-offer banner rendered
  await expect(page.getByTestId("boot-offer")).not.toBeVisible()

  // SaveBar remains clean
  await expect(bar).toHaveAttribute("data-status", "clean")

  // Draft is silently purged from IDB
  const draft = await readIdbDraft(page, DRAFT_KEY)
  expect(draft).toBeUndefined()

  expect(origins.violations()).toEqual([])
})

test("INV-P12 draft deleted ONLY post-ref-verify: draft retained on device during dirty editing", async ({
  baseURL,
  page,
}) => {
  if (baseURL === undefined) throw new Error("playwright config must set use.baseURL")
  const origins = await installOriginAllowlist(page, new URL(baseURL).origin)

  await page.goto("/")
  await expect(page.getByRole("heading", { name: "Content studio" })).toBeVisible({
    timeout: 15_000,
  })
  await page.getByLabel("Access key").fill("github_pat_e2e_fixture")
  await page.getByRole("button", { name: "Continue" }).click()

  await page
    .getByRole("link", { name: /^Products/ })
    .first()
    .click()
  await page
    .getByRole("link", { name: /^The Rock Pendant/ })
    .first()
    .click()
  await expect(page.getByRole("heading", { level: 1, name: "The Rock Pendant" })).toBeVisible()

  // Initially, no draft in IDB
  expect(await readIdbDraft(page, DRAFT_KEY)).toBeUndefined()

  const material = page.getByLabel("Material", { exact: true })
  await material.fill("Wool felt · Leather (persistence lifecycle check)")

  // Wait for 800ms debounce
  await page.waitForTimeout(1100)

  // Draft exists while form is dirty
  const draftDuringEdit = await readIdbDraft(page, DRAFT_KEY)
  expect(draftDuringEdit).toBeDefined()

  // Save changes
  const save = page.getByRole("button", { name: "Save changes" })
  await save.click()
  const bar = page.getByTestId("save-bar")
  await expect(bar).toHaveAttribute("data-status", "saved", { timeout: 15_000 })

  // Draft is deleted only after published verdict
  expect(await readIdbDraft(page, DRAFT_KEY)).toBeUndefined()

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
  const raw = await page.evaluate((filePath) => {
    const harness = (globalThis as unknown as { __mycmsHarness?: Harness }).__mycmsHarness
    if (harness === undefined) throw new Error("e2e harness missing on window")
    return harness.readFile(filePath)
  }, path)
  if (raw === null) throw new Error(`harness: ${path} is missing from the fake repo`)
  return raw
}
