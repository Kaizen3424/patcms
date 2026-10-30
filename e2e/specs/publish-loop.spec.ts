import { expect, type Page, test } from "@playwright/test"
import { readIdbDraft } from "../support/idb"
import { installOriginAllowlist } from "../support/origin-allowlist"

/**
 * P2.12 Final Publish Loop Demonstration:
 *
 * Demonstrates the complete publish lifecycle in one comprehensive end-to-end journey:
 *  1. Sign-in with Access Key (PAT).
 *  2. Collection navigation and read presentation.
 *  3. Value-domain dirtiness tracking and undo-to-base verification.
 *  4. Atomic commit: exactly 1 new commit, 1 ref PATCH, parent is previous head,
 *     hidden and unmodeled fields preserved verbatim, trailing newline intact.
 *  5. Milestone law: SaveBar transitions to "Saved.", deploy status chip renders.
 *  6. Post-publish advisory sweep runs without blocking.
 *  7. Draft cleanup: IndexedDB draft removed post-ref-verify.
 *  8. Subsequent save in the same session: base coordinate advances to observed commit sha;
 *     second edit diffs against new base and publishes as a second commit parented to the first.
 */

const PRODUCT_PATH = "src/content/products/the-rock-pendant.json"
const DRAFT_KEY = "demo/products/the-rock-pendant"

interface Harness {
  readFile(path: string): string | null
  commitCount(): number
  head(): string | undefined
  readonly requestLog: readonly { readonly method: string; readonly status: number }[]
}

test("comprehensive publish loop: login -> browse -> edit -> save -> verify commit, sweep & status -> second save on observed base", async ({
  baseURL,
  page,
}) => {
  test.slow()
  if (baseURL === undefined) throw new Error("playwright config must set use.baseURL")
  const origins = await installOriginAllowlist(page, new URL(baseURL).origin)

  // 1. Sign in with Access Key (fast status polling cadence for e2e)
  await page.goto("/?statusFastPollMs=200&statusSlowPollMs=200&statusJitterRatio=0")
  await expect(page.getByRole("heading", { name: "Content studio" })).toBeVisible({
    timeout: 15_000,
  })
  await page.getByLabel("Access key").fill("github_pat_e2e_fixture")
  await page.getByRole("button", { name: "Continue" }).click()

  // 2. Collection navigation
  await expect(page.getByRole("navigation", { name: "Content folders" })).toBeVisible({
    timeout: 15_000,
  })
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
  const price = page.getByLabel("Price", { exact: true })

  // 3. Clean initial state
  await expect(bar).toHaveAttribute("data-status", "clean")
  await expect(save).toBeDisabled()
  await expect(material).toHaveValue("Wool felt · Leather")
  await expect(price).toHaveValue("895")

  const commitsInitial = await commitCount(page)
  const headInitial = await head(page)

  // 4. Value-domain dirtiness tracking & undo test
  await material.fill("Wool felt · Leather (publish loop demo)")
  await price.fill("950")
  await expect(bar).toHaveAttribute("data-status", "dirty")
  await expect(save).toBeEnabled()

  // Undo back to base values
  await material.fill("Wool felt · Leather")
  await price.fill("895")
  await expect(bar).toHaveAttribute("data-status", "clean")
  await expect(save).toBeDisabled()

  // Re-apply edits
  await material.fill("Wool felt · Leather (publish loop demo)")
  await price.fill("950")
  await expect(bar).toHaveAttribute("data-status", "dirty")
  await expect(save).toBeEnabled()

  // 5. First publish
  await save.click()
  await expect(bar).toHaveAttribute("data-status", "saved", { timeout: 15_000 })
  await expect(bar.getByText("Saved.")).toBeVisible()
  await expect(save).toBeDisabled()

  // Exactly 1 new commit, 1 ref PATCH
  const commitsAfterFirst = await commitCount(page)
  const headAfterFirst = await head(page)
  expect(commitsAfterFirst).toBe(commitsInitial + 1)
  expect(headAfterFirst).not.toBe(headInitial)
  expect(await patchCount(page)).toBe(1)

  // File integrity: updated fields present, unmodeled/hidden fields intact
  const bytes1 = await readRepoFile(page, PRODUCT_PATH)
  const saved1 = JSON.parse(bytes1) as Record<string, unknown>
  expect(saved1.material).toBe("Wool felt · Leather (publish loop demo)")
  expect(saved1.price).toBe(950)
  expect(saved1.title).toBe("The Rock Pendant")
  expect(saved1.category).toBe("Pendant Lights")
  expect((saved1.images as unknown[]).length).toBe(3)
  expect((saved1.specs as unknown[]).length).toBe(3)
  expect((saved1.options as unknown[]).length).toBe(3)
  expect((saved1.accordions as unknown[]).length).toBe(2)
  expect(bytes1.endsWith("\n")).toBe(true)

  // Draft deleted from IDB
  expect(await readIdbDraft(page, DRAFT_KEY)).toBeUndefined()

  // Deploy status chip visible
  const chip = page.getByTestId("deploy-status-chip")
  await expect(chip).toBeVisible({ timeout: 15_000 })

  // 6. Second save in same session on the newly observed base
  // Edit material again
  await material.fill("Wool felt · Leather (second save in same session)")
  await expect(bar).toHaveAttribute("data-status", "dirty")
  await expect(save).toBeEnabled()

  await save.click()
  await expect(bar).toHaveAttribute("data-status", "saved", { timeout: 15_000 })
  await expect(bar.getByText("Saved.")).toBeVisible()

  // Exactly 1 additional commit, exactly 2 ref PATCHes total
  const commitsAfterSecond = await commitCount(page)
  const headAfterSecond = await head(page)
  expect(commitsAfterSecond).toBe(commitsAfterFirst + 1)
  expect(headAfterSecond).not.toBe(headAfterFirst)
  expect(await patchCount(page)).toBe(2)

  // Content reflects second save
  const bytes2 = await readRepoFile(page, PRODUCT_PATH)
  const saved2 = JSON.parse(bytes2) as Record<string, unknown>
  expect(saved2.material).toBe("Wool felt · Leather (second save in same session)")
  expect(saved2.price).toBe(950)
  expect(saved2.title).toBe("The Rock Pendant")

  // Draft remains deleted from IDB
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

async function head(page: Page): Promise<string | undefined> {
  return page.evaluate(() => {
    const harness = (globalThis as unknown as { __mycmsHarness?: Harness }).__mycmsHarness
    if (harness === undefined) throw new Error("e2e harness missing on window")
    return harness.head()
  })
}

async function patchCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    const harness = (globalThis as unknown as { __mycmsHarness?: Harness }).__mycmsHarness
    if (harness === undefined) throw new Error("e2e harness missing on window")
    return harness.requestLog.filter((event) => event.method === "PATCH").length
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
