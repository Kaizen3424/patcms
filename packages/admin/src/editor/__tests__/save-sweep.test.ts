/**
 * INV-P15 — the advisory sweep (ADR-0004 P2.7 pins):
 *  - classification is pure: `upToDate` / `advisory` (one problem per entry,
 *    first error issue) / exclusion of her own file;
 *  - `sweepSite` reads the tree FRESH at the observed commit sha and degrades
 *    to `unknown` on ANY failure — never a false "all clear";
 *  - nothing here gates a save (the chip lives outside the save-bar model).
 */
import type {
  AdminConfig,
  FolderCollectionDescriptor,
  GitBackend,
  ParseIssue,
  ParseIssueCode,
} from "@mycms/core"
import { describe, expect, it, vi } from "vitest"
import { loadEntryIndex } from "../../runtime/entry-index"
import type { SweepCandidate } from "../save-sweep"
import { classifySweep, sweepSite } from "../save-sweep"

const IRIS = "src/content/stones/iris.json"
const ROCK = "src/content/stones/rock.json"
const OUR_PATH = IRIS

const TITLE_FIELD = {
  name: "title",
  type: "string",
  label: "Title",
  required: true,
} as const

const FAMILY_FIELD = {
  name: "family",
  type: "relation",
  label: "Family",
  required: false,
  collection: "Stones",
  valueField: "{{slug}}",
  displayFields: ["title"],
} as const

const STONES: FolderCollectionDescriptor = {
  kind: "folder",
  name: "Stones",
  label: "Stones",
  folder: "src/content/stones",
  format: "json",
  identifierField: "title",
  media: { folder: "public/images/stones", publicFolder: "/images/stones" },
  fields: [TITLE_FIELD, FAMILY_FIELD],
}

const CONFIG: AdminConfig = {
  schemaVersion: 1,
  media: { folder: "public/images", publicFolder: "/images" },
  collections: [STONES],
}

const FILES: Readonly<Record<string, string>> = {
  [IRIS]: JSON.stringify({ title: "Iris No. 9" }),
  [ROCK]: JSON.stringify({ title: "The Rock", family: "vanishing" }),
}

function backendOf(
  files: Readonly<Record<string, string>>,
  overrides: {
    readonly readTree?: GitBackend["readTree"]
    readonly readFile?: GitBackend["readFile"]
  } = {},
): GitBackend {
  const base = {
    capabilities: { commitStatus: false, branches: false } as const,
    getRef: async () => {
      throw new Error("unused")
    },
    readTree: async () => ({
      kind: "tree" as const,
      tree: {
        sha: "tree",
        truncated: false,
        entries: Object.entries(files).map(([path, text]) => ({
          path,
          sha: `blob-${path.length}-${text.length}`,
          mode: "100644",
          type: "blob",
        })),
      },
    }),
    readFile: async (_branch: string, path: string) => {
      const text = files[path]
      if (text === undefined) throw new Error(`missing ${path}`)
      return {
        kind: "file" as const,
        file: {
          path,
          sha: `blob-${text.length}`,
          bytes: new TextEncoder().encode(text),
          size: text.length,
        },
      }
    },
    listChangedFiles: async () => new Map(),
    commitChanges: async () => {
      throw new Error("unused")
    },
  }
  return (overrides.readTree === undefined && overrides.readFile === undefined
    ? base
    : { ...base, ...overrides }) as unknown as GitBackend
}

describe("INV-P15 — classifySweep (pure verdict classes)", () => {
  it("upToDate when every other file is clean", () => {
    const verdict = classifySweep(
      [
        candidate(OUR_PATH, [], "Iris No. 9"),
        candidate("src/content/stones/moss.json", [], "Moss Ball"),
      ],
      OUR_PATH,
    )
    expect(verdict).toEqual({ kind: "upToDate" })
  })

  it("advisory names the unrelated invalid entry, not hers", () => {
    const verdict = classifySweep(
      [
        candidate(OUR_PATH, [], "Iris No. 9"),
        candidate(
          ROCK,
          [issuePages("RELATION_UNKNOWN", 'references a missing entry "vanishing"')],
          "The Rock",
        ),
      ],
      OUR_PATH,
    )
    if (verdict.kind !== "advisory") throw new Error("expected advisory")
    expect(verdict.problems).toEqual([
      {
        path: ROCK,
        collectionName: "Stones",
        slug: "rock",
        title: "The Rock",
        issue: expect.objectContaining({ code: "RELATION_UNKNOWN" }),
      },
    ])
  })

  it("only the FIRST error per entry becomes a chip problem", () => {
    const verdict = classifySweep(
      [
        candidate(
          ROCK,
          [issue("OUT_OF_RANGE", "too steep"), issue("RELATION_CHECK_FAILED", "another problem")],
          "The Rock",
        ),
      ],
      OUR_PATH,
    )
    if (verdict.kind !== "advisory") throw new Error("expected advisory")
    expect(verdict.problems).toHaveLength(1)
    expect(verdict.problems[0]?.issue.code).toBe("OUT_OF_RANGE")
  })

  it("warning-only entries stay read-side notes (no chip)", () => {
    const verdict = classifySweep(
      [candidate(ROCK, [issuePages("RELATION_UNKNOWN", "...", "warning")], "The Rock")],
      OUR_PATH,
    )
    expect(verdict).toEqual({ kind: "upToDate" })
  })

  it("her own path is excluded even if it carries issues (she passed the strict gate)", () => {
    const verdict = classifySweep(
      [
        candidate(
          OUR_PATH,
          [issuePages("RELATION_UNKNOWN", "references a missing entry")],
          "Iris No. 9",
        ),
      ],
      OUR_PATH,
    )
    expect(verdict).toEqual({ kind: "upToDate" })
  })
})

