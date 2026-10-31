/// <reference lib="dom" />
import { expect, test } from "@playwright/test"
import { installOriginAllowlist } from "../support/origin-allowlist"

interface A11yViolation {
  readonly id: string
  readonly impact: "critical" | "serious" | "moderate" | "minor"
  readonly description: string
  readonly selector: string
}

async function auditPageA11y(page: import("@playwright/test").Page): Promise<A11yViolation[]> {
  return page.evaluate(() => {
    const violations: A11yViolation[] = []

    // 1. Button accessible name
    const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>("button"))
    for (const btn of buttons) {
      if (btn.offsetParent === null && !btn.getAttribute("aria-hidden")) continue // hidden
      const text = btn.textContent?.trim()
      const ariaLabel = btn.getAttribute("aria-label")?.trim()
      const ariaLabelledBy = btn.getAttribute("aria-labelledby")
      const title = btn.getAttribute("title")?.trim()
      if (!text && !ariaLabel && !ariaLabelledBy && !title) {
        violations.push({
          id: "button-name",
          impact: "critical",
          description: "Button does not have an accessible name",
          selector:
            btn.tagName +
            (btn.id ? `#${btn.id}` : "") +
            (btn.className ? `.${btn.className.slice(0, 30)}` : ""),
        })
      }
    }

    // 2. Form input labels
    const inputs = Array.from(document.querySelectorAll<HTMLElement>("input, select, textarea"))
    for (const el of inputs) {
      if (el.getAttribute("type") === "hidden") continue
      if (el.offsetParent === null) continue
      const id = el.id
      const hasForLabel = id ? Boolean(document.querySelector(`label[for="${id}"]`)) : false
      const hasParentLabel = Boolean(el.closest("label"))
      const ariaLabel = el.getAttribute("aria-label")?.trim()
      const ariaLabelledBy = el.getAttribute("aria-labelledby")
      if (!hasForLabel && !hasParentLabel && !ariaLabel && !ariaLabelledBy) {
        violations.push({
          id: "label",
          impact: "critical",
          description: "Form element does not have an associated label",
          selector: el.tagName + (el.id ? `#${el.id}` : ""),
        })
      }
    }

    // 3. Images have alt text
    const images = Array.from(document.querySelectorAll("img"))
    for (const img of images) {
      if (!img.hasAttribute("alt")) {
        violations.push({
          id: "image-alt",
          impact: "critical",
          description: "Image element does not have an alt attribute",
          selector: img.src.slice(0, 50),
        })
      }
    }

    // 4. Unique IDs
    const allIds = Array.from(document.querySelectorAll("[id]")).map((el) => el.id)
    const seen = new Set<string>()
    for (const id of allIds) {
      if (!id) continue
      if (seen.has(id)) {
        violations.push({
          id: "duplicate-id",
          impact: "serious",
          description: `Duplicate id: #${id}`,
          selector: `#${id}`,
        })
      }
      seen.add(id)
    }

    // 5. Links have accessible name
    const links = Array.from(document.querySelectorAll("a[href]"))
    for (const link of links) {
      const text = (link as HTMLElement).textContent?.trim()
      const ariaLabel = link.getAttribute("aria-label")?.trim()
      if (!text && !ariaLabel) {
        violations.push({
          id: "link-name",
          impact: "serious",
          description: "Link has no accessible text or aria-label",
          selector: link.getAttribute("href") || "a",
        })
      }
    }

    // 6. Dialog accessible name and role
    const dialogs = Array.from(document.querySelectorAll('[role="dialog"]'))
    for (const dlg of dialogs) {
      const ariaLabel = dlg.getAttribute("aria-label")?.trim()
      const ariaLabelledBy = dlg.getAttribute("aria-labelledby")
      if (!ariaLabel && !ariaLabelledBy) {
        violations.push({
          id: "dialog-name",
          impact: "serious",
          description: "Dialog has no accessible name (aria-label or aria-labelledby)",
          selector: 'role="dialog"',
        })
      }
    }

    return violations
  })
}

