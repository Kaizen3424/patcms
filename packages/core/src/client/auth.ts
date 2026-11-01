/**
 * Auth namespace — PAT lifecycle with a capability probe on every sign-in.
 *
 * A pre-set `token` seeds the client WITHOUT a network call, so constructing a
 * client for a script costs nothing; call `verify()` when capabilities matter.
 */

import type { TokenStore } from "../auth"
import { MemoryTokenStore, PatProvider } from "../auth"
import type { CapabilityProbeResult } from "../auth/types"
import { probeGithubCapabilities } from "../backend/github/probe"
import type { FetchLike } from "../composition"
import { CMSError, toCMSError } from "./errors"
import type { AuthAPI, AuthStatus, RepositoryTarget, Session, SignInOptions } from "./types"

export interface AuthControllerOptions {
  readonly repository: RepositoryTarget
  readonly tokenStore: TokenStore
  readonly fetch: FetchLike
}

export class AuthController implements AuthAPI {
  readonly #repository: RepositoryTarget
  readonly #provider: PatProvider
  readonly #listeners = new Set<(status: AuthStatus) => void>()
  #status: AuthStatus = "signedOut"
  #session: Session | undefined
  #seededToken: string | undefined

  constructor(options: AuthControllerOptions) {
    this.#repository = options.repository
    this.#provider = new PatProvider({
      store: options.tokenStore,
      probe: (token) =>
        probeGithubCapabilities({
          owner: options.repository.owner,
          repo: options.repository.repo,
          branch: options.repository.branch,
          token,
          fetch: options.fetch,
          ...(options.repository.baseUrl === undefined
            ? {}
            : { baseUrl: options.repository.baseUrl }),
        }),
    })
  }

  get status(): AuthStatus {
    return this.#status
  }

  get session(): Session | undefined {
    return this.#session
  }

  /** Transport-only read. Never expose this on the public `CMS` object. */
  get currentToken(): string | undefined {
    return this.#provider.getToken() ?? this.#seededToken
  }

  get isSignedIn(): boolean {
    return this.currentToken !== undefined
  }

  /** Pre-set token: no probe, therefore no network request at construction. */
  seed(token: string): void {
    this.#seededToken = token
    this.#setStatus("signedIn")
  }

  async signIn(token: string, options: SignInOptions = {}): Promise<Session> {
    this.#setStatus("checking")
    try {
      const probe = await this.#provider.signIn(token, { remember: options.remember === true })
      this.#seededToken = undefined
      return this.#applyProbe(probe)
    } catch (error) {
      this.#clearSession()
      throw toCMSError(error)
    }
  }

  async restore(): Promise<Session | undefined> {
    this.#setStatus("checking")
    try {
      const probe = await this.#provider.restore()
      if (probe === undefined) {
        this.#clearSession()
        return undefined
      }
      return this.#applyProbe(probe)
    } catch (error) {
      // PatProvider already wiped the stored token before rethrowing.
      this.#clearSession()
      throw toCMSError(error)
    }
  }

  async verify(): Promise<Session> {
    if (this.#provider.getToken() === undefined) {
      if (this.#seededToken !== undefined) return this.signIn(this.#seededToken)
      throw new CMSError("AUTH_REQUIRED", "sign in before verifying the session")
    }

    this.#setStatus("checking")
    try {
      const probe = await this.#provider.reprobe()
      return this.#applyProbe(probe)
    } catch (error) {
      this.#clearSession()
      throw toCMSError(error)
    }
  }

  async signOut(): Promise<void> {
    await this.#provider.signOut()
    this.#seededToken = undefined
    this.#clearSession()
  }

  /**
   * A write failed with 401: the token is dead. Wipe it (and any persisted
   * copy) without waiting for the store, then surface `signedOut` to the host.
   */
  markExpired(): void {
    this.#seededToken = undefined
    this.#clearSession()
    void this.#provider.signOut().catch(() => undefined)
  }

  onChange(listener: (status: AuthStatus) => void): () => void {
    this.#listeners.add(listener)
    return () => {
      this.#listeners.delete(listener)
    }
  }

  #applyProbe(probe: CapabilityProbeResult): Session {
    const session: Session = {
      repository: this.#repository,
      capabilities: probe,
      rateLimit: probe.rateLimit,
    }
    this.#session = session
    this.#setStatus("signedIn")
    return session
  }

  #clearSession(): void {
    this.#session = undefined
    this.#setStatus("signedOut")
  }

  #setStatus(status: AuthStatus): void {
    if (this.#status === status) return
    this.#status = status
    for (const listener of [...this.#listeners]) listener(status)
  }
}

/** Default store: memory-only, so a token never outlives the page by accident. */
export function defaultTokenStore(): TokenStore {
  return new MemoryTokenStore()
}
