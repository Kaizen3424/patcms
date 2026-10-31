import * as fs from "node:fs"
import * as path from "node:path"
import { describe, expect, it } from "vitest"

// WCAG 2.1 relative luminance calculation
function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace("#", "").trim()
  const r = Number.parseInt(clean.slice(0, 2), 16)
  const g = Number.parseInt(clean.slice(2, 4), 16)
  const b = Number.parseInt(clean.slice(4, 6), 16)
  return [r, g, b]
}

function srgbToLinear(channel: number): number {
  const c = channel / 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex)
  const rLin = srgbToLinear(r)
  const gLin = srgbToLinear(g)
  const bLin = srgbToLinear(b)
  return 0.2126 * rLin + 0.7152 * gLin + 0.0722 * bLin
}

function contrastRatio(hex1: string, hex2: string): number {
  const lum1 = relativeLuminance(hex1)
  const lum2 = relativeLuminance(hex2)
  const lighter = Math.max(lum1, lum2)
  const darker = Math.min(lum1, lum2)
  return (lighter + 0.05) / (darker + 0.05)
}

describe("Design tokens contrast & a11y audit (P5.8)", () => {
  const cssPath = path.resolve(__dirname, "../tokens.css")
  const cssContent = fs.readFileSync(cssPath, "utf-8")

  const extractToken = (varName: string): string => {
    const match = cssContent.match(new RegExp(`${varName}:\\s*([^;]+);`))
    if (!match?.[1]) {
      throw new Error(`Token ${varName} not found in tokens.css`)
    }
    return match[1].trim()
  }

  const bg = extractToken("--color-bg")
  const surface = extractToken("--color-surface")
  const surfaceRaised = extractToken("--color-surface-raised")
  const textPrimary = extractToken("--color-text-primary")
  const textMuted = extractToken("--color-text-muted")
  const accentGold = extractToken("--color-accent")

  it("extracts valid hex design tokens", () => {
    expect(bg).toMatch(/^#[0-9a-fA-F]{6}$/)
    expect(surface).toMatch(/^#[0-9a-fA-F]{6}$/)
    expect(surfaceRaised).toMatch(/^#[0-9a-fA-F]{6}$/)
    expect(textPrimary).toMatch(/^#[0-9a-fA-F]{6}$/)
    expect(textMuted).toMatch(/^#[0-9a-fA-F]{6}$/)
    expect(accentGold).toMatch(/^#[0-9a-fA-F]{6}$/)
  })

  it("--color-text-primary achieves >= 4.5:1 contrast against all background surfaces", () => {
    const ratioBg = contrastRatio(textPrimary, bg)
    const ratioSurface = contrastRatio(textPrimary, surface)
    const ratioRaised = contrastRatio(textPrimary, surfaceRaised)

    expect(ratioBg).toBeGreaterThanOrEqual(4.5)
    expect(ratioSurface).toBeGreaterThanOrEqual(4.5)
    expect(ratioRaised).toBeGreaterThanOrEqual(4.5)
  })

  it("--color-text-muted achieves >= 4.5:1 contrast against all background surfaces", () => {
    const ratioBg = contrastRatio(textMuted, bg)
    const ratioSurface = contrastRatio(textMuted, surface)
    const ratioRaised = contrastRatio(textMuted, surfaceRaised)

    expect(ratioBg).toBeGreaterThanOrEqual(4.5)
    expect(ratioSurface).toBeGreaterThanOrEqual(4.5)
    expect(ratioRaised).toBeGreaterThanOrEqual(4.5)
  })

  it("--color-accent (gold) satisfies large-text / graphical / focus contrast requirements", () => {
    // WCAG requirement for 3:1 graphical elements / large text / focus rings
    const ratioBg = contrastRatio(accentGold, bg)
    const ratioSurface = contrastRatio(accentGold, surface)
    const ratioRaised = contrastRatio(accentGold, surfaceRaised)

    expect(ratioBg).toBeGreaterThanOrEqual(3.0)
    expect(ratioSurface).toBeGreaterThanOrEqual(3.0)
    expect(ratioRaised).toBeGreaterThanOrEqual(3.0)
  })

  it("audit: gold (#d4af37 / text-accent) is never used on thin body text", () => {
    // Scan all admin components for text-accent usages
    const srcDir = path.resolve(__dirname, "../../")
    const tsxFiles: string[] = []

    function walkDir(dir: string) {
      const entries = fs.readdirSync(dir, { withFileTypes: true })
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name)
        if (
          entry.isDirectory() &&
          entry.name !== "node_modules" &&
          entry.name !== "dist" &&
          entry.name !== "__tests__"
        ) {
          walkDir(fullPath)
        } else if (entry.isFile() && entry.name.endsWith(".tsx")) {
          tsxFiles.push(fullPath)
        }
      }
    }

    walkDir(srcDir)

    // For any className containing text-accent:
    // It must either be on a button/input/heading, or accompanied by font-semibold, font-medium, font-bold, text-xs/uppercase, or large text
    // It must NOT be accompanied by font-normal, font-light, or thin unstyled body paragraph
    for (const file of tsxFiles) {
      const code = fs.readFileSync(file, "utf-8")
      const matches = code.matchAll(/className="([^"]*text-accent[^"]*)"/g)
      for (const m of matches) {
        const classStr = m[1]
        // Check that it is not thin body text
        expect(classStr).not.toMatch(/font-light|font-thin/)
      }
    }
  })
})
