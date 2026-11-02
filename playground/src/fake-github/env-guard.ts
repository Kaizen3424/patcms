/**
 * Env-kill guard — master-plan §8.11: real GitHub is DISABLED unless
 * PATCMS_ALLOW_REAL_GITHUB is set to exactly "1" (INV-A05-adjacent; unit test
 * asserts the refusal). When enabled outside tests, the harness must render
 * the RED TARGET banner (REAL_TARGET_BANNER) — never silently talk to a real repo.
 */

/** Exactly the env var name that must equal "1" to unlock a real target. */
export const REAL_TARGET_ENV = "PATCMS_ALLOW_REAL_GITHUB"

/** Visible target label — red banner text when a real repo is the target. */
export const REAL_TARGET_BANNER = "REAL REPO TARGET"

export type EnvLike = Readonly<Record<string, string | undefined>>

/**
 * Refuses real GitHub unless the kill-guard env var is exactly "1".
 * Any other value ("true", "yes", "0", undefined, empty) stays refused —
 * accept-by-run explicitness only.
 */
export function allowRealGithub(env: EnvLike): boolean {
  return env[REAL_TARGET_ENV] === "1"
}
