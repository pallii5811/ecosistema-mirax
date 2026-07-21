import type { CommercialHypothesis, CommercialIntentSpec } from './types'

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'hypothesis'
}

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

  const canonicalSignals = Array.from(new Set([
    ...spec.direct_demand_signals,
    ...spec.inferred_fit_signals,
  ]))
  const events = spec.observable_events.length
    ? spec.observable_events
    : canonicalSignals.length || spec.required_relationships.length
      ? [{
          id: canonicalSignals[0] || spec.required_relationships[0],
          description: spec.buyer_need || problems[0] || 'observable commercial event',
          signals: canonicalSignals,
        }]
      : []

  for (const event of events.slice(0, 6)) {
    if (hypotheses.length >= 6) break
    const signal = event.signals?.[0] || 'opportunity'
    hypotheses.push({
      id: `hyp-event-${slug(signal)}-${hypotheses.length + 1}`,
      hypothesis_id: `hyp-event-${slug(signal)}-${hypotheses.length + 1}`,
      buyer_archetype: spec.buyer_need || 'target operating company',
      target_company_profile: baseProfile,
      target_role: spec.target_role || 'target_company',
      buyer_problem: event.description,
      expected_outcome: offer,
      observable_event: event.description,
      observable_event_types: event.signals?.length ? event.signals : [signal],
      required_relationship: spec.required_relationships[0] || `company_with_${signal}`,
      required_relationships: spec.required_relationships.length
        ? spec.required_relationships
        : [`company_with_${signal}`],
      allowed_signal_families: event.signals?.length ? event.signals : [signal],
      excluded_signal_families: [],
      sources: spec.source_requirements.allowed_source_classes || ['official_company_website'],
      source_classes: spec.source_requirements.allowed_source_classes || ['official_company_website'],
      evidence_claim_type: isExplicit ? 'DIRECT_DEMAND' : 'OBSERVED_EVENT',
      query_templates: [event.description],
      false_positive_risks: ['publisher as target', 'vendor page as buyer'],
      expected_yield: isExplicit ? 'high' : 'medium',
      expected_cost: 'low',
      intent_strength: isExplicit ? 'direct' : 'strong_inferred',
    })
  }

  return hypotheses
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
