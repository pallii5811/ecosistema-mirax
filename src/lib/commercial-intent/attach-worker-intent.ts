import type { CommercialSearchPlan } from '@/lib/contracts/commercial-search-plan'
import { commercialIntentSpecFromSearchPlan } from './map-from-search-plan'
import { planOfferToBuyerNeed } from './offer-to-buyer-need-planner'
import type { CommercialIntentSpec } from './types'
import { DEFAULT_MIRAX_MARKET_SCOPE_POLICY } from './types'

export type WorkerCommercialIntentBundle = {
  commercial_intent_spec: CommercialIntentSpec
  commercial_hypotheses: ReturnType<typeof planOfferToBuyerNeed>
  intent_compiler_telemetry: Record<string, unknown>
}

export function buildWorkerCommercialIntentBundle(
  query: string,
  plan?: CommercialSearchPlan | null,
  telemetry?: Record<string, unknown>,
): WorkerCommercialIntentBundle | null {
  if (!plan?.raw_query) return null
  const spec = commercialIntentSpecFromSearchPlan(plan)
  if (!spec.target_company_profile.market_scope_policy) {
    spec.target_company_profile.market_scope_policy = { ...DEFAULT_MIRAX_MARKET_SCOPE_POLICY }
  }
  const hypotheses =
    spec.request_mode === 'seller_driven_lead_discovery' ||
    spec.request_mode === 'event_based_discovery'
      ? planOfferToBuyerNeed(spec)
      : (spec.commercial_hypotheses ?? [])
  spec.commercial_hypotheses = hypotheses
  return {
    commercial_intent_spec: spec,
    commercial_hypotheses: hypotheses,
    intent_compiler_telemetry: {
      compiler_tier: telemetry?.intent_compiler_tier ?? telemetry?.query_tier2_calls ? 2 : 1,
      cache_hit: telemetry?.compiler_cache_hit ?? telemetry?.query_compilation_status === 'cache_hit',
      confidence: spec.confidence,
      cost_eur: telemetry?.compiler_cost_eur ?? telemetry?.query_compilation_cost ?? 0,
      request_mode: spec.request_mode,
      seller_offer: spec.seller_offer?.description,
      buyer_need: spec.buyer_need,
      target_role: spec.target_role,
      hypotheses_count: hypotheses.length,
      original_query: query,
      ...telemetry,
    },
  }
}
