/**
 * Testing Library teardown: unmount every rendered tree between tests so a
 * stray subscription (save coordinator, lease) cannot leak into the next case.
 * Explicit import (not a global) because the admin tsconfig pins `types` to
 * `vite/client`.
 */
import { cleanup } from "@testing-library/react"
import { afterEach } from "vitest"

afterEach(() => {
  cleanup()
})
