import { describe, expect, it } from "vitest"
import { createLogger, isSensitiveKey, maskData, maskString } from "../logger"

/**
 * Invariant INV-A05:
 * Log masking: authorization/token/secret/x-github-* keys + github_pat_./ghp_./email value-regex masked;
 * ring buffer memory-only.
 */
describe("INV-A05: Log masking and memory-only ring buffer", () => {
  describe("key-level masking", () => {
    it("identifies credential keys case-insensitively", () => {
      expect(isSensitiveKey("authorization")).toBe(true)
      expect(isSensitiveKey("Authorization")).toBe(true)
      expect(isSensitiveKey("AUTHORIZATION")).toBe(true)
      expect(isSensitiveKey("token")).toBe(true)
      expect(isSensitiveKey("Token")).toBe(true)
      expect(isSensitiveKey("secret")).toBe(true)
      expect(isSensitiveKey("password")).toBe(true)
    })

    it("identifies all x-github-* headers case-insensitively", () => {
      expect(isSensitiveKey("x-github-request-id")).toBe(true)
      expect(isSensitiveKey("X-GitHub-Delivery")).toBe(true)
      expect(isSensitiveKey("X-GITHUB-SSO")).toBe(true)
    })

    it("does not mask safe keys", () => {
      expect(isSensitiveKey("name")).toBe(false)
      expect(isSensitiveKey("branch")).toBe(false)
      expect(isSensitiveKey("status")).toBe(false)
      expect(isSensitiveKey("content")).toBe(false)
    })
  })

  describe("value pattern masking", () => {
    it("masks fine-grained GitHub PATs (github_pat_...)", () => {
      const input = "Failed auth with github_pat_11ABC_xyz789_DEF456"
      expect(maskString(input)).toBe("Failed auth with [token]")
    })

    it("masks classic GitHub tokens (ghp_, gho_, ghu_, ghs_, ghr_)", () => {
      const ghp = "Token: ghp_123456789012345678901234567890123456"
      const gho = "OAuth: gho_123456789012345678901234567890123456"
      expect(maskString(ghp)).toBe("Token: [token]")
      expect(maskString(gho)).toBe("OAuth: [token]")
    })

    it("masks email addresses", () => {
      const text = "Contacting founder@studio.example or dev.test+alias@domain.co.uk for support"
      expect(maskString(text)).toBe("Contacting [email] or [email] for support")
    })
  })

  describe("data structure recursion & depth caps", () => {
    it("recursively masks nested objects and arrays", () => {
      const payload = {
        user: {
          email: "user@example.com",
          token: "secret-raw-token",
          details: {
            authHeader: "Bearer github_pat_11AAABBBCCC",
          },
        },
        items: [{ authorization: "Basic 123" }, { info: "contact test@mail.com" }],
      }

      const masked = maskData(payload, 0) as Record<string, unknown>
      const user = masked.user as Record<string, unknown>
      const details = user.details as Record<string, unknown>
      const items = masked.items as Array<Record<string, unknown>>

      expect(user.email).toBe("[email]")
      expect(user.token).toBe("[masked]")
      expect(details.authHeader).toBe("Bearer [token]")
      expect(items[0]?.authorization).toBe("[masked]")
      expect(items[1]?.info).toBe("contact [email]")
    })

    it("protects against deeply nested structures with depth limit", () => {
      let deep: Record<string, unknown> = { leaf: "val" }
      for (let i = 0; i < 12; i++) {
        deep = { next: deep }
      }

      const result = maskData(deep, 0)
      expect(JSON.stringify(result)).toContain("[depth-limit]")
    })
  })

  describe("ring buffer memory-only invariants", () => {
    it("stores records in memory and adheres to capacity cap", () => {
      const logger = createLogger(5)
      for (let i = 1; i <= 10; i++) {
        logger.info(`Message ${i}`, { token: `github_pat_${i}` })
      }

      expect(logger.history).toHaveLength(5)
      expect(logger.history[0]?.message).toBe("Message 6")
      expect(logger.history[4]?.message).toBe("Message 10")
      expect((logger.history[4]?.data as Record<string, unknown>)?.token).toBe("[masked]")
    })

    it("ensures history snapshots are completely immutable to external callers", () => {
      const logger = createLogger(10)
      logger.warn("Warning event")

      const snap1 = logger.history
      // Mutating snap1 should not affect internal ring or subsequent snapshots
      ;(snap1 as unknown as unknown[]).push("foreign-injection")

      expect(logger.history).toHaveLength(1)
      expect(logger.history[0]?.message).toBe("Warning event")
    })
  })
})
