/**
 * vitest (L0 tier, 01-spec §4). The coverage gate watches the three law
 * modules from day one; P0 stubs carry enough tested executable surface to
 * hold the gate before P1/P2 land mechanisms.
 */
import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    coverage: {
      enabled: true,
      include: ["src/pipeline/**", "src/fields/**", "src/safety/**", "src/status/**"],
      thresholds: { lines: 90, statements: 90 },
    },
  },
})
