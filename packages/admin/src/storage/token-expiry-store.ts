/// <reference lib="dom" />
/**
 * IndexedDB Token Expiry store (P5.7).
 * Persists token expiry metadata in the shared "mycms" database under the "auth" store.
 */
import { del, get, set } from "idb-keyval"
import { createSharedStore } from "patcms/web"

export interface TokenExpiryConfig {
  readonly createdAt: string
  readonly durationDays: 30 | 60 | 90
}

const EXPIRY_STORE_KEY = "token_expiry_config"

let memoryExpiryConfig: TokenExpiryConfig | null = null

export async function getTokenExpiryConfig(): Promise<TokenExpiryConfig | null> {
  if (typeof indexedDB === "undefined") {
    return memoryExpiryConfig
  }
  try {
    const store = createSharedStore("mycms", "auth")
    const value = await get<TokenExpiryConfig>(EXPIRY_STORE_KEY, store)
    return value ?? memoryExpiryConfig
  } catch {
    return memoryExpiryConfig
  }
}

export async function setTokenExpiryConfig(config: TokenExpiryConfig): Promise<void> {
  memoryExpiryConfig = config
  if (typeof indexedDB !== "undefined") {
    try {
      const store = createSharedStore("mycms", "auth")
      await set(EXPIRY_STORE_KEY, config, store)
    } catch {
      // fail-soft
    }
  }
}

export async function clearTokenExpiryConfig(): Promise<void> {
  memoryExpiryConfig = null
  if (typeof indexedDB !== "undefined") {
    try {
      const store = createSharedStore("mycms", "auth")
      await del(EXPIRY_STORE_KEY, store)
    } catch {
      // fail-soft
    }
  }
}
