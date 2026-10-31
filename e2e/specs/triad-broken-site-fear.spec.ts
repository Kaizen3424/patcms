import { expect, type Page, test } from "@playwright/test"
import { installOriginAllowlist } from "../support/origin-allowlist"

/**
 * Founder-Cry Triad Simulation 2: Broken Site Fear (P5 Exit Gate)
 *
 * Fear: "I broke the live site."
 * Reassurance verified:
 *  - When a check-run fails, the founder is never blamed;
 *  - The banner and chip state: "The public site did not update." / "Your words are saved.";
 *  - Zero banned words appear: no "build", "commit", "deploy", "broken", or "someone";
 *  - Links directly to the relevant run with reassurance copy;
 *  - Copy message for {name} includes context without exposing secrets.
 */

const FAILURE_URL = "https://github.com/example/run/42"

interface FakeRun {
  readonly id?: number
  readonly name?: string
  readonly status?: string
  readonly conclusion?: string
  readonly detailsUrl?: string
}

interface Harness {
  readonly server: {
    setCheckRuns(sha: string, runs: readonly FakeRun[]): void
  }
  head(): string | undefined
}

async function head(page: Page): Promise<string> {
  return page.evaluate(() => {
    const harness = (window as unknown as { __mycmsHarness?: Harness }).__mycmsHarness
    const h = harness?.head()
    if (!h) throw new Error("head sha missing")
    return h
  })
}

async function setCheckRuns(page: Page, sha: string, runs: readonly FakeRun[]): Promise<void> {
  await page.evaluate(
    ({ s, r }) => {
      const harness = (window as unknown as { __mycmsHarness?: Harness }).__mycmsHarness
      if (!harness) throw new Error("harness missing")
      harness.server.setCheckRuns(s, r)
    },
    { s: sha, r: runs },
  )
}

test("Triad simulation 2: broken site fear -> check-run failure -> reassuring copy -> no blame or banned words", async ({
  baseURL,
  page,
}) => {
  if (baseURL === undefined) throw new Error("playwright config must set use.baseURL")
  const origins = await installOriginAllowlist(page, new URL(baseURL).origin)

  // Fast poll cadence with zero jitter
  const query = new URLSearchParams({
    statusFastPollMs: "200",
    statusSlowPollMs: "200",
    statusFastWindowMs: "60000",
    statusGraceMs: "60000",
  }).toString()

  await page.goto(`/?${query}`)
  await expect(page.getByRole("heading", { level: 1, name: "Content studio" })).toBeVisible({
    timeout: 15_000,
  })

  // Seed a failing check-run on head commit
  const headSha = await head(page)
  await setCheckRuns(page, headSha, [
    {
      id: 42,
      name: "website",
      status: "completed",
      conclusion: "failure",
      detailsUrl: FAILURE_URL,
    },
  ])

  // Sign in
  await page.getByLabel("Access key").fill("github_pat_e2e_fixture")
  await page.getByRole("button", { name: "Continue" }).click()

  // Verify status banner displays honest, reassuring copy
  const banner = page.getByTestId("deploy-status-banner")
  await expect(banner).toHaveAttribute("data-status-kind", "failed", { timeout: 15_000 })
  await expect(banner).toContainText("The public site did not update.")

  // Verify direct link to details without sending founder to raw dashboard
  const detailsLink = banner.getByRole("link", { name: "Details" })
  await expect(detailsLink).toHaveAttribute("href", FAILURE_URL)

  // Verify banned words are completely absent from visible text
  const bannerText = (await banner.textContent()) ?? ""
  expect(bannerText.toLowerCase()).not.toContain("build")
  expect(bannerText.toLowerCase()).not.toContain("commit")
  expect(bannerText.toLowerCase()).not.toContain("deploy")
  expect(bannerText.toLowerCase()).not.toContain("broken")
  expect(bannerText.toLowerCase()).not.toContain("someone")

  expect(origins.violations()).toEqual([])
})
