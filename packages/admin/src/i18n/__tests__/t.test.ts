import { describe, expect, it } from "vitest"
import { t } from "../t"

describe("t() translation helper", () => {
  it("interpolates variables safely", () => {
    expect(t("Hello {name}", { name: "Milan" })).toBe("Hello Milan")
    expect(t("{count} items remaining", { count: 5 })).toBe("5 items remaining")
  })

  it("handles empty or missing values object", () => {
    expect(t("Static string")).toBe("Static string")
    expect(t("Hello {name}")).toBe("Hello {name}")
  })

  it("treats dollar signs as literal inert characters (never regex replacements)", () => {
    expect(t("Price is {price}", { price: "$100" })).toBe("Price is $100")
    expect(t("Code is {code}", { code: "$& $1 $` $'" })).toBe("Code is $& $1 $` $'")
  })
})
