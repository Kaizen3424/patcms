import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { HandoverCard } from "../handover-card"
import {
  clearTokenExpiryConfig,
  describeTokenExpiry,
  getTokenExpiryConfig,
  setTokenExpiryConfig,
  type TokenExpiryConfig,
} from "../token-expiry"

describe("token expiry kit (P5.7)", () => {
  beforeEach(async () => {
    await clearTokenExpiryConfig()
  })

  describe("describeTokenExpiry", () => {
    const baseCreatedAt = "2026-01-01T00:00:00.000Z"
    const baseCreatedMs = new Date(baseCreatedAt).getTime()

    it("evaluates when key has plenty of time left", () => {
      const config: TokenExpiryConfig = {
        createdAt: baseCreatedAt,
        durationDays: 60,
      }
      const nowMs = baseCreatedMs + 10 * 24 * 60 * 60 * 1000 // 10 days passed
      const state = describeTokenExpiry(config, nowMs)

      expect(state.daysRemaining).toBe(50)
      expect(state.isExpiringSoon).toBe(false)
      expect(state.isCritical).toBe(false)
      expect(state.isExpired).toBe(false)
    })

    it("flags expiring soon when within 14 days", () => {
      const config: TokenExpiryConfig = {
        createdAt: baseCreatedAt,
        durationDays: 60,
      }
      const nowMs = baseCreatedMs + 50 * 24 * 60 * 60 * 1000 // 50 days passed -> 10 days left
      const state = describeTokenExpiry(config, nowMs)

      expect(state.daysRemaining).toBe(10)
      expect(state.isExpiringSoon).toBe(true)
      expect(state.isCritical).toBe(false)
      expect(state.isExpired).toBe(false)
    })

    it("flags critical when within 7 days", () => {
      const config: TokenExpiryConfig = {
        createdAt: baseCreatedAt,
        durationDays: 60,
      }
      const nowMs = baseCreatedMs + 55 * 24 * 60 * 60 * 1000 // 55 days passed -> 5 days left
      const state = describeTokenExpiry(config, nowMs)

      expect(state.daysRemaining).toBe(5)
      expect(state.isExpiringSoon).toBe(true)
      expect(state.isCritical).toBe(true)
      expect(state.isExpired).toBe(false)
    })

    it("flags expired when past duration", () => {
      const config: TokenExpiryConfig = {
        createdAt: baseCreatedAt,
        durationDays: 60,
      }
      const nowMs = baseCreatedMs + 62 * 24 * 60 * 60 * 1000 // 62 days passed -> -2 days
      const state = describeTokenExpiry(config, nowMs)

      expect(state.daysRemaining).toBeLessThanOrEqual(0)
      expect(state.isExpired).toBe(true)
    })
  })

  describe("store persistence", () => {
    it("saves and retrieves config", async () => {
      const config: TokenExpiryConfig = {
        createdAt: "2026-03-01T00:00:00.000Z",
        durationDays: 90,
      }
      await setTokenExpiryConfig(config)
      const retrieved = await getTokenExpiryConfig()

      expect(retrieved).toEqual(config)

      await clearTokenExpiryConfig()
      const cleared = await getTokenExpiryConfig()
      expect(cleared).toBeNull()
    })
  })

  describe("HandoverCard", () => {
    it("renders form and triggers onSaved on submission", async () => {
      const onSaved = vi.fn()
      render(<HandoverCard onSaved={onSaved} />)

      const saveBtn = screen.getByTestId("save-handover-button")
      fireEvent.click(saveBtn)

      await waitFor(() => {
        expect(onSaved).toHaveBeenCalledOnce()
      })
    })
  })
})
