import {
  compileCommercialSearchPlan,
  type CommercialIntentCompilerOptions,
  type QueryCompilerTelemetry,
} from '@/lib/intent-compiler/compile-commercial-search-plan'
import { buildHeuristicMiraxQueryPlan } from '@/lib/uqe/mirax-query-planner'
import { compileCommercialIntentSpecHeuristic } from './compile-heuristic'
import { commercialIntentSpecFromSearchPlan } from './map-from-search-plan'
import { planOfferToBuyerNeed } from './offer-to-buyer-need-planner'
import { extractCommercialIntentHints } from './hints'
import type { CommercialIntentSpec } from './types'

export type IntentCompilerTelemetry = QueryCompilerTelemetry & {
  intent_compiler_tier: 0 | 1 | 2
  compiler_cache_hit: boolean
  compiler_cost_eur: number
}

export type CompileCommercialIntentOptions = CommercialIntentCompilerOptions & {
  /** When true, regex/heuristic is used only if semantic model unavailable. */
  allowHeuristicFallback?: boolean
}

function heuristicFromMirax(query: string): CommercialIntentSpec {
  const plan = buildHeuristicMiraxQueryPlan(query)
  const spec = compileCommercialIntentSpecHeuristic(query)
  return {
    ...spec,
    normalized_goal: plan.intent_summary || spec.normalized_goal,
    geography: plan.location ? [plan.location] : spec.geography,
    sectors: plan.sector ? [plan.sector] : spec.sectors,
    confidence: Math.min(spec.confidence, 0.55),
  }
}

/**
 * Tiered semantic Commercial Intent Compiler.
 * Tier 0: cache + deterministic hints (handled inside compileCommercialSearchPlan).
 * Tier 1/2: authoritative semantic model via compileCommercialSearchPlan.
 * Regex/heuristic only when semantic path unavailable and allowHeuristicFallback=true.
 */
export async function compileCommercialIntentSemantic(
  query: string,
  options: CompileCommercialIntentOptions = {},
): Promise<{ spec: CommercialIntentSpec; telemetry: IntentCompilerTelemetry }> {
  const hints = extractCommercialIntentHints(query)
  let telemetry: IntentCompilerTelemetry = {
    query_tier1_calls: 0,
    query_tier2_calls: 0,
    query_cache_hits: 0,
    query_input_tokens: 0,
    query_output_tokens: 0,
    query_compilation_cost: 0,
    query_compilation_status: 'failed',
    tier2_escalation_reason: null,
    contract_hash: null,
    intent_compiler_tier: 0,
    compiler_cache_hit: false,
    compiler_cost_eur: 0,
  }

  const plan = await compileCommercialSearchPlan(query, {
    ...options,
    onTelemetry: (event) => {
      telemetry = {
        ...event,
        intent_compiler_tier: event.query_tier2_calls > 0 ? 2 : event.query_tier1_calls > 0 ? 1 : 0,
        compiler_cache_hit: event.query_compilation_status === 'cache_hit',
        compiler_cost_eur: event.query_compilation_cost,
      }
      options.onTelemetry?.(event)
    },
  })

  if (plan?.semantic_query_contract) {
    let spec = commercialIntentSpecFromSearchPlan(plan)
    if (
      spec.request_mode === 'seller_driven_lead_discovery' ||
      spec.request_mode === 'event_based_discovery'
    ) {
      spec = { ...spec, commercial_hypotheses: planOfferToBuyerNeed(spec) }
    }
    void hints
    return { spec, telemetry }
  }

  if (options.allowHeuristicFallback !== false) {
    const spec = heuristicFromMirax(query)
    telemetry = {
      ...telemetry,
      query_compilation_status: 'failed',
      intent_compiler_tier: 0,
      compiler_cache_hit: false,
      compiler_cost_eur: 0,
    }
    return { spec, telemetry }
  }

  throw new Error('SEMANTIC_INTENT_COMPILER_UNAVAILABLE')
}

export async function compileAndPlanCommercialIntentAsync(
  query: string,
  options?: CompileCommercialIntentOptions,
): Promise<CommercialIntentSpec & { telemetry?: IntentCompilerTelemetry }> {
  const { spec, telemetry } = await compileCommercialIntentSemantic(query, options)
  return { ...spec, telemetry }
}
