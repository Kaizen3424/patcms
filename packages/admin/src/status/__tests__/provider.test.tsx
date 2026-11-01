/**
 * React wiring for deploy-status (ADR-0008 P2.8 appendix): the publish journal
 * turns into a per-entry chip only after the `published` verdict lands, the
 * banner carries whole-site truth for the current head, a missing probe
 * permission renders the off copy with no reads at all, and a read error
 * degrades to `unavailable` — never `failed`.
 */

import { act, render, screen } from "@testing-library/react"
import type { CapabilityProbeResult, CheckRunsRead, GitBackend } from "patcms/advanced"
import type { ReactElement } from "react"
import { describe, expect, it, vi } from "vitest"
import { StatusBanner, StatusChip } from "../chip"
import { StatusProvider, usePublishedSha } from "../provider"
import { createPublishStore } from "../publish-store"

const SHA = "a".repeat(40)
const ENTRY = "src/content/products/rock.json"

const PROBE: CapabilityProbeResult = {
  repo: "ok",
  protectionAdmin: "ok",
  checksRead: "ok",
  rateLimit: null,
}

const LIVE: CheckRunsRead = {
  kind: "ok",
  totalCount: 1,
  runs: [{ id: 1, name: "site", status: "completed", conclusion: "success" }],
}

const FAILED: CheckRunsRead = {
  kind: "ok",
  totalCount: 1,
  runs: [
    {
      id: 7,
      name: "site",
      status: "completed",
      conclusion: "failure",
      detailsUrl: "https://github.com/example/run/7",
    },
  ],
}

function backend(
  options: { readonly runs?: CheckRunsRead; readonly commitStatus?: boolean } = {},
): GitBackend {
  return {
    capabilities: { commitStatus: options.commitStatus ?? true, branches: true },
    getRef: async () => ({ ref: "refs/heads/main", object: { sha: SHA, type: "commit" } }),
    readCheckRuns: async () => options.runs ?? LIVE,
    readCommitStatuses: async () => ({ kind: "ok", statuses: [] }),
  } as unknown as GitBackend
}

function mount(
  ui: ReactElement,
  options: {
    readonly probe?: CapabilityProbeResult
    readonly backend?: GitBackend
    readonly store?: ReturnType<typeof createPublishStore>
  } = {},
) {
  const store = options.store ?? createPublishStore()
  render(
    <StatusProvider
      deps={{
        probe: options.probe ?? PROBE,
        backend: options.backend ?? backend(),
        branch: "main",
        publishStore: store,
      }}
    >
      {ui}
    </StatusProvider>,
  )
  return store
}

function PublishedChip() {
  const sha = usePublishedSha(ENTRY)
  return <StatusChip sha={sha} />
}

describe("deploy-status wiring", () => {
  it("shows the per-entry chip only after the published sha is journaled", async () => {
    const store = mount(<PublishedChip />)
    expect(screen.queryByTestId("deploy-status-chip")).toBeNull()

    act(() => {
      store.publish(ENTRY, SHA)
    })

    const chip = await screen.findByTestId("deploy-status-chip")
    expect(chip.getAttribute("data-status-kind")).toBe("live")
    expect(chip.textContent).toContain("The public site is up to date.")
  })

  it("reports whole-site truth in the banner", async () => {
    mount(<StatusBanner />)
    const banner = await screen.findByTestId("deploy-status-banner")
    expect(banner.getAttribute("data-status-kind")).toBe("live")
    expect(banner.textContent).toContain("The public site is up to date.")
  })

  it("links the failing run when a run says it did not pass", async () => {
    mount(<StatusBanner />, { backend: backend({ runs: FAILED }) })
    const banner = await screen.findByTestId("deploy-status-banner")
    expect(banner.getAttribute("data-status-kind")).toBe("failed")
    expect(screen.getByRole("link", { name: "Details" }).getAttribute("href")).toBe(
      "https://github.com/example/run/7",
    )
  })

  it("degrades a failed read to unavailable, never failed", async () => {
    const broken = backend()
    broken.readCheckRuns = async () => {
      throw new Error("read failed")
    }
    mount(<StatusBanner />, { backend: broken })
    const banner = await screen.findByTestId("deploy-status-banner")
    expect(banner.getAttribute("data-status-kind")).toBe("unavailable")
    expect(banner.textContent).toContain("Status unavailable — your words are saved.")
  })

  it("renders the off copy and never reads when the probe lacks access", async () => {
    const silent = backend()
    const readCheckRuns = vi.spyOn(silent, "readCheckRuns")
    mount(<StatusBanner />, {
      backend: silent,
      probe: { ...PROBE, checksRead: "missing" },
    })

    const banner = await screen.findByTestId("deploy-status-banner")
    expect(banner.getAttribute("data-status-kind")).toBe("off")
    expect(banner.textContent).toContain("Status checking is off.")
    expect(readCheckRuns).not.toHaveBeenCalled()
  })

  it("renders the off copy when the backend capability is absent", async () => {
    const silent = backend({ commitStatus: false })
    const readCheckRuns = vi.spyOn(silent, "readCheckRuns")
    mount(<StatusBanner />, { backend: silent })

    const banner = await screen.findByTestId("deploy-status-banner")
    expect(banner.getAttribute("data-status-kind")).toBe("off")
    expect(readCheckRuns).not.toHaveBeenCalled()
  })

  it("hides the chip when status checking is off (the banner owns the message)", async () => {
    const store = mount(<PublishedChip />, { probe: { ...PROBE, checksRead: "missing" } })
    act(() => {
      store.publish(ENTRY, SHA)
    })
    await act(async () => {
      await Promise.resolve()
    })
    expect(screen.queryByTestId("deploy-status-chip")).toBeNull()
  })
})
