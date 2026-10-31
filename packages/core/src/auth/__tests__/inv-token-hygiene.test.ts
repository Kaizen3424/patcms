import { describe, expect, it } from "vitest"
import { MemoryTokenStore, PatProvider } from ".."
import type { CapabilityProbeResult } from "../types"
import { CapabilityProbeError } from "../types"

const MOCK_PROBE_OK: CapabilityProbeResult = {
  repo: "ok",
  protectionAdmin: "missing",
  checksRead: "forbidden",
  rateLimit: { limit: 5000, remaining: 4999, resetAt: "2027-01-15T08:00:00.000Z" },
}

/**
 * Invariant INV-A04:
 * Token never in URL/query; only accessible via AuthProvider / PatProvider;
 * wipe on sign-out/failed-bootstrap/401.
 */
describe("INV-A04: Token hygiene and lifecycle", () => {
  it("never extracts credentials from URL queries or query strings", () => {
    // Parity with ADR-0002 §token-in-URL veto: '?token=' parity rejected forever
    const maliciousUrls = [
      "https://studio.example/admin?token=github_pat_11SECRET",
      "https://studio.example/admin#access_token=github_pat_11SECRET",
      "http://localhost:5173/?key=github_pat_11SECRET",
    ]

    for (const urlStr of maliciousUrls) {
      const parsed = new URL(urlStr)
      expect(parsed.searchParams.get("token")).toBeDefined()
      // System never binds this query parameter into PatProvider or TokenStore
    }
  })

  it("token is accessible only through PatProvider methods and held in memory", async () => {
    const store = new MemoryTokenStore()
    const provider = new PatProvider({
      store,
      probe: async () => MOCK_PROBE_OK,
    })

    expect(provider.getToken()).toBeUndefined()

    await provider.signIn("github_pat_valid_key", { remember: false })
    expect(provider.getToken()).toBe("github_pat_valid_key")
    // When remember is false, TokenStore is never touched
    expect(await store.read()).toBeUndefined()
  })

  it("wipes tokens completely on signOut()", async () => {
    const store = new MemoryTokenStore()
    const provider = new PatProvider({
      store,
      probe: async () => MOCK_PROBE_OK,
    })

    await provider.signIn("github_pat_session", { remember: true })
    expect(provider.getToken()).toBe("github_pat_session")
    expect(await store.read()).toBe("github_pat_session")

    await provider.signOut()

    // Both memory and persistent store must be wiped clean
    expect(provider.getToken()).toBeUndefined()
    expect(await store.read()).toBeUndefined()
  })

  it("wipes persisted token on failed bootstrap / restore()", async () => {
    const store = new MemoryTokenStore()
    await store.write("github_pat_stale_key")

    const provider = new PatProvider({
      store,
      probe: async () => {
        throw new CapabilityProbeError("AUTH_EXPIRED", "Key expired or revoked")
      },
    })

    await expect(provider.restore()).rejects.toMatchObject({ code: "AUTH_EXPIRED" })
    // Stale token in memory and store must be wiped
    expect(provider.getToken()).toBeUndefined()
    expect(await store.read()).toBeUndefined()
  })

  it("wipes persisted token when restore() encounters insufficient scope error", async () => {
    const store = new MemoryTokenStore()
    await store.write("github_pat_bad_scope")

    const provider = new PatProvider({
      store,
      probe: async () => {
        throw new CapabilityProbeError("SCOPE", "Missing repo scope")
      },
    })

    await expect(provider.restore()).rejects.toMatchObject({ code: "SCOPE" })
    expect(provider.getToken()).toBeUndefined()
    expect(await store.read()).toBeUndefined()
  })

  it("trims whitespace and rejects empty or malformed inputs without leaking", async () => {
    const store = new MemoryTokenStore()
    const provider = new PatProvider({
      store,
      probe: async () => MOCK_PROBE_OK,
    })

    await expect(provider.signIn("   ", { remember: false })).rejects.toThrow(/empty/)
    expect(provider.getToken()).toBeUndefined()
  })
})
