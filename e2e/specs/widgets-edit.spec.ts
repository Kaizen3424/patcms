import { expect, test } from "@playwright/test"
import { installOriginAllowlist } from "../support/origin-allowlist"

/**
 * P3 Widget System & New Entry Flow E2E:
 *
 * Demonstrates:
 *  1. Full product editing with nested choice-tabs (options -> values -> swatch).
 *  2. Drag-free list reordering (↑/↓) marking the form dirty and persisting cleanly.
 *  3. Behind-the-scenes drawer displaying hidden field site effects.
 *  4. Web address (slug) lifecycle: locked chip on published items with copy note drawer.
 *  5. Template picker in collection library ("Start from blank" / "Start from an existing item").
 *  6. New entry creation: leaf-first defaults, live web address derivation from title,
 *     and atomic publication via `changes.adds`.
 */

interface Harness {
  readFile(path: string): string | null
  commitCount(): number
  head(): string | undefined
}

test("widgets & new-entry journey: edit nested choice-tabs, reorder lists, behind-the-scenes drawer, and template publish", async ({
  baseURL,
  page,
}) => {
  test.slow()
  if (baseURL === undefined) throw new Error("playwright config must set use.baseURL")
  await installOriginAllowlist(page, new URL(baseURL).origin)

  // 1. Sign in
  await page.goto("/?statusFastPollMs=200&statusSlowPollMs=200&statusJitterRatio=0")
  await expect(page.getByRole("heading", { name: "Content studio" })).toBeVisible({
    timeout: 15_000,
  })
  await page.getByLabel("Access key").fill("github_pat_e2e_fixture")
  await page.getByRole("button", { name: "Continue" }).click()

  // 2. Open Products -> The Rock Pendant
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

  // 3. Web address lifecycle: locked chip
  const lockedSlug = page.getByTestId("slug-chip-locked")
  await expect(lockedSlug).toBeVisible()
  await expect(lockedSlug).toContainText("/products/the-rock-pendant")

  await page.getByRole("button", { name: "Need to change this?" }).click()
  const lockedDrawer = page.getByTestId("slug-locked-drawer")
  await expect(lockedDrawer).toBeVisible()
  await expect(lockedDrawer.getByRole("button", { name: /Copy note for/ })).toBeVisible()
  await page.getByRole("button", { name: "Close info" }).click()
  await expect(lockedDrawer).not.toBeVisible()

  // 4. Behind-the-scenes drawer
  const btsDrawer = page.getByTestId("behind-the-scenes-drawer")
  await expect(btsDrawer).toBeVisible()
  await page.getByRole("button", { name: /Behind the scenes — managed by/ }).click()
  await expect(btsDrawer.getByText("Material filter")).toBeVisible()
  await expect(btsDrawer.getByText("SEO")).toBeVisible()

  // 5. Nested list & swatch widget: Choice tabs
  const optionsList = page.getByTestId("list-widget-options")
  await expect(optionsList).toBeVisible()
  const firstSwatchDot = optionsList.getByTestId("swatch-option-accent").first()
  await expect(firstSwatchDot).toBeVisible()

  // 6. Drag-free reordering on Photos list
  const photosList = page.getByTestId("list-widget-images")
  await expect(photosList).toBeVisible()

  const bar = page.getByTestId("save-bar")
  const saveBtn = page.getByRole("button", { name: "Save changes" })
  await expect(bar).toHaveAttribute("data-status", "clean")

  // Click move down on first photo
  const moveDownBtn = photosList.getByLabel("Move item 1 down")
  await moveDownBtn.click()

  // Form should now be dirty
  await expect(bar).toHaveAttribute("data-status", "dirty")
  await expect(saveBtn).toBeEnabled()

  // Save the reordered product
  await saveBtn.click()
  await expect(bar).toHaveAttribute("data-status", "saved", { timeout: 15_000 })

  // 7. Template and New Entry flow
  await page.getByRole("link", { name: "Products" }).first().click()
  await expect(page.getByRole("heading", { level: 1, name: "Products" })).toBeVisible()
  await expect(page.getByRole("link", { name: /^The Rock Pendant/ }).first()).toBeVisible()

  // Click "+ New Product" button
  const newProductBtn = page.getByTestId("new-entry-button")
  await expect(newProductBtn).toBeVisible()
  await newProductBtn.click()

  // Template modal opens
  const templateModal = page.getByRole("dialog", { name: /New Product/ })
  await expect(templateModal).toBeVisible()

  // Choose "Start from blank"
  await page.getByTestId("start-from-blank").click()

  // Now on /c/products/new
  await expect(page.getByTestId("new-entry-screen")).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId("new-entry-banner")).toBeVisible()
  await expect(page.getByTestId("new-entry-banner")).toContainText(
    "Nothing published until you Save",
  )

  // Live editable web address chip
  const newSlugChip = page.getByTestId("slug-chip-new")
  await expect(newSlugChip).toBeVisible()

  // Type title -> slug auto-generates
  const titleInput = page.getByRole("textbox", { name: "Title" })
  await titleInput.fill("Handcrafted Ceramic Urn")

  // Check that slug chip reflects title
  await expect(newSlugChip).toContainText("handcrafted-ceramic-urn")

  // Fill in required product fields
  await page.getByLabel("Display name").fill("Ceramic Urn")
  await page.getByLabel("Material").fill("Glazed stoneware")
  await page.getByLabel("Price", { exact: true }).fill("320")

  // Save new entry
  const newSaveBtn = page.getByRole("button", { name: "Save changes" })
  await expect(newSaveBtn).toBeEnabled()
  await newSaveBtn.click()

  // Verify save success and navigation to new entry URL
  await expect(page).toHaveURL(/\/c\/products\/e\/handcrafted-ceramic-urn/, { timeout: 20_000 })
  await expect(
    page.getByRole("heading", { level: 1, name: "Handcrafted Ceramic Urn" }),
  ).toBeVisible({ timeout: 15_000 })

  // Verify content file exists in git harness
  const newFileContent = await page.evaluate(() => {
    const harness = (globalThis as unknown as { __mycmsHarness?: Harness }).__mycmsHarness
    return harness?.readFile("src/content/products/handcrafted-ceramic-urn.json")
  })
  expect(newFileContent).not.toBeNull()
  if (typeof newFileContent !== "string") throw new Error("Expected file content")
  const parsed = JSON.parse(newFileContent)
  expect(parsed.title).toBe("Handcrafted Ceramic Urn")
  expect(parsed.price).toBe(320)
  expect(parsed.material).toBe("Glazed stoneware")
})
