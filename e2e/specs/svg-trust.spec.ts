import { expect, test } from "@playwright/test"
import { installOriginAllowlist } from "../support/origin-allowlist"

test.describe("INV-T04 & INV-N03 — Content Trust & Zero Raw URLs", () => {
  test("strictly rejects SVG uploads with explanatory text", async ({ baseURL, page }) => {
    test.slow()
    if (!baseURL) throw new Error("baseURL required")
    const origins = await installOriginAllowlist(page, new URL(baseURL).origin)

    // Intercept and assert zero requests to raw.githubusercontent.com
    let rawGithubHits = 0
    await page.route("**/*", (route) => {
      if (route.request().url().includes("raw.githubusercontent.com")) {
        rawGithubHits++
      }
      route.fallback()
    })

    await page.goto("/")
    await expect(page.getByRole("heading", { name: "Content studio" })).toBeVisible({
      timeout: 15_000,
    })

    await page.getByLabel("Access key").fill("github_pat_e2e_fixture")
    await page.getByRole("button", { name: "Continue" }).click()

    await expect(page.getByRole("heading", { level: 1, name: "Products" })).toBeVisible()

    // 1. Visit /media library screen
    await page.getByRole("link", { name: "Media" }).click()
    await expect(page.getByRole("heading", { level: 1, name: "Media Library" })).toBeVisible()

    // Wait for media tiles to render
    const firstTile = page.locator("[data-testid^='media-tile-']").first()
    await expect(firstTile).toBeVisible()

    // Verify all rendered thumbnails use blob: URLs and safe <img> tags (INV-T04, INV-N03)
    const images = page.locator("img[loading='lazy']")
    const imgCount = await images.count()
    expect(imgCount).toBeGreaterThan(0)

    for (let i = 0; i < Math.min(imgCount, 5); i++) {
      const src = await images.nth(i).getAttribute("src")
      expect(src).toMatch(/^blob:/)
    }

    // Verify zero dangerous SVG embed elements in the DOM
    expect(await page.locator("object").count()).toBe(0)
    expect(await page.locator("embed").count()).toBe(0)

    // 2. Open an entry with an image widget and attempt SVG upload
    await page
      .getByRole("link", { name: /^Products/ })
      .first()
      .click()
    await page.getByRole("heading", { name: "Botanical Memory" }).click()
    await expect(page.getByRole("heading", { level: 1, name: "Botanical Memory" })).toBeVisible()

    // Find the file input in ImageWidget
    const fileInput = page.locator("[data-testid='image-widget-file-input']").first()
    await expect(fileInput).toBeAttached()

    // Upload an SVG file
    const maliciousSvg = {
      name: "exploit.svg",
      mimeType: "image/svg+xml",
      buffer: Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
      ),
    }
    await fileInput.setInputFiles(maliciousSvg)

    // Verify SVG rejection banner surfaces with explanatory copy (INV-T04)
    await expect(
      page.getByText("SVG uploads are not permitted. Please upload WebP, PNG, or JPEG files."),
    ).toBeVisible({ timeout: 5000 })

    // Verify ZERO raw.githubusercontent.com hits occurred (INV-N03)
    expect(rawGithubHits).toBe(0)
    expect(origins.violations()).toEqual([])
  })
})
