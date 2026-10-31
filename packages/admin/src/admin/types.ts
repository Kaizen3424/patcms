/** Admin composition types — host supplies JSON-safe config + repository target. */
import type {
  AdminConfig,
  DraftStore,
  FetchLike,
  LeaseCarrier,
  Logger,
  StatusTiming,
  TokenStore,
} from "@mycms/core"
import type { JournalStore } from "@mycms/core/web"

export interface SupportContext {
  /** The named human every founder-facing surface references — never "someone" (master-plan §7). */
  readonly name: string
}

/** Repository target for the git-backed read/write transport. Branch is always data. */
export interface AdminRepository {
  readonly owner: string
  readonly repo: string
  readonly branch: string
  /** API origin override for fixtures/proxies; defaults to https://api.github.com. */
  readonly baseUrl?: string
}

export interface AdminMountOptions {
  readonly config: AdminConfig
  readonly support: SupportContext
  readonly repository: AdminRepository
  /** Injectable transport (MSW tests / host fetch). Defaults to globalThis.fetch. */
  readonly fetch?: FetchLike
  /** Injectable token store (tests / per-device fallback). Defaults to the opt-in IDB store. */
  readonly tokenStore?: TokenStore
  /** Injectable draft store (tests). Defaults to IDB with an in-memory fallback. */
  readonly draftStore?: DraftStore
  /** Injectable publish journal store (tests). Defaults to IDB with memory fallback (P5.2). */
  readonly journalStore?: JournalStore
  /** Injectable memory logger (tests). Defaults to createLogger() (P5.10). */
  readonly logger?: Logger
  /** Injectable cross-tab lease carrier (tests / hosts without BroadcastChannel). */
  readonly leaseCarrier?: LeaseCarrier
  /**
   * Lease TTL override (epoch ms, default 15 000 — ADR-0004). Host/test seam for
   * deterministic cross-tab journeys; hard UX rules are untouched by it.
   */
  readonly leaseTtlMs?: number
  /** Deploy-status poll cadence overrides (ADR-0008 P2.8). */
  readonly statusTiming?: Partial<StatusTiming>
}
