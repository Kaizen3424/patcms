import { expect, test } from "@playwright/test"
import { installOriginAllowlist } from "../support/origin-allowlist"

/**
 * P2.7 advisory-chip journey (L2 — ADR-0004 "P2.7 lease-notice + sweep advisory
 * pins"): after a published save, a FRESH sweep at the commit the ref was
 * OBSERVED carrying re-reads every content file (her own excluded) and surfaces
 * the older problems the site's content gate would pause — one chip per problem
 * entry, with "Take me there" routing to its editor.
 *
 * THE STANDING VETO in motion: the chip appears only AFTER the save is
 * published and never gates it — this journey's save lands (receipt, one
 * commit) with the unrelated problems already sitting in the repo.
 */

const MATERIAL = "Material"
const MATERIAL_EDITED = "Wool felt · Leather (edited in the studio)"

test("a published save lands first; older problems surface as chips that route there", async ({
  baseURL,
  page,
}) => {
  if (baseURL === undefined) throw new Error("playwright config must set use.baseURL")
  const origins = await installOriginAllowlist(page, new URL(baseURL).origin)

  await page.goto("/")
  await expect(page.getByRole("heading", { level: 1, name: "Content studio" })).toBeVisible({
    timeout: 15_000,
  })
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

  const bar = page.getByTestId("save-bar")

  // Chips ride a published save only: nothing until then, on a clean repo.
  await expect(page.getByTestId("advisory-chip")).toHaveCount(0)

  await page.getByLabel(MATERIAL).fill(MATERIAL_EDITED)
  await expect(bar).toHaveAttribute("data-status", "dirty")
  await page.getByRole("button", { name: "Save changes" }).click()
  await expect(bar).toHaveAttribute("data-status", "saved", { timeout: 15_000 })

  // The drift fixtures carry three older error-level problems; each affected
  // entry gets its own chip. The save itself was NEVER gated by them — the
  // "Saved." receipt already landed above.
  await expect
    .poll(() => page.getByTestId("advisory-chip").count(), { timeout: 15_000 })
    .toBeGreaterThanOrEqual(3)

  const chip = page
    .getByTestId("advisory-chip")
    .filter({ hasText: "Drift — missing relation" })
    .first()
  await expect(chip).toBeVisible()
  await expect(chip).toContainText(
    "Your change is saved, but the site's update is paused by an older problem.",
  )
  await expect(chip).toContainText('references a missing entry "missing-product"')
  await expect(chip).toContainText("src/content/drift/relation-drift.json")

  // "Copy message for Ing" — the minimal clipboard composer names the support
  // human; the machine-checkable location rides along in the text. Clipboard
  // permissions are not granted in the test browser, so only the presence of
  // the named action is asserted here (its unit tests pin the text).
  await expect(chip.getByRole("button", { name: "Copy message for Ing" })).toBeVisible()

  await chip.getByRole("link", { name: "Take me there" }).click()
  await expect(page).toHaveURL(/\/c\/drift\/e\/relation-drift$/)
  // The lamp the founder lit is still there — and the problem entry's editor
  // shows the older problem in its own banner.
  await expect(page.getByTestId("drift-banner")).toBeVisible()
  await expect(
    page.getByRole("heading", { level: 1, name: "Drift — missing relation" }),
  ).toBeVisible()

  expect(origins.violations()).toEqual([])
})
