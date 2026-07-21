/**
 * MIRAX CommercialIntentSpec — authoritative universal query contract.
 * Regex/keywords are retrieval hints only; semantics flow through request_mode,
 * buyer_need, target_role and required_relationships.
 */

export type CommercialRequestMode =
  | 'explicit_demand'
  | 'seller_driven_lead_discovery'
  | 'event_based_discovery'
  | 'company_filter'
  | 'digital_audit'
  | 'procurement_discovery'

export type IntentStrength = 'direct' | 'strong_inferred' | 'moderate_inferred'
export type EvidenceClaimType =
  | 'DIRECT_DEMAND'
  | 'SELECTION_PROCESS'
  | 'OBSERVED_EVENT'
  | 'COMPANY_ATTRIBUTE'
  | 'MARKET_SCOPE'
  | 'IDENTITY'
  | 'CONTACT'
  | 'COMMERCIAL_INFERENCE'

export type CapabilityStatus = 'supported' | 'supported_partial' | 'unavailable'

export type SellerProfile = {
  offer_category?: string | null
  offer_description?: string | null
  products_or_services?: string[]
  problems_solved?: string[]
  sales_motion?: string | null
  preferred_buyer_roles?: string[]
}

export type SellerOffer = {
  description: string | null
  category?: string | null
}

export type MarketScopePolicy = {
  minimum_employees: number | null
  maximum_employees: number | null
  minimum_revenue_eur: number | null
  maximum_revenue_eur: number | null
  allowed_size_classes: Array<'micro' | 'small' | 'medium' | 'large' | 'enterprise'>
  enterprise_opt_in: boolean
  exclude_public_companies: boolean
  exclude_state_controlled_major_operators: boolean
  exclude_global_enterprises: boolean
  exclude_large_corporate_groups: boolean
  exclude_famous_brands: boolean
  required_market_scope_confidence: number
}

export const DEFAULT_MIRAX_MARKET_SCOPE_POLICY: MarketScopePolicy = {
  minimum_employees: 2,
  maximum_employees: 249,
  minimum_revenue_eur: null,
  maximum_revenue_eur: 50_000_000,
  allowed_size_classes: ['micro', 'small', 'medium'],
  enterprise_opt_in: false,
  exclude_public_companies: true,
  exclude_state_controlled_major_operators: true,
  exclude_global_enterprises: true,
  exclude_large_corporate_groups: true,
  exclude_famous_brands: true,
  required_market_scope_confidence: 0.75,
}

export type TargetCompanyProfile = {
  entity_types?: Array<'company' | 'person' | 'public_body' | 'startup'>
  industries?: string[]
  company_sizes?: string[]
  geographies?: string[]
  required_attributes?: string[]
  excluded_attributes?: string[]
  excluded_entities?: string[]
  market_scope_policy?: MarketScopePolicy
}

export type EvidencePolicy = {
  minimum_independent_sources?: number
  allowed_source_classes?: string[]
  excluded_source_classes?: string[]
  minimum_evidence_confidence?: number
  maximum_age_days?: number
  must_have_facts?: string[]
  forbidden_inferences?: string[]
}

export type SourceRequirements = {
  preferred_source_classes?: string[]
  allowed_source_classes?: string[]
  excluded_source_classes?: string[]
  minimum_independent_sources?: number
}

export type ObservableEvent = {
  id: string
  description: string
  triggering_phrases?: string[]
  signals?: string[]
  implied_need?: string | null
}

export type CommercialHypothesis = {
  id: string
  hypothesis_id: string
  buyer_archetype: string
  target_company_profile: TargetCompanyProfile
  target_role: string
  buyer_problem: string
  expected_outcome: string
  observable_event: string
  observable_event_types: string[]
  required_relationship: string
  required_relationships: string[]
  allowed_signal_families: string[]
  excluded_signal_families: string[]
  sources: string[]
  source_classes: string[]
  evidence_claim_type: EvidenceClaimType
  query_templates: string[]
  false_positive_risks: string[]
  expected_yield: 'high' | 'medium' | 'low'
  expected_cost: 'low' | 'medium' | 'high'
  intent_strength: IntentStrength
}

export interface CommercialIntentSpec {
  original_query: string
  normalized_goal: string
  request_mode: CommercialRequestMode
  seller_profile: SellerProfile
  seller_offer: SellerOffer
  problem_solved: string | null
  buyer_need: string | null
  target_company_profile: TargetCompanyProfile
  target_role: string | null
  geography: string[]
  sectors: string[]
  freshness: { maximum_age_days?: number | null } | null
  direct_demand_signals: string[]
  inferred_fit_signals: string[]
  observable_events: ObservableEvent[]
  required_relationships: string[]
  excluded_roles: string[]
  evidence_policy: EvidencePolicy
  source_requirements: SourceRequirements
  intent_strength_required: IntentStrength
  capability_status: CapabilityStatus
  confidence: number
  clarification_required: boolean
  /** Planner output when seller-driven */
  commercial_hypotheses?: CommercialHypothesis[]
}

export const EMPTY_COMMERCIAL_INTENT_SPEC: CommercialIntentSpec = {
  original_query: '',
  normalized_goal: '',
  request_mode: 'company_filter',
  seller_profile: {},
  seller_offer: { description: null },
  problem_solved: null,
  buyer_need: null,
  target_company_profile: { market_scope_policy: DEFAULT_MIRAX_MARKET_SCOPE_POLICY },
  target_role: null,
  geography: [],
  sectors: [],
  freshness: null,
  direct_demand_signals: [],
  inferred_fit_signals: [],
  observable_events: [],
  required_relationships: [],
  excluded_roles: ['publisher', 'recruiter'],
  evidence_policy: {},
  source_requirements: {},
  intent_strength_required: 'direct',
  capability_status: 'supported',
  confidence: 0,
  clarification_required: false,
}
