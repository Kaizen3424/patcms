import { expect, type Page, test } from "@playwright/test"
import { installOriginAllowlist } from "../support/origin-allowlist"

/**
 * P2.10 token death journey (INV-A01):
 *
 * A 401 write failure mid-batch pauses the coordinator without throwing away
 * the active job, keeps IndexedDB drafts intact, displays the docked failure card
 * and in-place re-auth sheet, allows the founder to probe and supply a renewed access key,
 * and resumes the active save in-place to completion.
 */

const PRODUCT_PATH = "src/content/products/the-rock-pendant.json"

interface Harness {
  readFile(path: string): string | null
  commitCount(): number
  head(): string | undefined
  readonly requestLog: readonly { readonly method: string; readonly status: number }[]
}

test("mid-batch 401 write -> docked failure card + re-auth sheet -> probe invalid -> supply valid -> resumes in-place to saved", async ({
  baseURL,
  page,
}) => {
  if (baseURL === undefined) throw new Error("playwright config must set use.baseURL")
  const origins = await installOriginAllowlist(page, new URL(baseURL).origin)

  // Mount against MSW FakeGithub configured to expire token on write
  await page.goto("/?tokenChaos=expire-on-write")
  await expect(page.getByRole("heading", { name: "Content studio" })).toBeVisible({
    timeout: 15_000,
  })

  // Sign in with initial token
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

  await expect(bar).toHaveAttribute("data-status", "clean")
  await expect(material).toHaveValue("Wool felt · Leather")
  await expect(save).toBeDisabled()

  const commitsBefore = await commitCount(page)
  const headBefore = await head(page)

  // Founder makes an edit
  await material.fill("Wool felt · Leather (token death test)")
  await expect(bar).toHaveAttribute("data-status", "dirty")
  await expect(save).toBeEnabled()

  // Save changes — write hits 401 chaos
  await save.click()

  // SaveBar transitions to authExpired state
  await expect(bar).toHaveAttribute("data-status", "authExpired", { timeout: 15_000 })
  await expect(bar.getByText("Access key needs checking")).toBeVisible()

  // Docked FailureCard renders directly above SaveBar
  const failureCard = page.getByTestId("failure-card")
  await expect(failureCard).toBeVisible()
  await expect(failureCard.getByText("Your access key needs checking.")).toBeVisible()
  await expect(failureCard.getByText("Your changes are kept on this device.")).toBeVisible()

  // ReauthSheet dialog opens
  const sheet = page.getByTestId("reauth-sheet")
  await expect(sheet).toBeVisible()
  const sheetInput = sheet.getByLabel("Access key")
  const sheetSubmit = sheet.getByRole("button", { name: "Check key and save" })

  // 1. Probe invalid token
  await sheetInput.fill("invalid_key")
  await sheetSubmit.click()

  // ReauthSheet shows inline probe rejection
  await expect(
    sheet.getByText("This access key could not be verified. Check the key and its permissions."),
  ).toBeVisible()
  await expect(sheet).toBeVisible()

  // 2. Supply valid renewed token
  await sheetInput.fill("github_pat_renewed")
  await sheetSubmit.click()

  // ReauthSheet closes, save coordinator resumes in-place without page reload
  await expect(sheet).not.toBeVisible({ timeout: 10_000 })

  // Save completes successfully
  await expect(bar).toHaveAttribute("data-status", "saved", { timeout: 15_000 })
  await expect(bar.getByText("Saved.")).toBeVisible()

  // Failure card disappears once save completes
  await expect(failureCard).not.toBeVisible()

  // Exactly one new commit was written to the repo
  expect(await commitCount(page)).toBe(commitsBefore + 1)
  expect(await head(page)).not.toBe(headBefore)

  // Written content contains our words
  const bytes = await readRepoFile(page, PRODUCT_PATH)
  const saved = JSON.parse(bytes) as Record<string, unknown>
  expect(saved.material).toBe("Wool felt · Leather (token death test)")

  expect(origins.violations()).toEqual([])
})

async function commitCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    const harness = (globalThis as unknown as { __mycmsHarness?: Harness }).__mycmsHarness
    if (harness === undefined) throw new Error("e2e harness missing on window")
    return harness.commitCount()
  })
}

async function head(page: Page): Promise<string | undefined> {
  return page.evaluate(() => {
    const harness = (globalThis as unknown as { __mycmsHarness?: Harness }).__mycmsHarness
    if (harness === undefined) throw new Error("e2e harness missing on window")
    return harness.head()
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