describe("INV-P15 — sweepSite (fresh reads at the observed commit sha)", () => {
  it("classifies a fresh tree: unrelated relation drift → advisory vs her clean file", async () => {
    const backend = backendOf(FILES)
    const verdict = await sweepSite({
      config: CONFIG,
      backend,
      branch: "site-branch",
      headSha: "head".repeat(10),
      ourPath: OUR_PATH,
    })
    if (verdict.kind !== "advisory") throw new Error("expected advisory")
    expect(verdict.problems.map((problem) => problem.path)).toEqual([ROCK])
    expect(verdict.problems[0]?.issue.message).toContain('"vanishing"')
  })

  it("the tree read carries NO etag (fresh, never the snapshot cache)", async () => {
    const readTree = vi.fn(async () => ({
      kind: "tree" as const,
      tree: { sha: "tree", truncated: false, entries: [] },
    }))
    const backend = backendOf(FILES, { readTree })
    await sweepSite({
      config: CONFIG,
      backend,
      branch: "site-branch",
      headSha: "head".repeat(10),
      ourPath: OUR_PATH,
    })
    expect(readTree).toHaveBeenCalledWith("site-branch", "head".repeat(10), {})
  })

  it("a clean site reads upToDate through loadEntryIndex", async () => {
    const backend = backendOf({ [IRIS]: JSON.stringify({ title: "Iris No. 9" }) })
    const verdict = await sweepSite({
      config: CONFIG,
      backend,
      branch: "site-branch",
      headSha: "head".repeat(10),
      ourPath: OUR_PATH,
    })
    expect(verdict).toEqual({ kind: "upToDate" })
  })

  it("a failed tree read degrades to unknown — never a false all-clear", async () => {
    const backend = backendOf(FILES, {
      readTree: async () => {
        throw new Error("offline")
      },
    })
    expect(
      await sweepSite({
        config: CONFIG,
        backend,
        branch: "site-branch",
        headSha: "head".repeat(10),
        ourPath: OUR_PATH,
      }),
    ).toEqual({ kind: "unknown" })
  })

  it("a not-modified tree answer is unreachable without an etag — conservative unknown", async () => {
    const backend = backendOf(FILES, {
      readTree: async () => ({ kind: "not-modified" as const }),
    })
    expect(
      await sweepSite({
        config: CONFIG,
        backend,
        branch: "site-branch",
        headSha: "head".repeat(10),
        ourPath: OUR_PATH,
      }),
    ).toEqual({ kind: "unknown" })
  })

  it("an unreadable file inside the tree degrades to unknown", async () => {
    const backend = backendOf(FILES, {
      readFile: async () => {
        throw new Error("blob 500")
      },
    })
    expect(
      await sweepSite({
        config: CONFIG,
        backend,
        branch: "site-branch",
        headSha: "head".repeat(10),
        ourPath: OUR_PATH,
      }),
    ).toEqual({ kind: "unknown" })
  })
})

describe("INV-P15 — the real index feeds the classifier", () => {
  it("loadEntryIndex surfaces the relation error the classifier consumes", async () => {
    const backend = backendOf(FILES)
    const tree = await backend.readTree("site-branch", "head".repeat(10))
    if (tree.kind !== "tree") throw new Error("expected tree")
    const index = await loadEntryIndex({
      config: CONFIG,
      tree: tree.tree,
      backend,
      branch: "site-branch",
    })
    const verdict = classifySweep(index.entries, OUR_PATH)
    if (verdict.kind !== "advisory") throw new Error("expected advisory")
    expect(verdict.problems[0]?.slug).toBe("rock")
  })
})

function candidate(
  path: string,
  issues: ReturnType<typeof issue>[],
  title: string,
): SweepCandidate {
  return { path, collectionName: "Stones", slug: slugOf(path), title, issues }
}

function issue(
  code: ParseIssueCode,
  message: string,
  severity: "error" | "warning" = "error",
): ParseIssue {
  return { path: "", code, message, severity }
}

const issuePages = issue

function slugOf(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1).replace(/\.json$/, "")
}
