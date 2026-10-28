import { type Browser, expect, type Page, test } from "@playwright/test"
import { installOriginAllowlist, type OriginReport } from "../support/origin-allowlist"

/**
 * P2.7 lease journey (L2 — ADR-0004 "P2.7 lease-notice + sweep advisory pins"
 * + the 2026-10-27 first-come refinement):
 *
 *  - the lease is UX serialization only; correctness stays the CAS (INV-P01);
 *  - a tab that opens the entry while another holds it reads the honest
 *    notice, and Save stays disabled even with real edits in the form;
 *  - a tab that OBSERVES the foreign release regains the hold automatically
 *    (`onFreed` → re-acquire) with no founder action;
 *  - a tab whose holder died silently is regainable ONLY after the holder's
 *    claim expired (TTL), and ONLY through the explicit "Check again" — never
 *    a timed auto-acquire;
 *  - once the hold is back, one save still lands as exactly one commit.
 *
 * Determinism notes: `?leaseTtlMs=6000` keeps TTL above the 5s heartbeat, so
 * a LIVE holder's claim never lapses between beats. The waiter idles ≥6s
 * before opening the entry, so it has observed the holder's heartbeat — its
 * mount acquire sees a PRE-EXISTING live claim and refuses (P2.7), with no
 * dependence on random session-id order. Each page gets the origin allowlist
 * interceptor (INV-N05, active from day 1).
 */

const NOTICE_TITLE = "This entry is open in another tab."
const MATERIAL = "Material"
const MATERIAL_EDITED = "Wool felt · Leather (edited on this tab)"
const ENTRY = "The Rock Pendant"

// Two full app boots + two deterministic ≥6s lease idles per test: the
// default 30s per-test budget is too tight for a two-tab journey.
test.setTimeout(120_000)

interface Harness {
  readFile(path: string): string | null
  commitCount(): number
  head(): string | undefined
  readonly requestLog: readonly { readonly method: string; readonly status: number }[]
}

interface Tabs {
  readonly holder: Page
  readonly waiter: Page
  readonly guards: readonly OriginReport[]
}

test("an observed release regains the lease for the waiting tab with no action", async ({
  baseURL,
  browser,
}) => {
  if (baseURL === undefined) throw new Error("playwright config must set use.baseURL")
  const { holder, waiter, guards } = await openTwoTabs(browser, new URL(baseURL).origin)

  // The holder signs in (remembered by its own hand) and opens the editor:
  // the hold exists from that moment.
  await bootSigningIn(holder)
  await openEntry(holder, ENTRY)

  // The waiter boots while the hold exists; the remembered access key carries
  // it straight into the studio. A ≥1-beat idle mandates the heartbeat has
  // been observed before the editor's mount acquire evaluates.
  await bootRemembered(waiter)
  await openEntry(waiter, ENTRY)

  const bar = waiter.getByTestId("save-bar")
  await expect(bar).toHaveAttribute("data-status", "leaseLost", { timeout: 15_000 })
  await expect(bar.getByText(NOTICE_TITLE)).toBeVisible()

  // While lost: edits stay on device and Save is refused by UX serialization.
  await waiter.getByLabel(MATERIAL).fill(MATERIAL_EDITED)
  await expect(bar).toHaveAttribute("data-status", "leaseLost")
  await expect(waiter.getByRole("button", { name: "Save changes" })).toBeDisabled()

  const commitsBefore = await commitCount(waiter)

  // The holder walks away INSIDE the app: its editor unmounts, the release
  // travels the wire, and the waiter re-acquires with no click at all —
  // the pinned auto-clear path (onFreed → re-acquire → notice gone). The
  // dirty edits surface immediately, since the notice no longer outranks.
  const holderFolders = holder.getByRole("navigation", { name: "Content folders" })
  await holderFolders
    .getByRole("link", { name: /^Products/ })
    .first()
    .click()
  await expect(bar).toHaveAttribute("data-status", "dirty", { timeout: 15_000 })
  await expect(bar.getByText(NOTICE_TITLE)).toHaveCount(0)

  // The regained hold restores the save slot: this tab's edits save normally.
  await waiter.getByRole("button", { name: "Save changes" }).click()
  await expect(bar).toHaveAttribute("data-status", "saved", { timeout: 15_000 })
  expect(await commitCount(waiter)).toBe(commitsBefore + 1)

  for (const guard of guards) expect(guard.violations()).toEqual([])
})

