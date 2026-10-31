import { expect, test } from "@playwright/test"
import { listIdbDrafts, putIdbDraft } from "../support/idb"
import { installOriginAllowlist } from "../support/origin-allowlist"

const VALID_1X1_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
)

interface Harness {
  readFile(path: string): string | null
  commitCount(): number
  head(): string | undefined
  readonly defaultBranch: string
  readonly server: {
    contents(branch: string, path: string): { bytes: Uint8Array; sha: string } | undefined
  }
}

test.describe("P4.9 — Slow-WiFi 9-Photo Journey & Replace Honesty (INV-M02)", () => {
  test("survives slow-wifi fault injection, retries failed tile, publishes 9 photos + JSON in exactly 1 commit", async ({
    baseURL,
    page,
  }) => {
    test.slow()
    if (!baseURL) throw new Error("baseURL required")
    const origins = await installOriginAllowlist(page, new URL(baseURL).origin)

    page.on("console", (msg) => {
      if (msg.type() === "error") {
        console.error("BROWSER ERROR:", msg.text())
      }
    })

    // 1. Boot playground with chaos fault injection on the 7th blob upload
    await page.goto("/?failBlobUploadIndex=7")
    await expect(page.getByRole("heading", { name: "Content studio" })).toBeVisible({
      timeout: 15_000,
    })

    await page.getByLabel("Access key").fill("github_pat_e2e_fixture")
    await page.getByRole("button", { name: "Continue" }).click()

    await expect(page.getByRole("heading", { level: 1, name: "Products" })).toBeVisible()

    // 2. Open an entry with image fields
    await page
      .getByRole("link", { name: /^The Rock Pendant/ })
      .first()
      .click()
    await expect(page.getByRole("heading", { level: 1, name: "The Rock Pendant" })).toBeVisible()

    // 3. Test upload error badge and per-tile retry on ImageWidget
    const fileInput = page.locator("[data-testid='image-widget-file-input']").first()
    await expect(fileInput).toBeAttached()

    // Attempt invalid image upload (malformed bytes)
    await fileInput.setInputFiles({
      name: "corrupted.png",
      mimeType: "image/png",
      buffer: Buffer.from("not-a-valid-png-or-jpeg-stream"),
    })

    // Error banner surfaces with retry button
    const errorBanner = page.getByText(
      "The uploaded file is not a supported raster image (JPEG, PNG, or WebP).",
    )
    await expect(errorBanner).toBeVisible({ timeout: 5000 })
    const retryBtn = page.getByRole("button", { name: "Retry upload" })
    await expect(retryBtn).toBeVisible()

    // Now select a valid PNG: error banner clears and image path is set
    await fileInput.setInputFiles({
      name: "the-rock-pendant-1.png",
      mimeType: "image/png",
      buffer: VALID_1X1_PNG,
    })
    await expect(errorBanner).not.toBeVisible({ timeout: 5000 })

    // 4. Stage 8 additional media tiles alongside entry in IndexedDB draft store (total 9 photos, INV-M02)
    const draftKey = "demo/products/the-rock-pendant"
    for (let i = 2; i <= 9; i++) {
      await putIdbDraft(page, {
        key: `${draftKey}/media/tile-${i}`,
        savedAt: new Date().toISOString(),
        value: {
          tileId: `tile-${i}`,
          repoPath: `public/images/products/the-rock-pendant-${i}.webp`,
          publicPath: `/images/products/the-rock-pendant-${i}.webp`,
          originalFilename: `photo-${i}.webp`,
          sanitizedFilename: `the-rock-pendant-${i}.webp`,
          bytes: Array.from(VALID_1X1_PNG),
          mimeType: "image/webp",
          size: VALID_1X1_PNG.byteLength,
          sha: `staged-tile-${i}`,
          status: "ready",
        },
      })
    }

    const stagedInIdb = await listIdbDrafts(page, `${draftKey}/media/`)
    expect(stagedInIdb.length).toBe(9)

    // 5. Make the entry dirty and publish with fault-injected retry
    const materialInput = page.getByLabel("Material", { exact: true })
    await materialInput.fill("Wool felt · Leather (slow-wifi 9-photo journey)")

    const commitsBefore = await page.evaluate(() => {
      const harness = (globalThis as unknown as { __mycmsHarness?: Harness }).__mycmsHarness
      return harness?.commitCount() ?? 0
    })

    const saveBar = page.getByTestId("save-bar")
    await expect(saveBar).toHaveAttribute("data-status", "dirty")
    const saveButton = page.getByRole("button", { name: "Save changes" })
    await expect(saveButton).toBeEnabled()

    // Trigger atomic save. Blob #7 triggers 503 from chaos hook, save-controller retries.
    await saveButton.click()

    // Wait for save completion
    await expect(saveBar).toHaveAttribute("data-status", "saved", { timeout: 35_000 })

    // INV-M02: Exactly ONE commit created on the branch for all 9 photos + JSON entry
    const commitsAfter = await page.evaluate(() => {
      const harness = (globalThis as unknown as { __mycmsHarness?: Harness }).__mycmsHarness
      return harness?.commitCount() ?? 0
    })
    expect(commitsAfter).toBe(commitsBefore + 1)

    // Verify all 10 files (1 entry JSON + 9 images) exist at the new branch head
    const filesCheck = await page.evaluate(() => {
      const harness = (globalThis as unknown as { __mycmsHarness?: Harness }).__mycmsHarness
      if (!harness) return { ok: false, reason: "no harness" }
      const json = harness.readFile("src/content/products/the-rock-pendant.json")
      if (!json?.includes("slow-wifi 9-photo journey")) {
        return { ok: false, reason: "json content mismatch" }
      }
      for (let i = 1; i <= 9; i++) {
        const file = harness.server.contents(
          harness.defaultBranch,
          `public/images/products/the-rock-pendant-${i}.webp`,
        )
        if (!file) return { ok: false, reason: `missing image ${i}` }
      }
      return { ok: true }
    })
    expect(filesCheck).toEqual({ ok: true })

    // Staged media draft tiles purged on successful publish
    const stagedRemaining = await listIdbDrafts(page, `${draftKey}/media/`)
    expect(stagedRemaining.length).toBe(0)

    // 6. Navigate to /media library and verify 1-hour CDN honesty replace copy
    await page.getByRole("link", { name: "Media" }).click()
    await expect(page.getByRole("heading", { level: 1, name: "Media Library" })).toBeVisible()

    // Select the first media tile
    const firstTile = page.locator("[data-testid^='media-tile-']").first()
    await expect(firstTile).toBeVisible()
    await firstTile.click()

    // Open replace warning and assert CDN honesty copy
    await page.getByRole("button", { name: "Replace image file" }).click()
    const replaceWarning = page.getByTestId("replace-cdn-honesty-warning")
    await expect(replaceWarning).toBeVisible()
    await expect(replaceWarning).toContainText("visitors may see the old image for up to 1 hour")

    // Zero forbidden origins (INV-N03)
    expect(origins.violations()).toEqual([])
  })
})
