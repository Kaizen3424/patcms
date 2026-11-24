/**
 * Re-export of the core test-support reference model — one model, no
 * hand-synced copy.
 *
 * The published package ships no fake (INV-N05): the playground, a dev-only
 * harness, reaches the model through the workspace-only `patcms/test-support`
 * export, which `publishConfig.exports` strips from the tarball. Semantics
 * live in `packages/core/src/__tests__/support/fake-github-server.ts`; do not
 * re-implement them here.
 */

export * from "patcms/test-support"
