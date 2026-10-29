import { expect, type Page, test } from "@playwright/test"
import { installOriginAllowlist } from "../support/origin-allowlist"

/**
 * P2.9 conflict freeze journeys (L2):
 *
 *  1. In-flight CAS conflict: founder edits, concurrent push lands while saving,
 *     freeze panel renders, Save stays blocked until decided, founder decides
 *     their row, Save unlocks and lands with the chosen bytes.
 *  2. Boot conflict: pre-armed draft + foreign commit at mount, freeze panel
 *     renders at boot, founder decides, Save publishes chosen bytes.
 *
 * Assertions read the live MSW FakeGithub through window.__mycmsHarness.
 * Both journeys operate within a single page lifecycle (no reloads).
 */

const PRODUCT_PATH = "src/content/products/the-rock-pendant.json"

interface Harness {
  readFile(path: string): string | null
  commitCount(): number
  head(): string | undefined
  readonly requestLog: readonly { readonly method: string; readonly status: number }[]
}

test("in-flight save conflict -> freeze panel -> decide row -> save chosen bytes", async ({
  baseURL,
  page,
}) => {
  if (baseURL === undefined) throw new Error("playwright config must set use.baseURL")
  const origins = await installOriginAllowlist(page, new URL(baseURL).origin)

  await page.goto("/?conflictDemo=save")
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
  const save = page.getByRole("button", { name: "Save changes" })
  const material = page.getByLabel("Material", { exact: true })

  await expect(bar).toHaveAttribute("data-status", "clean")
  await expect(material).toHaveValue("Wool felt · Leather")
  await expect(save).toBeDisabled()

  const commitsBefore = await commitCount(page)

  // Edit material locally
  await material.fill("Wool felt · Leather (our local edit)")
  await expect(bar).toHaveAttribute("data-status", "dirty")
  await expect(save).toBeEnabled()

  // Click save — the conflictDemo seam pushes a foreign commit at the first PATCH
  await save.click()

  // Freeze panel must appear
  const freezePanel = page.getByTestId("freeze-panel")
  await expect(freezePanel).toBeVisible({ timeout: 15_000 })
  await expect(bar).toHaveAttribute("data-status", "conflict")
  await expect(save).toBeDisabled()

  // Row comparisons are visible
  await expect(freezePanel.getByText("Wool felt · Leather (foreign push)")).toBeVisible()
  await expect(freezePanel.getByText("Wool felt · Leather (our local edit)")).toBeVisible()

  // Decide: Keep my version
  const keepMine = freezePanel.getByRole("button", { name: "Keep my version" })
  await keepMine.click()

  // All rows decided: Save unlocks, status becomes dirty against new base
  await expect(bar).toHaveAttribute("data-status", "dirty", { timeout: 10_000 })
  await expect(save).toBeEnabled()

  // Click Save
  await save.click()
  await expect(bar).toHaveAttribute("data-status", "saved", { timeout: 15_000 })
  await expect(bar.getByText("Saved.")).toBeVisible()
  await expect(save).toBeDisabled()

  // 3 commits created in git: 1 from first attempt that hit CAS, 1 foreign commit, 1 resolved save commit
  expect(await commitCount(page)).toBe(commitsBefore + 3)

  // The saved file carried exactly the chosen words
  const bytes = await readRepoFile(page, PRODUCT_PATH)
  const saved = JSON.parse(bytes) as Record<string, unknown>
  expect(saved.material).toBe("Wool felt · Leather (our local edit)")
  expect(saved.title).toBe("The Rock Pendant")
  expect(saved.price).toBe(895)
  expect(bytes.endsWith("\n")).toBe(true)

  expect(origins.violations()).toEqual([])
})

test("boot conflict -> freeze panel renders on mount -> decide -> save", async ({
  baseURL,
  page,
}) => {
  if (baseURL === undefined) throw new Error("playwright config must set use.baseURL")
  const origins = await installOriginAllowlist(page, new URL(baseURL).origin)

  await page.goto("/?conflictDemo=boot")
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
  const save = page.getByRole("button", { name: "Save changes" })

  // Boot adjudication caught conflict: freeze panel is visible immediately
  const freezePanel = page.getByTestId("freeze-panel")
  await expect(freezePanel).toBeVisible({ timeout: 15_000 })
  await expect(bar).toHaveAttribute("data-status", "conflict")
  await expect(save).toBeDisabled()

  await expect(freezePanel.getByText("Wool felt · Leather (foreign push)")).toBeVisible()
  await expect(freezePanel.getByText("Wool felt · Leather (stored in draft)")).toBeVisible()

  // Decide: Keep the other version
  const keepTheirs = freezePanel.getByRole("button", { name: "Keep the other version" })
  await keepTheirs.click()

  // All rows decided: form rebinds, Save unlocks
  await expect(bar).toHaveAttribute("data-status", "dirty", { timeout: 10_000 })
  await expect(save).toBeEnabled()

  await save.click()
  await expect(bar).toHaveAttribute("data-status", "saved", { timeout: 15_000 })
  await expect(bar.getByText("Saved.")).toBeVisible()

  const bytes = await readRepoFile(page, PRODUCT_PATH)
  const saved = JSON.parse(bytes) as Record<string, unknown>
  expect(saved.material).toBe("Wool felt · Leather (foreign push)")
  expect(saved.title).toBe("The Rock Pendant (draft edit)")

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
