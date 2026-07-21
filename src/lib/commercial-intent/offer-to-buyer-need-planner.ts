import type { CommercialHypothesis, CommercialIntentSpec } from './types'

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'hypothesis'
}

const GENERIC_WHY_NOW = [
  {
    event: 'new facility or production site opening',
    problem: 'capital project triggers compliance, equipment and vendor selection',
    relationship: 'company_opening_or_expanding_facility',
    sources: ['official_company_website', 'recognized_local_news', 'public_registry'],
    risks: ['real-estate listing as buyer', 'construction vendor as target'],
  },
  {
    event: 'public tender or regulatory compliance deadline',
    problem: 'mandated upgrade or certification window creates time-bound demand',
    relationship: 'company_subject_to_public_or_regulatory_requirement',
    sources: ['public_procurement_portal', 'official_company_website'],
    risks: ['contracting authority as buyer', 'advisor blog as evidence'],
  },
  {
    event: 'operational pain or downtime disclosed publicly',
    problem: 'observable performance gap aligned with seller outcome',
    relationship: 'company_experiencing_operational_gap',
    sources: ['official_company_website', 'industry_publication'],
    risks: ['generic thought leadership', 'hypothetical future need'],
  },
  {
    event: 'leadership or ownership transition',
    problem: 'new decision makers re-evaluate suppliers and processes',
    relationship: 'company_under_management_or_ownership_change',
    sources: ['official_company_website', 'public_registry', 'recognized_local_news'],
    risks: ['registry page without operating company', 'advisor as target'],
  },
  {
    event: 'hiring for roles tied to the seller outcome',
    problem: 'workforce investment signals budget and priority for the problem space',
    relationship: 'employer_investing_in_relevant_capability',
    sources: ['official_company_website', 'verified_job_posting'],
    risks: ['recruiter or job board as employer', 'stale vacancy'],
  },
  {
    event: 'supplier change or contract end',
    problem: 'incumbent displacement creates replacement demand',
    relationship: 'company_ending_incumbent_supplier_relationship',
    sources: ['official_company_website', 'recognized_local_news'],
    risks: ['former supplier page as buyer', 'rumor without evidence'],
  },
] as const

/**
 * Offer-to-Buyer-Need planner — profession-agnostic verifiable hypotheses.
 * Never presents inferred fit as explicit demand.
 */
export function planOfferToBuyerNeed(spec: CommercialIntentSpec): CommercialHypothesis[] {
  const offer =
    spec.seller_offer.description ||
    spec.seller_profile.offer_description ||
    spec.problem_solved ||
    'commercial offer'
  const problems = spec.seller_profile.problems_solved?.length
    ? spec.seller_profile.problems_solved
    : spec.problem_solved
      ? [spec.problem_solved]
      : [`Operational gap addressable by ${offer}`]

  const hypotheses: CommercialHypothesis[] = []
  const baseProfile = { ...spec.target_company_profile }
  const isExplicit = spec.request_mode === 'explicit_demand'

  for (const template of GENERIC_WHY_NOW) {
    if (hypotheses.length >= 6) break
    const problem = problems[hypotheses.length % problems.length] || template.problem
    hypotheses.push({
      id: `hyp-${slug(template.relationship)}-${hypotheses.length + 1}`,
      target_company_profile: {
        ...baseProfile,
        required_attributes: [...(baseProfile.required_attributes || []), problem],
      },
      target_role: isExplicit ? spec.target_role || 'buyer' : 'buyer',
      buyer_problem: problem,
      observable_event: template.event,
      required_relationship: template.relationship,
      sources: spec.source_requirements.allowed_source_classes?.length
        ? spec.source_requirements.allowed_source_classes
        : [...template.sources],
      false_positive_risks: [...template.risks, 'inferred need presented as explicit RFP'],
      expected_yield: isExplicit ? 'high' : hypotheses.length < 2 ? 'medium' : 'low',
      expected_cost: hypotheses.length < 3 ? 'medium' : 'high',
      intent_strength: isExplicit ? 'direct' : hypotheses.length < 2 ? 'strong_inferred' : 'moderate_inferred',
    })
  }

  for (const event of spec.observable_events.slice(0, 2)) {
    if (hypotheses.length >= 6) break
    const signal = event.signals?.[0] || 'opportunity'
    hypotheses.push({
      id: `hyp-event-${slug(signal)}-${hypotheses.length + 1}`,
      target_company_profile: baseProfile,
      target_role: spec.target_role || 'target_company',
      buyer_problem: event.description,
      observable_event: event.description,
      required_relationship: spec.required_relationships[0] || `company_with_${signal}`,
      sources: spec.source_requirements.allowed_source_classes || ['official_company_website'],
      false_positive_risks: ['publisher as target', 'vendor page as buyer'],
      expected_yield: isExplicit ? 'high' : 'medium',
      expected_cost: 'medium',
      intent_strength: isExplicit ? 'direct' : 'strong_inferred',
    })
  }

  return hypotheses.slice(3, 6).length >= 3 ? hypotheses.slice(0, 6) : hypotheses.slice(0, Math.max(3, hypotheses.length))
}

import { compileCommercialIntentSpecHeuristic } from './compile-heuristic'

export function compileAndPlanCommercialIntent(query: string): CommercialIntentSpec {
  const spec = compileCommercialIntentSpecHeuristic(query)
  if (
    spec.request_mode === 'seller_driven_lead_discovery' ||
    spec.request_mode === 'event_based_discovery'
  ) {
    return { ...spec, commercial_hypotheses: planOfferToBuyerNeed(spec) }
  }
  return spec
}
