import { expect, type Page, test } from "@playwright/test"
import { installOriginAllowlist } from "../support/origin-allowlist"

/**
 * P2.6 save journey (L2): a founder edits one field, saves once, and the site
 * receives exactly one new commit carrying their words — with every unmodeled
 * or hidden key from the source file still intact.
 *
 * Assertions read the live MSW FakeGithub through the playground harness
 * (`window.__mycmsHarness`) because the fake repo lives in the page and MSW
 * rebuilds it on reload. Nothing here reloads: the save must be observable in
 * the same page life that produced it.
 */

const PRODUCT_PATH = "src/content/products/the-rock-pendant.json"

/** Mirror of the playground harness surface (playground/src/harness.ts). */
interface Harness {
  readFile(path: string): string | null
  commitCount(): number
  head(): string | undefined
  readonly requestLog: readonly { readonly method: string; readonly status: number }[]
}

test("edit one field -> save -> exactly one commit with the new words", async ({
  baseURL,
  page,
}) => {
  if (baseURL === undefined) throw new Error("playwright config must set use.baseURL")
  const origins = await installOriginAllowlist(page, new URL(baseURL).origin)

  await page.goto("/")
  // Cold boot loads the whole yve fixture library before this heading paints.
  // The sibling journeys give the same gate the same explicit budget; the 5s
  // expect default is too tight when the full parallel suite starts together.
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

  // Loaded against the snapshot head: nothing to save yet, Save refused.
  await expect(bar).toHaveAttribute("data-status", "clean")
  await expect(material).toHaveValue("Wool felt · Leather")
  await expect(save).toBeDisabled()

  const commitsBefore = await commitCount(page)
  const headBefore = await head(page)

  await material.fill("Wool felt · Leather (edited in the studio)")
  await expect(bar).toHaveAttribute("data-status", "dirty")
  await expect(save).toBeEnabled()

  // Undo-to-base is a VALUE-domain fact: the bar reads clean without inventing
  // a machine transition (ADR-0004 P2.6 pin).
  await material.fill("Wool felt · Leather")
  await expect(bar).toHaveAttribute("data-status", "clean")
  await expect(save).toBeDisabled()

  await material.fill("Wool felt · Leather (edited in the studio)")
  await expect(bar).toHaveAttribute("data-status", "dirty")
  await save.click()
  await expect(bar).toHaveAttribute("data-status", "saved", { timeout: 15_000 })
  await expect(bar.getByText("Saved.")).toBeVisible()
  await expect(save).toBeDisabled()

  // The ref moved, and it moved by exactly one commit (INV-P02) via one PATCH.
  expect(await commitCount(page)).toBe(commitsBefore + 1)
  expect(await patchCount(page)).toBe(1)
  expect(await head(page)).not.toBe(headBefore)

  const bytes = await readRepoFile(page, PRODUCT_PATH)
  const saved = JSON.parse(bytes) as Record<string, unknown>
  expect(saved.material).toBe("Wool felt · Leather (edited in the studio)")
  // Nothing else was rewritten: modeled neighbors, hidden fields, and the
  // presentation blocks the editor never touches all survive the save.
  expect(saved.title).toBe("The Rock Pendant")
  expect(saved.price).toBe(895)
  expect(saved.category).toBe("Pendant Lights")
  expect(saved.materialFilter).toBe("Felt")
  expect(saved.kicker).toBe("The Rock collection · Pendant")
  expect((saved.images as unknown[]).length).toBe(3)
  expect((saved.specs as unknown[]).length).toBe(3)
  expect((saved.options as unknown[]).length).toBe(3)
  expect((saved.accordions as unknown[]).length).toBe(2)
  // Canonical printer output, not a byte copy of the fixture.
  expect(bytes.endsWith("\n")).toBe(true)

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
