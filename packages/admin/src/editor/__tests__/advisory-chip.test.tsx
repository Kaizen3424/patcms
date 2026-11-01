import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router"
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import type { ParseIssueCode } from "patcms/advanced"
import type { ReactElement } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { AdvisoryChips } from "../advisory-chip"
import { ADVISORY_COPY, fillName } from "../copy"
import type { SweepProblem, SweepVerdict } from "../save-sweep"

/**
 * The chip surface (ADR-0004 P2.7 pins): presentational only — a problem entry
 * gets its own chip; `unknown` stays coverage-honest; dismissal is per chip
 * and lives OUTSIDE the save-bar model; the clipboard composer is minimal and
 * its failure is silent (the honest line is also on screen).
 *
 * Mounting: a minimal real router so TanStack `Link` can resolve "Take me
 * there" — the chip element IS a route's component; the router's first load
 * is async, so rendered content is polled with findBy and waitFor. Clicks ride
 * `fireEvent`: userEvent's laid-out pointer sequence never lands under the
 * routed tree in jsdom (probe-verified); real interaction fidelity is the
 * e2e tier's job.
 */

function issue(
  code: ParseIssueCode,
  message: string,
): { path: string; code: ParseIssueCode; message: string; severity: "error" | "warning" } {
  return { path: "family", code, message, severity: "error" }
}

function problem(overrides: Partial<SweepProblem> = {}): SweepProblem {
  return {
    path: "src/content/products/rock.json",
    collectionName: "Products",
    slug: "rock",
    title: "The Rock",
    issue: issue("RELATION_UNKNOWN", 'references a missing entry "vanishing"'),
    ...overrides,
  }
}

async function renderChip(ui: ReactElement): Promise<void> {
  const rootRoute = createRootRoute({ component: () => <Outlet /> })
  const editorRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/c/$collection/e/$entry",
    component: () => ui,
  })
  const router = createRouter({
    routeTree: rootRoute.addChildren([editorRoute]),
    history: createMemoryHistory({ initialEntries: ["/c/Products/e/iris"] }),
  })
  await router.load()
  render(<RouterProvider router={router} />)
}

async function chipsOf(count: number): Promise<readonly HTMLElement[]> {
  let chips = screen.queryAllByTestId("advisory-chip")
  await waitFor(() => {
    chips = screen.getAllByTestId("advisory-chip")
    expect(chips).toHaveLength(count)
  })
  return chips
}

function clipboardOf(writeText: (text: string) => Promise<void>): void {
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true })
}

describe("INV-P15 — advisory chips", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("renders nothing before a verdict exists (never gates a save)", async () => {
    await renderChip(<AdvisoryChips verdict={undefined} supportName="Ada" />)
    expect(screen.queryByTestId("advisory-chip")).toBeNull()
    expect(screen.queryByTestId("advisory-sweep")).toBeNull()
  })

  it("renders nothing when the site is up to date", async () => {
    await renderChip(<AdvisoryChips verdict={{ kind: "upToDate" }} supportName="Ada" />)
    expect(screen.queryByTestId("advisory-chip")).toBeNull()
    expect(screen.queryByTestId("advisory-sweep")).toBeNull()
  })

  it("an unknown verdict stays coverage-honest, never a false all-clear", async () => {
    await renderChip(<AdvisoryChips verdict={{ kind: "unknown" }} supportName="Ada" />)
    const section = await screen.findByTestId("advisory-sweep")
    expect(section.textContent).toContain(ADVISORY_COPY.unknownTitle)
    expect(section.textContent).toContain("Tell Ada if it does not appear live")
    expect(section.textContent).not.toContain(ADVISORY_COPY.pausedTitle)
  })

  it("one chip per problem entry with the entry's first error and its route link", async () => {
    const verdict: SweepVerdict = {
      kind: "advisory",
      problems: [
        problem(),
        problem({
          path: "src/content/products/moss.json",
          slug: "moss",
          title: "Moss Ball",
          issue: issue("RELATION_UNKNOWN", 'references a missing entry "abyss"'),
        }),
      ],
    }
    await renderChip(<AdvisoryChips verdict={verdict} supportName="Ada" />)

    const [rock, moss] = await chipsOf(2)
    expect(rock?.textContent).toContain(ADVISORY_COPY.pausedTitle)
    expect(rock?.textContent).toContain('The Rock: references a missing entry "vanishing"')
    expect(rock?.textContent).toContain("src/content/products/rock.json")
    const rockLink = within(rock as HTMLElement).getByRole("link", {
      name: ADVISORY_COPY.takeMeThere,
    })
    expect(rockLink.getAttribute("href")).toBe("/c/Products/e/rock")
    expect(moss?.textContent).toContain("Moss Ball")
    expect(
      within(rock as HTMLElement).getByRole("button", {
        name: fillName(ADVISORY_COPY.copyMessage, "Ada"),
      }),
    ).toBeTruthy()
  })

  it("dismissing one chip keeps the other", async () => {
    const verdict: SweepVerdict = {
      kind: "advisory",
      problems: [
        problem(),
        problem({ path: "src/content/products/moss.json", slug: "moss", title: "Moss Ball" }),
      ],
    }
    await renderChip(<AdvisoryChips verdict={verdict} supportName="Ada" />)
    const [, moss] = await chipsOf(2)
    fireEvent.click(
      within(moss as HTMLElement).getByRole("button", { name: ADVISORY_COPY.dismiss }),
    )

    expect(screen.getAllByTestId("advisory-chip")).toHaveLength(1)
    expect(screen.getByTestId("advisory-chip").textContent).toContain("The Rock")
  })

  it("copy composes one honest paragraph plus the location (success shows Copied briefly)", async () => {
    const writeText = vi.fn<(text: string) => Promise<void>>(() => Promise.resolve())
    clipboardOf(writeText)
    await renderChip(
      <AdvisoryChips verdict={{ kind: "advisory", problems: [problem()] }} supportName="Ada" />,
    )
    const [chip] = await chipsOf(1)
    fireEvent.click(
      within(chip as HTMLElement).getByRole("button", {
        name: fillName(ADVISORY_COPY.copyMessage, "Ada"),
      }),
    )

    await waitFor(() => expect(writeText).toHaveBeenCalledOnce())
    expect(writeText).toHaveBeenCalledWith(
      'Your change is saved, but the site\'s update is paused by an older problem. — The Rock: references a missing entry "vanishing" (src/content/products/rock.json)',
    )
    // The label shows the transient Copied state once the write resolved.
    await screen.findByRole("button", { name: ADVISORY_COPY.copied })
  })

  it("a clipboard failure stays silent and keeps the original label", async () => {
    const writeText = vi.fn<(text: string) => Promise<void>>(() =>
      Promise.reject(new Error("denied")),
    )
    clipboardOf(writeText)
    await renderChip(
      <AdvisoryChips verdict={{ kind: "advisory", problems: [problem()] }} supportName="Ada" />,
    )
    const [chip] = await chipsOf(1)
    fireEvent.click(
      within(chip as HTMLElement).getByRole("button", {
        name: fillName(ADVISORY_COPY.copyMessage, "Ada"),
      }),
    )

    await waitFor(() => expect(writeText).toHaveBeenCalledOnce())
    expect(screen.getByRole("button", { name: "Copy message for Ada" })).toBeTruthy()
    expect(screen.queryByRole("button", { name: ADVISORY_COPY.copied })).toBeNull()
  })
})
