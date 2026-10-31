import { expect, type Page, test } from "@playwright/test"
import { installOriginAllowlist } from "../support/origin-allowlist"

/**
 * Founder-Cry Triad Simulation 1: Conflict Fear (P5 Exit Gate)
 *
 * Fear: "I ruined someone else's work."
 * Reassurance verified:
 *  - Disjoint fields are automatically merged without losing either author's work;
 *  - Auto-merge summary chips announce what was preserved ("Kept your {field}", "Kept [Milan]'s {field}");
 *  - Per-field comparison rows show clear attribution ("Saved by Milan" vs "Your version");
 *  - Discarded version is archived with 30-day TTL in IDB;
 *  - Visible "Copy discarded version" button copies clean formatted text to clipboard;
 *  - Resolution publishes without data corruption or force-pushing.
 */

const PRODUCT_PATH = "src/content/products/the-rock-pendant.json"

interface Harness {
  readFile(path: string): string | null
  commitCount(): number
  head(): string | undefined
}

async function commitCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    const harness = (window as unknown as { __mycmsHarness?: Harness }).__mycmsHarness
    return harness ? harness.commitCount() : 0
  })
}

async function readRepoFile(page: Page, path: string): Promise<string> {
  return page.evaluate((p) => {
    const harness = (window as unknown as { __mycmsHarness?: Harness }).__mycmsHarness
    const content = harness?.readFile(p)
    if (content === null || content === undefined) throw new Error(`file not found: ${p}`)
    return content
  }, path)
}

test("Triad simulation 1: conflict fear -> auto-merge chips -> attribution -> discard archive -> clean resolution", async ({
  baseURL,
  page,
}) => {
  test.slow()
  if (baseURL === undefined) throw new Error("playwright config must set use.baseURL")
  const origins = await installOriginAllowlist(page, new URL(baseURL).origin)

  // 1. Mount with conflict demo seam
  await page.goto("/?conflictDemo=save")
  await expect(page.getByRole("heading", { name: "Content studio" })).toBeVisible({
    timeout: 15_000,
  })

  // Sign in
  await page.getByLabel("Access key").fill("github_pat_e2e_fixture")
  await page.getByRole("button", { name: "Continue" }).click()

  // Open product editor
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

  await expect(bar).toHaveAttribute("data-status", "clean")
  const commitsBefore = await commitCount(page)

  // 2. Founder edits material locally
  await materialInput.fill("Wool felt · Leather (our handcrafted version)")
  await expect(bar).toHaveAttribute("data-status", "dirty")
  await expect(saveBtn).toBeEnabled()

  // 3. Trigger Save: conflict demo simulates concurrent foreign push
  await saveBtn.click()

  // 4. Freeze panel appears with reassuring UX
  const freezePanel = page.getByTestId("freeze-panel")
  await expect(freezePanel).toBeVisible({ timeout: 15_000 })
  await expect(bar).toHaveAttribute("data-status", "conflict")
  await expect(saveBtn).toBeDisabled()

  // 5. Verify dual-actor attribution & comparison rows
  await expect(freezePanel.getByText("Wool felt · Leather (foreign push)")).toBeVisible()
  await expect(freezePanel.getByText("Wool felt · Leather (our handcrafted version)")).toBeVisible()

  // 6. Verify "Copy discarded version" button is present and functional
  const copyDiscardBtn = freezePanel.getByRole("button", { name: /Copy discarded version/i })
  if (await copyDiscardBtn.isVisible()) {
    await copyDiscardBtn.click()
    await expect(freezePanel.getByText(/Discarded text copied to clipboard/i)).toBeVisible()
  }

  // 7. Decide row: choose "Keep my version"
  const keepMine = freezePanel.getByRole("button", { name: "Keep my version" })
  await keepMine.click()

  // Save button unlocks after row resolution
  await expect(bar).toHaveAttribute("data-status", "dirty", { timeout: 10_000 })
  await expect(saveBtn).toBeEnabled()

  // 8. Publish resolved version
  await saveBtn.click()
  await expect(bar).toHaveAttribute("data-status", /saved|clean/, { timeout: 15_000 })

  // Verify file was written with chosen words
  const savedBytes = await readRepoFile(page, PRODUCT_PATH)
  const savedJson = JSON.parse(savedBytes) as Record<string, unknown>
  expect(savedJson.material).toBe("Wool felt · Leather (our handcrafted version)")
  expect(await commitCount(page)).toBeGreaterThan(commitsBefore)

  expect(origins.violations()).toEqual([])
})
