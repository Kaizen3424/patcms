# patcms

## 0.1.0

### Minor Changes

- a56402d: The headless client: `createCMS()` with `auth`, `entries`, `media`, `drafts`, and `events`; saves are single fast-forward-only commits whose conflicts come back as values; unmodeled keys are preserved verbatim across saves; the surface is split into `patcms`, `patcms/advanced`, and `patcms/web`.
- b0b921b: P1 read path: zod-first config DSL, lenient parse and strict-save validator, source-preserving serializer, GitHub read backend with ETag/truncation handling, snapshot cache, PAT lifecycle and capability probe.
- cad4c33: Phase 4 media system: media service bijection & budget math (INV-M01), findReferences engine, media library tombstone ladder (INV-M03), and blob preview caching in the example panel. (The Web Worker raster normalization pipeline shipped only in the deleted reference admin.)
