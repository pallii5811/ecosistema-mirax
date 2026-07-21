import type { CommercialSearchPlan, SemanticQueryContract } from '@/lib/contracts/commercial-search-plan'
import type {
  CommercialIntentSpec,
  CommercialRequestMode,
  IntentStrength,
} from './types'
import { DEFAULT_MIRAX_MARKET_SCOPE_POLICY } from './types'

function requestModeFromPlan(plan: CommercialSearchPlan): CommercialRequestMode {
  const hints = plan.semantic_query_contract?.canonical_signal_hints ?? []
  const rels = plan.semantic_query_contract?.required_relationships ?? []
  const goal = `${plan.raw_query} ${plan.semantic_query_contract?.query_goal ?? ''}`.toLowerCase()
  const sellerDesc = plan.seller?.offer_description || ''
  if (sellerDesc.trim().length >= 8) {
    return 'seller_driven_lead_discovery'
  }
  if (hints.some((h) => /missing_|digital|pixel|analytics|gtm|ssl/.test(h)) || /digital audit|senza pixel|senza gtm/i.test(goal)) {
    return 'digital_audit'
  }
  if (hints.includes('procurement') || rels.some((r) => /tender|contract|procurement|appalto/.test(r))) {
    return 'procurement_discovery'
  }
  if (
    rels.length > 0 &&
    /\b(assumono|assunz|raccogli|round|finanz|hiring|funding|gara|aggiudicat)\b/i.test(goal)
  ) {
    return 'explicit_demand'
  }
  if (rels.length > 0) return 'event_based_discovery'
  return 'company_filter'
}

function intentStrength(plan: CommercialSearchPlan): IntentStrength {
  const mode = requestModeFromPlan(plan)
  if (mode === 'explicit_demand') return 'direct'
  if (mode === 'seller_driven_lead_discovery') return 'strong_inferred'
  if (plan.semantic_query_contract?.confidence && plan.semantic_query_contract.confidence >= 0.85) {
    return 'strong_inferred'
  }
  return 'moderate_inferred'
}

function mapHypotheses(plan: CommercialSearchPlan) {
  return (plan.commercial_hypotheses || []).map((hyp) => ({
    id: hyp.id,
    hypothesis_id: hyp.id,
    buyer_archetype: plan.semantic_query_contract?.target_company_description || 'target operating company',
    target_company_profile: {
      required_attributes: hyp.triggering_events,
    },
    target_role: 'buyer',
    buyer_problem: hyp.buyer_problem,
    expected_outcome: hyp.implied_need,
    observable_event: hyp.triggering_events[0] || hyp.implied_need,
    observable_event_types: hyp.triggering_events.length ? hyp.triggering_events : hyp.signals,
    required_relationship: hyp.signals[0] || 'company_with_observable_need',
    required_relationships: plan.semantic_query_contract?.required_relationships?.length
      ? plan.semantic_query_contract.required_relationships
      : hyp.signals,
    allowed_signal_families: hyp.signals,
    excluded_signal_families: plan.signal_policy?.negative_signals ?? [],
    sources: plan.source_policy?.allowed_source_classes ?? [],
    source_classes: plan.source_policy?.allowed_source_classes ?? [],
    evidence_claim_type: requestModeFromPlan(plan) === 'explicit_demand'
      ? 'DIRECT_DEMAND' as const
      : 'OBSERVED_EVENT' as const,
    query_templates: hyp.triggering_events,
    false_positive_risks: ['inferred need presented as explicit RFP'],
    expected_yield: hyp.confidence >= 0.8 ? 'high' as const : 'medium' as const,
    expected_cost: 'medium' as const,
    intent_strength: plan.semantic_query_contract?.clarification_required ? 'moderate_inferred' as const : 'strong_inferred' as const,
  }))
}

export function commercialIntentSpecFromSearchPlan(plan: CommercialSearchPlan): CommercialIntentSpec {
  const contract: SemanticQueryContract | undefined = plan.semantic_query_contract
  const mode = requestModeFromPlan(plan)
  const offerDescription = plan.seller?.offer_description || null
  const buyerNeed = contract?.query_goal || null

  return {
    original_query: plan.raw_query,
    normalized_goal: contract?.query_goal || plan.raw_query,
    request_mode: mode,
    seller_profile: {
      offer_category: plan.seller?.offer_category ?? null,
      offer_description: offerDescription,
      products_or_services: plan.seller?.products_or_services ?? [],
      problems_solved: plan.seller?.problems_solved ?? [],
      sales_motion: plan.seller?.sales_motion ?? null,
      preferred_buyer_roles: plan.seller?.preferred_buyer_roles ?? [],
    },
    seller_offer: {
      description: offerDescription,
      category: plan.seller?.offer_category ?? null,
    },
    problem_solved: plan.seller?.problems_solved?.[0] ?? null,
    buyer_need: buyerNeed,
    target_company_profile: {
      entity_types: (plan.target?.entity_types as CommercialIntentSpec['target_company_profile']['entity_types']) ?? ['company'],
      industries: plan.target?.industries ?? [],
      company_sizes: plan.target?.company_sizes ?? [],
      geographies: plan.target?.geographies ?? [],
      required_attributes: plan.target?.required_attributes ?? [],
      excluded_attributes: plan.target?.excluded_attributes ?? [],
      excluded_entities: plan.target?.excluded_entities ?? [],
      market_scope_policy: { ...DEFAULT_MIRAX_MARKET_SCOPE_POLICY },
    },
    target_role: contract?.target_role_in_event ?? null,
    geography: plan.target?.geographies ?? contract?.geography ?? [],
    sectors: plan.target?.industries ?? contract?.industry ?? [],
    freshness: null,
    direct_demand_signals: mode === 'explicit_demand' ? [...(contract?.canonical_signal_hints ?? [])] : [],
    inferred_fit_signals: mode !== 'explicit_demand' ? [...(contract?.canonical_signal_hints ?? [])] : [],
    observable_events: (contract?.discovery_hypotheses ?? []).map((hyp, index) => ({
      id: `event-${index}`,
      description: String((hyp as { observable_event?: string }).observable_event || contract?.event_or_state_description || ''),
      signals: contract?.canonical_signal_hints ?? [],
    })),
    required_relationships: contract?.required_relationships ?? [],
    excluded_roles: contract?.excluded_roles ?? ['publisher', 'recruiter'],
    evidence_policy: {
      must_have_facts: contract?.must_have_facts ?? ['official_domain', 'source_url', 'literal_excerpt'],
      forbidden_inferences: contract?.forbidden_inferences ?? [],
      maximum_age_days: 180,
    },
    source_requirements: {
      allowed_source_classes: plan.source_policy?.allowed_source_classes ?? [],
      excluded_source_classes: plan.source_policy?.excluded_source_classes ?? [],
      minimum_independent_sources: plan.source_policy?.minimum_independent_sources ?? 1,
    },
    intent_strength_required: intentStrength(plan),
    capability_status: 'supported',
    confidence: contract?.confidence ?? 0.7,
    clarification_required: contract?.clarification_required ?? false,
    commercial_hypotheses: mapHypotheses(plan),
  }
}
