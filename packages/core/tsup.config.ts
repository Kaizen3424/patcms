/** Library build (ADR-0010 §5): ESM-only, no CJS. Dev/consumption uses source exports.
 * dts is emitted by `tsc -b` into dist-types (TS 7 has no compiler API for
 * rollup-plugin-dts; record: revisit the dts bundling at P7 publish). */
import { defineConfig } from "tsup"

export default defineConfig({
  entry: ["src/index.ts", "src/advanced.ts", "src/web/index.ts"],
  format: ["esm"],
  target: "es2023",
  dts: false,
  sourcemap: false,
  clean: true,
  outDir: "dist",
})
