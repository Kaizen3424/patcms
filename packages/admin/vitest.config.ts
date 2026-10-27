/**
 * Admin test config (P2.6) — jsdom + Testing Library for component/widget
 * tests. Node-only logic (index/form models) runs here too; nothing in this
 * config touches the network (MSW belongs to the playground/e2e tiers).
 */
import react from "@vitejs/plugin-react"
import { defineConfig } from "vitest/config"

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["./src/test/setup.ts"],
    restoreMocks: true,
  },
})
