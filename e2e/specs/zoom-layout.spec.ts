/// <reference lib="dom" />
import { expect, test } from "@playwright/test"
import { installOriginAllowlist } from "../support/origin-allowlist"

/**
 * P5.9 — 125% zoom layout test (1024px viewport = 1280px effective screen width at 125% zoom).
 * Verifies zero horizontal scrollbar across login, library, editor, and media surfaces.
 */
test.describe("125% zoom layout verification (P5.9)", () => {
  test.use({
    viewport: { width: 1024, height: 768 },
  })

  test("zero horizontal scrollbar across all primary views at 1024px viewport", async ({
    baseURL,
    page,
  }) => {
    if (baseURL === undefined) throw new Error("playwright config must set use.baseURL")
    await installOriginAllowlist(page, new URL(baseURL).origin)

    // 1. Login view
    await page.goto("/")
    await expect(page.getByRole("heading", { level: 1, name: "Content studio" })).toBeVisible({
      timeout: 15_000,
    })

    const loginHScroll = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    )
    expect(loginHScroll).toBe(false)

    // 2. Library view
    await page.getByLabel("Access key").fill("github_pat_e2e_fixture")
    await page.getByRole("button", { name: "Continue" }).click()

    const folders = page.getByRole("navigation", { name: "Content folders" })
    await expect(folders).toBeVisible({ timeout: 15_000 })

    const libraryHScroll = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    )
    expect(libraryHScroll).toBe(false)

    // 3. Entry Editor view
    await folders
      .getByRole("link", { name: /^Products/ })
      .first()
      .click()
    await page
      .getByRole("link", { name: /^The Rock Pendant/ })
      .first()
      .click()
    await expect(page.getByRole("heading", { level: 1, name: "The Rock Pendant" })).toBeVisible()

    const editorHScroll = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    )
    expect(editorHScroll).toBe(false)

    // 4. Media Library view
    await page.goto("/media")
    await expect(page.getByRole("heading", { level: 1, name: "Media library" })).toBeVisible()

    const mediaHScroll = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    )
    expect(mediaHScroll).toBe(false)
  })
})