test.describe("Accessibility audit suite (P5.9)", () => {
  test("audit login screen", async ({ baseURL, page }) => {
    if (baseURL === undefined) throw new Error("playwright config must set use.baseURL")
    await installOriginAllowlist(page, new URL(baseURL).origin)

    await page.goto("/")
    await expect(page.getByRole("heading", { level: 1, name: "Content studio" })).toBeVisible({
      timeout: 15_000,
    })

    const violations = await auditPageA11y(page)
    const seriousOrCritical = violations.filter(
      (v) => v.impact === "critical" || v.impact === "serious",
    )
    expect(seriousOrCritical).toEqual([])
  })

  test("audit library screen & tour dialog", async ({ baseURL, page }) => {
    if (baseURL === undefined) throw new Error("playwright config must set use.baseURL")
    await installOriginAllowlist(page, new URL(baseURL).origin)

    await page.goto("/")
    await page.getByLabel("Access key").fill("github_pat_e2e_fixture")
    await page.getByRole("button", { name: "Continue" }).click()

    await expect(page.getByRole("navigation", { name: "Content folders" })).toBeVisible({
      timeout: 15_000,
    })

    const libViolations = await auditPageA11y(page)
    expect(libViolations.filter((v) => v.impact === "critical" || v.impact === "serious")).toEqual(
      [],
    )

    // If tour trigger is present, open tour and audit dialog
    const tourBtn = page.getByRole("button", { name: /Take a 60-second tour/i })
    if (await tourBtn.isVisible()) {
      await tourBtn.click()
      const tourDialog = page.getByRole("dialog")
      await expect(tourDialog).toBeVisible()

      const tourViolations = await auditPageA11y(page)
      expect(
        tourViolations.filter((v) => v.impact === "critical" || v.impact === "serious"),
      ).toEqual([])

      await page.keyboard.press("Escape")
    }
  })

  test("audit editor screen & search modal", async ({ baseURL, page }) => {
    if (baseURL === undefined) throw new Error("playwright config must set use.baseURL")
    await installOriginAllowlist(page, new URL(baseURL).origin)

    await page.goto("/")
    await page.getByLabel("Access key").fill("github_pat_e2e_fixture")
    await page.getByRole("button", { name: "Continue" }).click()

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

    const editorViolations = await auditPageA11y(page)
    expect(
      editorViolations.filter((v) => v.impact === "critical" || v.impact === "serious"),
    ).toEqual([])

    // Open search modal and audit
    await page.getByTestId("global-search-trigger").click()
    const searchbox = page.getByRole("searchbox", { name: /search titles/i })
    await expect(searchbox).toBeVisible()

    const searchViolations = await auditPageA11y(page)
    expect(
      searchViolations.filter((v) => v.impact === "critical" || v.impact === "serious"),
    ).toEqual([])

    await page.keyboard.press("Escape")
  })

  test("audit media library & trash screens", async ({ baseURL, page }) => {
    if (baseURL === undefined) throw new Error("playwright config must set use.baseURL")
    await installOriginAllowlist(page, new URL(baseURL).origin)

    await page.goto("/")
    await page.getByLabel("Access key").fill("github_pat_e2e_fixture")
    await page.getByRole("button", { name: "Continue" }).click()

    const mediaLink = page.getByRole("link", { name: "Media", exact: true })
    await mediaLink.click()
    await expect(page.getByRole("heading", { level: 1, name: "Media library" })).toBeVisible()

    const mediaViolations = await auditPageA11y(page)
    expect(
      mediaViolations.filter((v) => v.impact === "critical" || v.impact === "serious"),
    ).toEqual([])

    const trashLink = page.getByRole("link", { name: "Recently deleted", exact: true })
    await trashLink.click()
    await expect(page.getByRole("heading", { level: 1, name: "Recently deleted" })).toBeVisible()

    const trashViolations = await auditPageA11y(page)
    expect(
      trashViolations.filter((v) => v.impact === "critical" || v.impact === "serious"),
    ).toEqual([])
  })
})
