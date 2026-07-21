import type { CommercialHypothesis, CommercialIntentSpec } from './types'
import { compileCommercialIntentSpec } from './compile'

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'hypothesis'
}

/**
 * Offer-to-Buyer-Need planner for seller-driven and event-based discovery.
 * Never presents inferred fit as explicit demand.
 */
export function planOfferToBuyerNeed(spec: CommercialIntentSpec): CommercialHypothesis[] {
  const offer = spec.seller_offer.description || spec.seller_profile.offer_description || 'commercial offer'
  const problems = spec.seller_profile.problems_solved?.length
    ? spec.seller_profile.problems_solved
    : spec.problem_solved
      ? [spec.problem_solved]
      : [`Operational gap addressable by ${offer}`]

  const hypotheses: CommercialHypothesis[] = []
  const baseProfile = { ...spec.target_company_profile }

  for (const event of spec.observable_events.slice(0, 3)) {
    const signal = event.signals?.[0] || 'opportunity'
    hypotheses.push({
      id: `hyp-${slug(signal)}-${hypotheses.length + 1}`,
      target_company_profile: baseProfile,
      target_role: spec.target_role || 'target_company',
      buyer_problem: event.description,
      observable_event: event.description,
      required_relationship: spec.required_relationships[0] || `company_with_${signal}`,
      sources: spec.source_requirements.allowed_source_classes || ['official_company_website'],
      false_positive_risks: ['publisher as target', 'vendor page as buyer', 'hypothetical future need'],
      expected_yield: spec.request_mode === 'explicit_demand' ? 'high' : 'medium',
      expected_cost: 'medium',
      intent_strength:
        spec.request_mode === 'explicit_demand' ? 'direct' : 'strong_inferred',
    })
  }

  for (const problem of problems.slice(0, 3)) {
    if (hypotheses.length >= 6) break
    hypotheses.push({
      id: `hyp-problem-${slug(problem)}-${hypotheses.length + 1}`,
      target_company_profile: {
        ...baseProfile,
        required_attributes: [...(baseProfile.required_attributes || []), problem],
      },
      target_role: spec.target_role || 'buyer',
      buyer_problem: problem,
      observable_event: `Observable need: ${problem}`,
      required_relationship: spec.required_relationships[0] || 'company_with_unmet_need',
      sources: spec.source_requirements.allowed_source_classes || ['official_company_website'],
      false_positive_risks: ['inferred need presented as explicit RFP', 'generic growth narrative'],
      expected_yield: 'medium',
      expected_cost: 'medium',
      intent_strength: 'strong_inferred',
    })
  }

  return hypotheses.slice(0, 6)
}

export function compileAndPlanCommercialIntent(query: string): CommercialIntentSpec {
  const spec = compileCommercialIntentSpec(query)
  if (
    spec.request_mode === 'seller_driven_lead_discovery' ||
    spec.request_mode === 'event_based_discovery'
  ) {
    return { ...spec, commercial_hypotheses: planOfferToBuyerNeed(spec) }
  }
  return spec
}
