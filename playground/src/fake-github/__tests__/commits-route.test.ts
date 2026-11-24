/**
 * Transport check for the MSW commit-log route: query parsing is the handler's
 * job, while first-parent ordering and the path filter come from the shared
 * reference model (see specs/testing.md — "known traps").
 */
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { setupServer } from "msw/node"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { loadFixtureRepoFromDisk } from "../fixture-repo"
import { createFakeGithubHandlers, DEFAULT_TAGS } from "../handlers"

const HERE = dirname(fileURLToPath(import.meta.url))
const FIXTURE_ROOT = join(HERE, "..", "..", "..", "fixtures", "repo")
const snapshot = await loadFixtureRepoFromDisk(FIXTURE_ROOT)
const msw = setupServer()

beforeAll(() => msw.listen())
afterAll(() => msw.close())

describe("MSW commit-log transport", () => {
  it("delegates query filtering to the shared reference model", async () => {
    const { handlers, server } = createFakeGithubHandlers(snapshot, DEFAULT_TAGS)
    msw.use(...handlers)
    const base = `https://api.github.com/repos/${DEFAULT_TAGS.owner}/${DEFAULT_TAGS.repo}/commits`

    const first = await fetch(`${base}?per_page=1`)
    expect(first.status).toBe(200)
    const rows = (await first.json()) as Array<{ sha: string }>
    expect(rows).toHaveLength(1)
    expect(rows[0]?.sha).toBe(snapshot.headSha)

    const filtered = await fetch(`${base}?path=no/such/file.json`)
    expect(await filtered.json()).toEqual([])
    expect(server.log.filter((event) => event.path === "/commits")).toHaveLength(2)
  })
})