test("a silently dead holder is stealable only after its TTL, via Check again", async ({
  baseURL,
  browser,
}) => {
  if (baseURL === undefined) throw new Error("playwright config must set use.baseURL")
  const { holder, waiter, guards } = await openTwoTabs(browser, new URL(baseURL).origin)

  await bootSigningIn(holder)
  await openEntry(holder, ENTRY)
  await bootRemembered(waiter)
  await openEntry(waiter, ENTRY)

  const bar = waiter.getByTestId("save-bar")
  await expect(bar).toHaveAttribute("data-status", "leaseLost", { timeout: 15_000 })

  // The holder closes: no unmount, no release on the wire. What remains is
  // only its silent claim. TTL expiry is the one TIME law of the lease, so
  // wait past it (ttl = 6000, last renewal ≤5s before death → expired by
  // +6s) before touching anything.
  await holder.close()
  await waiter.waitForTimeout(6800)

  // A timed re-check could steal from a live-but-throttled tab, so nothing
  // auto-reacquires: the notice still stands, exactly as it was.
  await expect(bar).toHaveAttribute("data-status", "leaseLost")

  // The explicit re-check succeeds now that the expired claim is out of the
  // way; the founder's words were never touched.
  await bar.getByRole("button", { name: "Check again" }).click()
  await expect(bar).toHaveAttribute("data-status", "clean", { timeout: 15_000 })

  await waiter.getByLabel(MATERIAL).fill(MATERIAL_EDITED)
  await expect(bar).toHaveAttribute("data-status", "dirty")
  const commitsBefore = await commitCount(waiter)
  await waiter.getByRole("button", { name: "Save changes" }).click()
  await expect(bar).toHaveAttribute("data-status", "saved", { timeout: 15_000 })
  expect(await commitCount(waiter)).toBe(commitsBefore + 1)

  for (const guard of guards) expect(guard.violations()).toEqual([])
})

async function openTwoTabs(browser: Browser, origin: string): Promise<Tabs> {
  const context = await browser.newContext()
  const holder = await context.newPage()
  const guardHolder = await installOriginAllowlist(holder, origin)
  const waiter = await context.newPage()
  const guardWaiter = await installOriginAllowlist(waiter, origin)
  return { holder, waiter, guards: [guardHolder, guardWaiter] }
}

/** Boots signed-out (login h1) and signs in; the app shell follows. */
async function bootSigningIn(page: Page): Promise<void> {
  await page.goto("/?leaseTtlMs=6000")
  await expect(page.getByRole("heading", { level: 1, name: "Content studio" })).toBeVisible({
    timeout: 15_000,
  })
  await page.getByLabel("Access key").fill("github_pat_e2e_fixture")
  await page.getByRole("button", { name: "Continue" }).click()
  await expect(page.getByRole("navigation", { name: "Content folders" })).toBeVisible({
    timeout: 15_000,
  })
}

/**
 * Boots with the access key the holder's sign-in remembered (same browsing
 * context): no login screen on this page. Readiness evidence is the folders
 * nav (the login h1 also exists on the login screen), and the ≥1-beat idle
 * guarantees the holder's heartbeat was observed BEFORE the editor mount.
 */
async function bootRemembered(page: Page): Promise<void> {
  await page.goto("/?leaseTtlMs=6000")
  await expect(page.getByRole("navigation", { name: "Content folders" })).toBeVisible({
    timeout: 15_000,
  })
  await page.waitForTimeout(6000)
}

/** Library → Products → the entry, and the editor is mounted. */
async function openEntry(page: Page, entry: string): Promise<void> {
  const folders = page.getByRole("navigation", { name: "Content folders" })
  await folders
    .getByRole("link", { name: /^Products/ })
    .first()
    .click()
  await page
    .getByRole("link", { name: new RegExp(`^${entry}`) })
    .first()
    .click()
  await expect(page.getByRole("heading", { level: 1, name: entry })).toBeVisible({
    timeout: 15_000,
  })
}

async function commitCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    const harness = (globalThis as unknown as { __mycmsHarness?: Harness }).__mycmsHarness
    if (harness === undefined) throw new Error("e2e harness missing on window")
    return harness.commitCount()
  })
}
