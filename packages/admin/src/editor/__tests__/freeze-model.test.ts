import type { FieldDescriptor } from "@mycms/core"
import { describe, expect, it } from "vitest"
import {
  allFreezeRowsDecided,
  applyAllFreezeChoices,
  applyFreezeChoice,
  createFreezeRows,
  formatFieldPathLabel,
  formatSubtreeForDisplay,
  readAtFieldPath,
  replayLateKeystrokes,
} from "../freeze-model"

describe("freeze-model — pure projection & decisions", () => {
  const fields: readonly FieldDescriptor[] = [
    { name: "title", label: "Title", type: "string", required: true },
    {
      name: "tags",
      label: "Tags",
      type: "list",
      required: true,
      itemMode: "scalar",
      fields: [{ name: "tag", label: "Tag", type: "string", required: true }],
    },
    {
      name: "author",
      label: "Author Info",
      type: "object",
      required: true,
      fields: [{ name: "name", label: "Name", type: "string", required: true }],
    },
  ]

  it("reads nested values and formats subtrees for display safely", () => {
    const tree = {
      title: "Hello",
      author: { name: "Ada", role: "Founder" },
      tags: ["tech", "art"],
    }
    expect(readAtFieldPath(tree, ["title"])).toBe("Hello")
    expect(readAtFieldPath(tree, ["author", "name"])).toBe("Ada")
    expect(readAtFieldPath(tree, ["tags", 0])).toBe("tech")
    expect(readAtFieldPath(tree, ["missing"])).toBeUndefined()
    expect(readAtFieldPath(tree, ["author", "age"])).toBeUndefined()

    expect(formatSubtreeForDisplay("Simple string")).toBe("Simple string")
    expect(formatSubtreeForDisplay(42)).toBe("42")
    expect(formatSubtreeForDisplay(true)).toBe("true")
    expect(formatSubtreeForDisplay(null)).toBe("null")
    expect(formatSubtreeForDisplay(undefined)).toBe("(empty)")
    expect(formatSubtreeForDisplay({ a: 1 })).toBe('{\n  "a": 1\n}')
  })

  it("derives readable field path labels", () => {
    expect(formatFieldPathLabel(["title"], fields)).toBe("Title")
    expect(formatFieldPathLabel(["unmodeled"], fields)).toBe("unmodeled")
    expect(formatFieldPathLabel(["author", "name"], fields)).toBe("Author Info.name")
    expect(formatFieldPathLabel(["tags", 0], fields)).toBe("Tags[0]")
  })

  it("creates freeze rows comparing remote and local subtrees", () => {
    const remoteRaw = JSON.stringify({
      title: "Remote Title",
      author: { name: "Remote Ada" },
      tags: ["news"],
    })
    const mineTree = {
      title: "Local Title",
      author: { name: "Local Ada" },
      tags: ["blog", "updates"],
    }

    const rows = createFreezeRows({
      frozenFieldPaths: [["title"], ["author", "name"], ["tags"]],
      remoteRaw,
      mineTree,
      fields,
    })

    expect(rows).toHaveLength(3)

    // Leaf row
    expect(rows[0]?.path).toEqual(["title"])
    expect(rows[0]?.label).toBe("Title")
    expect(rows[0]?.theirsRaw).toBe("Remote Title")
    expect(rows[0]?.mineRaw).toBe("Local Title")
    expect(rows[0]?.choice).toBeUndefined()

    // Nested row
    expect(rows[1]?.path).toEqual(["author", "name"])
    expect(rows[1]?.label).toBe("Author Info.name")
    expect(rows[1]?.theirsRaw).toBe("Remote Ada")
    expect(rows[1]?.mineRaw).toBe("Local Ada")

    // Whole list minimal-common-node row
    expect(rows[2]?.path).toEqual(["tags"])
    expect(rows[2]?.label).toBe("Tags")
    expect(rows[2]?.theirsRaw).toBe('[\n  "news"\n]')
    expect(rows[2]?.mineRaw).toBe('[\n  "blog",\n  "updates"\n]')
  })

  it("handles absent-on-one-side rows (foreign or local deletion)", () => {
    const remoteRaw = JSON.stringify({
      addedOnRemote: "foreign value",
      // localOnly was deleted on remote
    })
    const mineTree = {
      localOnly: "mine value",
      // addedOnRemote is missing locally
    }

    const rows = createFreezeRows({
      frozenFieldPaths: [["localOnly"], ["addedOnRemote"]],
      remoteRaw,
      mineTree,
    })

    const rowA = rows[0]
    const rowB = rows[1]
    if (rowA === undefined || rowB === undefined) throw new Error("expected 2 rows")

    expect(rowA.theirsRaw).toBe("(empty)")
    expect(rowA.mineRaw).toBe("mine value")

    expect(rowB.theirsRaw).toBe("foreign value")
    expect(rowB.mineRaw).toBe("(empty)")

    // Choosing 'theirs' for localOnly deletes it
    const afterTheirs = applyFreezeChoice(mineTree, rowA, "theirs")
    expect(afterTheirs).not.toHaveProperty("localOnly")

    // Choosing 'theirs' for addedOnRemote writes it
    const withAdded = applyFreezeChoice(mineTree, rowB, "theirs")
    expect(withAdded).toHaveProperty("addedOnRemote", "foreign value")
  })

  it("applies choices via path writers and verifies allDecided gate", () => {
    const remoteRaw = JSON.stringify({ title: "Remote", count: 10 })
    const mineTree = { title: "Local", count: 5 }

    const rows = createFreezeRows({
      frozenFieldPaths: [["title"], ["count"]],
      remoteRaw,
      mineTree,
    })

    expect(allFreezeRowsDecided(rows)).toBe(false)

    const r0 = rows[0]
    const r1 = rows[1]
    if (r0 === undefined || r1 === undefined) throw new Error("expected 2 rows")

    const row0 = { ...r0, choice: "theirs" as const }
    expect(allFreezeRowsDecided([row0, r1])).toBe(false)

    const row1 = { ...r1, choice: "mine" as const }
    expect(allFreezeRowsDecided([row0, row1])).toBe(true)

    const resolved = applyAllFreezeChoices(mineTree, [row0, row1])
    expect(resolved.title).toBe("Remote")
    expect(resolved.count).toBe(5)
  })

  it("replays late keystrokes onto reconciled tree (keystrokes-onto-chosen)", () => {
    const baseMineTree = {
      title: "Submitted Title",
      description: "Original Description",
      category: "Art",
    }

    // Keystrokes typed while save was in-flight:
    const liveFormTree = {
      title: "Submitted Title with late typing",
      description: "Original Description",
      category: "Art (late edit)",
    }

    // Reconciled tree chose remote for title, but category wasn't even contested:
    const reconciledTree = {
      title: "Remote Partner Title",
      description: "Original Description",
      category: "Art",
    }

    const replayed = replayLateKeystrokes({
      baseMineTree,
      liveFormTree,
      reconciledTree,
    })

    // Late keystrokes survived and replayed onto reconciled tree
    expect(replayed.title).toBe("Submitted Title with late typing")
    expect(replayed.category).toBe("Art (late edit)")
    expect(replayed.description).toBe("Original Description")
  })
})
