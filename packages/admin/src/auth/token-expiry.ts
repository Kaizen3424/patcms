import type { TokenExpiryConfig } from "../storage/token-expiry-store"

export {
  clearTokenExpiryConfig,
  getTokenExpiryConfig,
  setTokenExpiryConfig,
} from "../storage/token-expiry-store"
export type { TokenExpiryConfig }

export interface TokenExpiryState {
  readonly expiresAt: string
  readonly daysRemaining: number
  readonly isExpiringSoon: boolean // <= 14 days
  readonly isCritical: boolean // <= 7 days
  readonly isExpired: boolean // <= 0 days
}

export function describeTokenExpiry(
  config: TokenExpiryConfig,
  nowEpochMs: number = Date.now(),
): TokenExpiryState {
  const createdMs = new Date(config.createdAt).getTime()
  const expiresMs = createdMs + config.durationDays * 24 * 60 * 60 * 1000
  const diffMs = expiresMs - nowEpochMs
  const daysRemaining = Math.ceil(diffMs / (24 * 60 * 60 * 1000))

  return {
    expiresAt: new Date(expiresMs).toISOString(),
    daysRemaining,
    isExpiringSoon: daysRemaining <= 14,
    isCritical: daysRemaining <= 7,
    isExpired: daysRemaining <= 0,
  }
}
