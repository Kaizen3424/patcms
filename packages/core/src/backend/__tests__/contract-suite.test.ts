import { describe, expect, it } from "vitest"
import {
  CORE_CONTRACT_SUITE,
  defineContractSuite,
  runContractSuite,
  SHAPE_CHECK,
  STATUS_READ_CHECK,
} from "../../__tests__/support/contract-suite"
import { FixtureBackend, textFixtureFile } from "../../__tests__/support/reference-fixture-backend"
import { encodeUtf8 } from "../../safety/encoding"
import type { GitBackend } from "../types"

const HEAD = "2a".repeat(20)
const FILE_SHA = "b1".repeat(20)
const FILE_TEXT = '{\n  "title": "fixture"\n}\n'

function fixtureBackend(): FixtureBackend {
  return new FixtureBackend({
    headSha: HEAD,
    treeSha: "c0".repeat(20),
    etag: '"tree-etag"',
    files: new Map([
      ["src/content/site.json", textFixtureFile(FILE_TEXT, FILE_SHA, '"file-etag"')],
    ]),
  })
}

describe("contract suite runner (ADR-0001: one suite for every backend)", () => {
  it("reference-fixture-backend passes the full read-side suite", async () => {
    const report = await runContractSuite(fixtureBackend(), CORE_CONTRACT_SUITE, {
      expectedPaths: ["src/content/site.json"],
      expectedFileBytes: encodeUtf8(FILE_TEXT),
    })
    expect(report.ok).toBe(true)
    expect(report.passed).toBe(CORE_CONTRACT_SUITE.checks.length)
    expect(report.failures).toEqual([])
  })

  it("status reads are required and capability-gated (ADR-0005 P2.8)", async () => {
    const suite = defineContractSuite([STATUS_READ_CHECK])
    const supported = new FixtureBackend({ headSha: HEAD })
    const ok = await runContractSuite(supported, suite)
    expect(ok.failures).toEqual([])

    const unsupported = new FixtureBackend({
      headSha: HEAD,
      capabilities: { commitStatus: false },
    })
    const gated = await runContractSuite(unsupported, suite)
    expect(gated.failures).toEqual([])
    await expect(unsupported.readCheckRuns("branch", HEAD)).resolves.toEqual({
      kind: "unsupported",
    })
    await expect(unsupported.readCommitStatuses("branch", HEAD)).resolves.toEqual({
      kind: "unsupported",
    })
  })

  it("records named failures for malformed implementations", async () => {
    const bad = {
      capabilities: { commitStatus: 1, branches: true },
      getRef: async (branch: string) => ({ ref: branch, object: { sha: "", type: "" } }),
      listChangedFiles: async () => new Map(),
      commitChanges: async () => ({ commitSha: "", treeSha: "" }),
    } as unknown as GitBackend
    const report = await runContractSuite(bad, CORE_CONTRACT_SUITE)
    expect(report.ok).toBe(false)
    expect(report.failures[0]?.name).toBe(SHAPE_CHECK.name)
    expect(report.failures.some((failure) => failure.name === SHAPE_CHECK.name)).toBe(true)
  })

  it("supports bespoke suites; custom checks run in order", async () => {
    const observe: string[] = []
    const suite = defineContractSuite([
      { name: "first", run: async () => void observe.push("first") },
      {
        name: "second",
        run: async () => {
          observe.push("second")
        },
      },
    ])
    const backend = new FixtureBackend({ headSha: "3a".repeat(20) })
    const report = await runContractSuite(backend, suite)
    expect(report.ok).toBe(true)
    expect(observe).toEqual(["first", "second"])
  })
})

describe("FixtureBackend (ADR-0009 exemplar)", () => {
  it("branches are parameters — any branch works, none are hardcoded (INV-P14 posture)", async () => {
    const head = "4a".repeat(20)
    const stagingSha = "5b".repeat(20)
    const fixture = new FixtureBackend({ headSha: head })
    fixture.setBranchHead("staging", stagingSha)
    const staged = await fixture.getRef("staging")
    expect(staged.ref).toBe("refs/heads/staging")
    expect(staged.object.sha).toBe(stagingSha)
    const fallback = await fixture.getRef("whatever-branch-name")
    expect(fallback.object.sha).toBe(head)
  })

  it("writes transactionally and reads its own commit back (P2 write path)", async () => {
    const head = "6c".repeat(20)
    const fixture = new FixtureBackend({ headSha: head, files: new Map() })
    const result = await fixture.commitChanges(
      { adds: [{ path: "src/content/new.json", bytes: encodeUtf8('{"title":"new"}\n') }] },
      head,
      "fixture-branch",
    )
    expect(result.commitSha).toMatch(/^[0-9a-f]{40}$/)
    const ref = await fixture.getRef("fixture-branch")
    expect(ref.object.sha).toBe(result.commitSha)
    const tree = await fixture.readTree("fixture-branch", result.commitSha)
    if (tree.kind !== "tree") throw new Error("expected tree")
    expect(tree.tree.entries.map((entry) => entry.path)).toContain("src/content/new.json")
    const diff = await fixture.listChangedFiles("fixture-branch", head, result.commitSha)
    expect([...diff.keys()]).toEqual(["src/content/new.json"])
  })

  it("refuses stale-base CAS writes instead of overwriting (INV-P01 posture)", async () => {
    const head = "7d".repeat(20)
    const fixture = new FixtureBackend({
      headSha: head,
      files: new Map([["src/content/site.json", textFixtureFile(FILE_TEXT, FILE_SHA)]]),
    })
    fixture.setBranchHead("fixture-branch", "9e".repeat(20))
    await expect(
      fixture.commitChanges(
        { updates: [{ path: "src/content/site.json", bytes: encodeUtf8('{"a":2}') }] },
        head,
        "fixture-branch",
      ),
    ).rejects.toMatchObject({ code: "CAS_CONFLICT" })
    // HEAD unchanged after the refusal.
    expect((await fixture.getRef("fixture-branch")).object.sha).toBe("9e".repeat(20))
  })
})
