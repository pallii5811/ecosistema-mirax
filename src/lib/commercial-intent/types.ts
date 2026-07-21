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

export type TargetCompanyProfile = {
  entity_types?: Array<'company' | 'person' | 'public_body' | 'startup'>
  industries?: string[]
  company_sizes?: string[]
  geographies?: string[]
  required_attributes?: string[]
  excluded_attributes?: string[]
  excluded_entities?: string[]
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
  target_company_profile: TargetCompanyProfile
  target_role: string
  buyer_problem: string
  observable_event: string
  required_relationship: string
  sources: string[]
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
  target_company_profile: {},
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
