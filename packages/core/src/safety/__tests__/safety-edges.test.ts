import { describe, expect, it } from "vitest"
import { compareText } from "../index"
import { readPath } from "../mustache"
import { isSafePath, safePath } from "../safe-path"
import { isSafeUrl, safeUrl } from "../safe-url"
import { utf8ByteLength } from "../untrusted-json"

describe("safety edge coverage", () => {
  it("covers path failure codes and boolean helpers", () => {
    expect(safePath("")).toMatchObject({ ok: false, code: "EMPTY" })
    expect(safePath("a", { prefix: "" })).toMatchObject({ ok: false, code: "INVALID_PREFIX" })
    expect(safePath("a", { prefix: "/a" })).toMatchObject({ ok: false, code: "INVALID_PREFIX" })
    expect(isSafePath("src/content/a.json")).toBe(true)
    expect(isSafePath("../a.json")).toBe(false)
  })

  it("covers URL failure codes and boolean helpers", () => {
    expect(safeUrl("")).toMatchObject({ ok: false, code: "EMPTY" })
    expect(safeUrl("/x", { allowRelative: false })).toMatchObject({ ok: false, code: "INVALID" })
    expect(safeUrl("not-relative")).toMatchObject({ ok: false, code: "INVALID" })
    expect(isSafeUrl("https://example.com")).toBe(true)
    expect(isSafeUrl("javascript:alert(1)")).toBe(false)
  })

  it("covers readPath array/object mismatches", () => {
    expect(readPath([{ a: 1 }], "[0].a")).toBe(1)
    expect(readPath({ a: 1 }, "a[0]")).toBeUndefined()
    expect(readPath([1], "a")).toBeUndefined()
    expect(readPath({ a: 1 }, "a[")).toBeUndefined()
    expect(readPath({ a: 1 }, "[x]")).toBeUndefined()
    expect(readPath({ a: 1 }, "a..b")).toBeUndefined()
  })

  it("covers UTF-8 2-byte counting and locale overrides", () => {
    expect(utf8ByteLength("é")).toBe(2)
    expect(compareText("a", "b", "en-US")).toBeLessThan(0)
  })
})
