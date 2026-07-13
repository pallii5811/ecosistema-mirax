import type { SupabaseClient } from '@supabase/supabase-js'

export type MarginalCostOperation =
  | 'intent_compilation'
  | 'web_search'
  | 'page_fetch'
  | 'browser_audit'
  | 'llm_extraction'
  | 'contact_enrichment'
  | 'registry_lookup'
  | 'review_lookup'
  | 'news_lookup'

export type CostReservationInput = {
  searchId: string
  idempotencyKey: string
  operationType: MarginalCostOperation
  estimatedCostEur: number
  provider?: string
  model?: string
  sourceClass?: string
  candidateId?: string
  units?: number
  metadata?: Record<string, unknown>
  ttlSeconds?: number
  retryOfId?: string
  cacheHit?: boolean
}

export class PersistentCostGovernorError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message)
    this.name = 'PersistentCostGovernorError'
  }
}

function assertMoney(value: number, field: string) {
  if (!Number.isFinite(value) || value < 0) {
    throw new TypeError(`${field} must be a finite non-negative EUR amount`)
  }
}

function rpcError(error: { message?: string; code?: string } | null, fallback: string): never {
  const message = String(error?.message || fallback)
  const knownCode = [
    'RESEARCH_HARD_BUDGET_EXCEEDED',
    'SEARCH_BUDGET_HALTED',
    'SEARCH_BUDGET_NOT_INITIALIZED',
    'HARD_BUDGET_ABOVE_PRODUCT_CAP',
    'BUDGET_ESCALATION_FORBIDDEN',
  ].find((code) => message.includes(code))
  throw new PersistentCostGovernorError(message, knownCode || error?.code || fallback)
}

/**
 * Distributed spending gate. This client must use the service role; the SQL RPCs
 * are intentionally unavailable to browser/anon/authenticated clients.
 */
export class PersistentResearchCostGovernor {
  constructor(private readonly supabase: SupabaseClient) {}

  async initialize(searchId: string, requestedLeads: number) {
    const count = Math.max(1, Math.min(10_000, Math.trunc(requestedLeads)))
    const targetCostEur = Number((count * 0.021).toFixed(8))
    const hardCostEur = Number((count * 0.025).toFixed(8))
    const { data, error } = await this.supabase.rpc('initialize_search_budget', {
      p_search_id: searchId,
      p_target_cost_eur: targetCostEur,
      p_hard_cost_eur: hardCostEur,
    })
    if (error) rpcError(error, 'SEARCH_BUDGET_INITIALIZATION_FAILED')
    return data
  }

  async reserve(input: CostReservationInput) {
    assertMoney(input.estimatedCostEur, 'estimatedCostEur')
    if (!input.searchId || !input.idempotencyKey || !input.operationType) {
      throw new TypeError('searchId, idempotencyKey and operationType are required')
    }
    const { data, error } = await this.supabase.rpc('reserve_search_cost', {
      p_search_id: input.searchId,
      p_idempotency_key: input.idempotencyKey,
      p_operation_type: input.operationType,
      p_estimated_cost_eur: input.estimatedCostEur,
      p_provider: input.provider ?? null,
      p_model: input.model ?? null,
      p_source_class: input.sourceClass ?? null,
      p_candidate_id: input.candidateId ?? null,
      p_units: input.units ?? 1,
      p_metadata: input.metadata ?? {},
      p_ttl_seconds: input.ttlSeconds ?? 900,
      p_retry_of_id: input.retryOfId ?? null,
      p_cache_hit: input.cacheHit ?? false,
    })
    if (error) rpcError(error, 'COST_RESERVATION_FAILED')
    return data
  }

  async settle(searchId: string, idempotencyKey: string, actualCostEur: number, metadata = {}) {
    assertMoney(actualCostEur, 'actualCostEur')
    const { data, error } = await this.supabase.rpc('settle_search_cost', {
      p_search_id: searchId,
      p_idempotency_key: idempotencyKey,
      p_actual_cost_eur: actualCostEur,
      p_metadata: metadata,
    })
    if (error) rpcError(error, 'COST_SETTLEMENT_FAILED')
    return data
  }

  async release(searchId: string, idempotencyKey: string, errorCode?: string) {
    const { data, error } = await this.supabase.rpc('release_search_cost', {
      p_search_id: searchId,
      p_idempotency_key: idempotencyKey,
      p_status: errorCode ? 'failed' : 'released',
      p_error_code: errorCode ?? null,
    })
    if (error) rpcError(error, 'COST_RELEASE_FAILED')
    return data
  }

  async recoverStale(searchId: string): Promise<number> {
    const { data, error } = await this.supabase.rpc('release_stale_search_costs', {
      p_search_id: searchId,
    })
    if (error) rpcError(error, 'STALE_COST_RECOVERY_FAILED')
    return Number(data || 0)
  }

  async runReserved<T>(
    input: CostReservationInput,
    operation: () => Promise<{ value: T; actualCostEur: number; metadata?: Record<string, unknown> }>,
  ): Promise<T> {
    await this.reserve(input)
    try {
      const result = await operation()
      await this.settle(input.searchId, input.idempotencyKey, result.actualCostEur, result.metadata)
      return result.value
    } catch (error) {
      // The operation has already started, so provider delivery may be
      // ambiguous. Conservatively settle the reservation; never erase a
      // potentially billable request as if it were free.
      await this.settle(input.searchId, input.idempotencyKey, input.estimatedCostEur, {
        outcome: 'operation_failed_after_reservation',
        error_type: error instanceof Error ? error.name || 'OPERATION_FAILED' : 'OPERATION_FAILED',
      })
      throw error
    }
  }
}
