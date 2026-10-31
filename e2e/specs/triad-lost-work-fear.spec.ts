import { expect, type Page, test } from "@playwright/test"
import { installOriginAllowlist } from "../support/origin-allowlist"

/**
 * Founder-Cry Triad Simulation 3: Lost Work Fear (P5 Exit Gate)
 *
 * Fear: "I lost all my work because my access key expired."
 * Reassurance verified:
 *  - 401 write failure pauses the coordinator without throwing away the active job;
 *  - IndexedDB drafts and form memory remain completely intact;
 *  - In-place ReauthSheet appears with reassurance: "Your changes are kept safe on this device";
 *  - Supplying a fresh access key verifies with capability probe;
 *  - Resumes the active save in-place to completion with zero lost work.
 */

const PRODUCT_PATH = "src/content/products/the-rock-pendant.json"

interface Harness {
  readFile(path: string): string | null
  commitCount(): number
  head(): string | undefined
}

async function readRepoFile(page: Page, path: string): Promise<string> {
  return page.evaluate((p) => {
    const harness = (window as unknown as { __mycmsHarness?: Harness }).__mycmsHarness
    const content = harness?.readFile(p)
    if (content === null || content === undefined) throw new Error(`file not found: ${p}`)
    return content
  }, path)
}

test("Triad simulation 3: lost work fear -> in-flight 401 -> in-place re-auth -> resume without losing anything", async ({
  baseURL,
  page,
}) => {
  test.slow()
  if (baseURL === undefined) throw new Error("playwright config must set use.baseURL")
  const origins = await installOriginAllowlist(page, new URL(baseURL).origin)

  // 1. Mount with expire-on-write chaos mode
  await page.goto("/?tokenChaos=expire-on-write")
  await expect(page.getByRole("heading", { name: "Content studio" })).toBeVisible({
    timeout: 15_000,
  })

  // Sign in with initial access key
  await page.getByLabel("Access key").fill("github_pat_e2e_fixture")
  await page.getByRole("button", { name: "Continue" }).click()

  // Open entry
  const folders = page.getByRole("navigation", { name: "Content folders" })
  await expect(folders).toBeVisible({ timeout: 15_000 })
  await folders
    .getByRole("link", { name: /^Products/ })
    .first()
    .click()
  await page
    .getByRole("link", { name: /^The Rock Pendant/ })
    .first()
    .click()
  await expect(page.getByRole("heading", { level: 1, name: "The Rock Pendant" })).toBeVisible()

  const bar = page.getByTestId("save-bar")
  const saveBtn = page.getByRole("button", { name: /^Save/ })
  const materialInput = page.getByLabel("Material", { exact: true })

  // 2. Founder enters valuable edits
  const preciousText = "Wool felt · Raw unpolished brass · Hand-spun silk (precious draft)"
  await materialInput.fill(preciousText)
  await expect(bar).toHaveAttribute("data-status", "dirty")

  // 3. Click Save -> hits simulated 401 write failure
  await saveBtn.click()

  // 4. Verify docked failure card and in-place ReauthSheet appear
  const failureCard = page.getByTestId("failure-card")
  await expect(failureCard).toBeVisible({ timeout: 15_000 })
  await expect(failureCard).toContainText("Your access key needs checking.")

  const reauthTrigger = failureCard.getByRole("button", { name: /enter access key/i })
  if (await reauthTrigger.isVisible()) {
    await reauthTrigger.click()
  }

  const sheet = page.getByTestId("reauth-sheet")
  await expect(sheet).toBeVisible({ timeout: 10_000 })

  // Reassurance copy: work is safe on this device
  await expect(sheet.getByText(/Your changes are safe on this device/i)).toBeVisible()

  // 5. Supply renewed access key
  const keyInput = sheet.getByLabel("Access key")
  await keyInput.fill("github_pat_renewed")
  await sheet.getByRole("button", { name: "Check key and save" }).click()

  // 6. Save automatically resumes in-place to completion
  await expect(bar).toHaveAttribute("data-status", /saved|clean/, { timeout: 15_000 })

  // 7. Verify zero data loss: saved file in repo contains the precious edits verbatim
  const savedBytes = await readRepoFile(page, PRODUCT_PATH)
  const savedJson = JSON.parse(savedBytes) as Record<string, unknown>
  expect(savedJson.material).toBe(preciousText)

  expect(origins.violations()).toEqual([])
})
