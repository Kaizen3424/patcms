/**
 * Path writers (ADR-0004 P2.9 appendix) — the admin freeze UI's ONLY value
 * mutation surface. Laws pinned there: pure over the input tree, parents
 * auto-created, list-item deletion refused (whole-list edit), absent-key
 * delete = no-op, root path refused, SPLICE_GAP on vanished containers.
 */
import { describe, expect, it } from "vitest"
import {
  deleteAtFieldPath,
  type FieldPath,
  readAtFieldPath,
  writeAtFieldPath,
} from "../field-paths"

const TREE = {
  title: "Pendant",
  specs: [{ label: "Size", value: "60 cm" }],
  contact: { email: "a@b.c", deep: { keep: true } },
}

describe("writeAtFieldPath", () => {
  it("overwrites a leaf and never mutates the input", () => {
    const result = writeAtFieldPath(TREE, ["title"], "New")
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(readAtFieldPath(result.tree, ["title"]).value).toBe("New")
    expect(TREE.title).toBe("Pendant")
  })

  it("writes a nested leaf inside untouched containers", () => {
    const result = writeAtFieldPath(TREE, ["contact", "email"], "x@y.z")
    if (!result.ok) throw new Error("expected ok")
    expect(readAtFieldPath(result.tree, ["contact", "email"]).value).toBe("x@y.z")
    expect(readAtFieldPath(result.tree, ["contact", "deep", "keep"]).value).toBe(true)
  })

  it("auto-creates intermediate records (and lists when the next segment is an index)", () => {
    const created = writeAtFieldPath(TREE, ["brand", "line", "name"], "Rock")
    if (!created.ok) throw new Error("expected ok")
    expect(readAtFieldPath(created.tree, ["brand", "line", "name"]).value).toBe("Rock")

    const list = writeAtFieldPath(TREE, ["tags", 0], "felt")
    if (!list.ok) throw new Error("expected ok")
    expect(readAtFieldPath(list.tree, ["tags", 0]).value).toBe("felt")
  })

  it("appends at the list end and replaces inside an existing index", () => {
    const append = writeAtFieldPath(TREE, ["specs", 1], { label: "Weight", value: "1 kg" })
    if (!append.ok) throw new Error("expected append ok")
    expect(readAtFieldPath(append.tree, ["specs", 1]).found).toBe(true)

    const replace = writeAtFieldPath(TREE, ["specs", 0, "value"], "62 cm")
    if (!replace.ok) throw new Error("expected replace ok")
    expect(readAtFieldPath(replace.tree, ["specs", 0, "value"]).value).toBe("62 cm")
  })

  it("refuses an index beyond the list end (SPLICE_GAP)", () => {
    const result = writeAtFieldPath(TREE, ["specs", 5], "x")
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.issue.code).toBe("SPLICE_GAP")
  })

  it("refuses the root path and a write through a leaf", () => {
    expect(writeAtFieldPath(TREE, [], "x").ok).toBe(false)
    const throughLeaf = writeAtFieldPath(TREE, ["title", "nested"], "x")
    expect(throughLeaf.ok).toBe(false)
    if (throughLeaf.ok) return
    expect(throughLeaf.issue.code).toBe("SPLICE_GAP")
  })
})

describe("deleteAtFieldPath", () => {
  it("removes a nested key and keeps siblings", () => {
    const result = deleteAtFieldPath(TREE, ["contact", "email"])
    if (!result.ok) throw new Error("expected ok")
    expect(readAtFieldPath(result.tree, ["contact", "email"]).found).toBe(false)
    expect(readAtFieldPath(result.tree, ["contact", "deep", "keep"]).value).toBe(true)
  })

  it("deleting an absent key is a no-op success", () => {
    const result = deleteAtFieldPath(TREE, ["contact", "ghost"])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(readAtFieldPath(result.tree, ["contact", "email"]).value).toBe("a@b.c")
  })

  it("refuses list-item deletion (whole-list edit law) but allows a whole list", () => {
    const item = deleteAtFieldPath(TREE, ["specs", 0])
    expect(item.ok).toBe(false)
    if (!item.ok) expect(item.issue.code).toBe("SPLICE_GAP")

    const whole = deleteAtFieldPath(TREE, ["specs"])
    if (!whole.ok) throw new Error("expected whole-list delete ok")
    expect(readAtFieldPath(whole.tree, ["specs"]).found).toBe(false)
  })

  it("refuses the root path and a delete through a leaf", () => {
    expect(deleteAtFieldPath(TREE, []).ok).toBe(false)
    expect(deleteAtFieldPath(TREE, ["title", "nested"]).ok).toBe(false)
  })
})

describe("freeze-row round trip (P2.9 usage shape)", () => {
  it("keep-mine writes my subtree at the frozen path; keep-theirs deletes then writes", () => {
    const frozenPath: FieldPath = ["specs"]
    const mine = [{ label: "Mine", value: "1" }]
    const theirs = [{ label: "Theirs", value: "2" }]

    const keptMine = writeAtFieldPath(TREE, frozenPath, mine)
    if (!keptMine.ok) throw new Error("expected ok")
    expect(readAtFieldPath(keptMine.tree, frozenPath).value).toEqual(mine)

    const keptTheirs = writeAtFieldPath(TREE, frozenPath, theirs)
    if (!keptTheirs.ok) throw new Error("expected ok")
    expect(readAtFieldPath(keptTheirs.tree, frozenPath).value).toEqual(theirs)
  })
})
