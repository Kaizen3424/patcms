import { expect, test } from "@playwright/test"
import { installOriginAllowlist } from "../support/origin-allowlist"

const YVE_ENTRIES: Readonly<Record<string, readonly string[]>> = {
  Products: [
    "Botanical Memory",
    "Iris No. 3",
    "Iris No. 7",
    "Karst No. 2",
    "The Rock No. 1",
    "The Rock Pendant",
  ],
  Collections: ["Light Natural", "Ode to Iris"],
  Pages: ["Home", "Collections page", "Craft", "About", "Bespoke studio"],
  Settings: ["Contact details"],
}

const DRIFT_ENTRIES = [
  "Drift — unknown category",
  "Drift — invalid email",
  "Drift — empty people",
  "Drift — fractional price",
  "Drift — missing relation",
  "Drift — untouched key + default immunity",
] as const

test("login -> browse all yve fixtures -> open entries incl. a drift banner", async ({
  baseURL,
  page,
}) => {
  if (baseURL === undefined) throw new Error("playwright config must set use.baseURL")
  const origins = await installOriginAllowlist(page, new URL(baseURL).origin)

  await page.goto("/")
  await expect(page.getByRole("heading", { name: "Content studio" })).toBeVisible({
    timeout: 15_000,
  })

  await page.getByLabel("Access key").fill("github_pat_e2e_fixture")
  await page.getByRole("button", { name: "Continue" }).click()

  await expect(page.getByRole("heading", { level: 1, name: "Products" })).toBeVisible()

  for (const [collection, titles] of Object.entries(YVE_ENTRIES)) {
    await page
      .getByRole("link", { name: new RegExp(`^${collection}`) })
      .first()
      .click()
    await expect(page.getByRole("heading", { level: 1, name: collection })).toBeVisible()
    for (const title of titles) {
      await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible()
    }
  }

  await page
    .getByRole("link", { name: /^Products/ })
    .first()
    .click()
  await page
    .getByRole("link", { name: /Iris No\. 7/ })
    .first()
    .click()
  await expect(page.getByRole("heading", { level: 1, name: "Iris No. 7" })).toBeVisible()
  await expect(page.getByTestId("drift-banner")).toHaveCount(0)

  await page
    .getByRole("link", { name: /^Collections/ })
    .first()
    .click()
  await page
    .getByRole("link", { name: /Ode to Iris/ })
    .first()
    .click()
  await expect(page.getByRole("heading", { level: 1, name: "Ode to Iris" })).toBeVisible()

  await page
    .getByRole("link", { name: /^Drift fixtures/ })
    .first()
    .click()
  for (const title of DRIFT_ENTRIES) {
    await page
      .getByRole("link", { name: new RegExp(escapeRegExp(title)) })
      .first()
      .click()
    await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible()
    await expect(page.getByTestId("drift-banner")).toBeVisible()
    await expect(
      page
        .getByTestId("drift-banner")
        .getByText(/This entry needs attention|This entry has preserved notes/),
    ).toBeVisible()
    await page
      .getByRole("link", { name: /^Drift fixtures/ })
      .first()
      .click()
  }

  expect(origins.violations()).toEqual([])
})

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}
