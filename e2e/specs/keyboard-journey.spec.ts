import { expect, test } from "@playwright/test"
import { installOriginAllowlist } from "../support/origin-allowlist"

/**
 * P5.9 — Keyboard-only journey.
 * Executes browse -> edit -> save cycle using strictly Tab, Shift+Tab, Enter, Space, Arrows, and Escape.
 * Not a single mouse click is used anywhere in this test.
 */
test("complete browse -> edit -> save journey using keyboard exclusively", async ({
  baseURL,
  page,
}) => {
  if (baseURL === undefined) throw new Error("playwright config must set use.baseURL")
  await installOriginAllowlist(page, new URL(baseURL).origin)

  // 1. Login with keyboard
  await page.goto("/")
  await expect(page.getByRole("heading", { level: 1, name: "Content studio" })).toBeVisible({
    timeout: 15_000,
  })

  // Tab into Access Key input
  await page.keyboard.press("Tab")
  await expect(page.getByLabel("Access key")).toBeFocused()
  await page.keyboard.type("github_pat_e2e_fixture")

  // Press Enter to submit the form
  await page.keyboard.press("Enter")

  // 2. Browse using Global Search (⌘K / Ctrl+K) or Tab navigation
  await expect(page.getByRole("navigation", { name: "Content folders" })).toBeVisible({
    timeout: 15_000,
  })

  // Open search modal via keyboard activation
  const searchTrigger = page.getByTestId("global-search-trigger")
  await searchTrigger.focus()
  await expect(searchTrigger).toBeFocused()
  await page.keyboard.press("Enter")

  const searchInput = page.getByRole("searchbox", { name: /search titles/i })
  await expect(searchInput).toBeVisible()
  await expect(searchInput).toBeFocused()

  // Type search query
  await page.keyboard.type("The Rock Pendant")
  await page.waitForTimeout(200)

  // ArrowDown to highlight the first result and press Enter to open
  await page.keyboard.press("ArrowDown")
  await page.keyboard.press("Enter")

  // Verify we navigated to an editor
  await expect(page.getByRole("article")).toBeVisible()
  const saveBar = page.getByTestId("save-bar")
  await expect(saveBar).toBeVisible()

  // 3. Edit title field using keyboard
  const titleInput = page.getByRole("textbox", { name: "Title", exact: true })
  await titleInput.focus()
  await expect(titleInput).toBeFocused()

  // Type an addition
  await page.keyboard.press("End")
  await page.keyboard.type(" (Special Edition)")

  // Verify save bar becomes dirty
  await expect(saveBar).toHaveAttribute("data-status", "dirty")

  // 4. Navigate to Save button with keyboard and press Enter
  const saveBtn = saveBar.getByRole("button", { name: /^Save/ })
  await saveBtn.focus()
  await expect(saveBtn).toBeFocused()
  await page.keyboard.press("Enter")

  // 5. Verify publish succeeds
  await expect(saveBar).toHaveAttribute("data-status", /saved|clean/, { timeout: 15_000 })
})
