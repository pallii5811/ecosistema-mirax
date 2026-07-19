/**
 * P0 semantic role + routing bridge — offline self-checks (no LLM network).
 * Run: npx tsx scripts/test-semantic-role-routing-bridge.ts
 */
import assert from 'node:assert/strict'

import type { CommercialSearchPlan, SemanticQueryContract } from '../src/lib/contracts/commercial-search-plan'
import { isPersonOrJobTitleTargetRole } from '../src/lib/intent-compiler/compile-commercial-search-plan'
import {
  applyRoutingGuards,
  buildHeuristicMiraxQueryPlan,
  canonicalPlanToLegacy,
} from '../src/lib/uqe/mirax-query-planner'

assert.equal(isPersonOrJobTitleTargetRole('employer'), false)
assert.equal(isPersonOrJobTitleTargetRole('recipient'), false)
assert.equal(isPersonOrJobTitleTargetRole('contract_winner'), false)
assert.equal(isPersonOrJobTitleTargetRole('Business development team member or sales leadership'), true)
assert.equal(isPersonOrJobTitleTargetRole('sales manager'), true)
assert.equal(isPersonOrJobTitleTargetRole('CFO'), true)
assert.equal(isPersonOrJobTitleTargetRole('marketing leadership'), true)
assert.equal(isPersonOrJobTitleTargetRole('decision maker'), true)

function semantic(partial: {
  original_query: string
  target_role_in_event: string
  required_relationships: string[]
  geography?: string[]
  canonical_signal_hints?: string[]
  acceptance_rubric?: string[]
}): SemanticQueryContract {
  return {
    original_query: partial.original_query,
    query_goal: partial.original_query,
    seller: {},
    offer: {},
    target_entity_types: ['operating_company'],
    target_company_description: 'operating companies',
    event_or_state_description: 'event',
    target_role_in_event: partial.target_role_in_event,
    required_relationships: partial.required_relationships,
    optional_relationships: [],
    excluded_roles: [],
    excluded_entities: [],
    geography: partial.geography || ['Italia'],
    industry: [],
    size_constraints: {},
    temporal_constraints: {},
    positive_conditions: [],
    negative_conditions: [],
    must_have_facts: [],
    forbidden_inferences: [],
    data_requirements: [],
    ranking_objective: 'evidence-first',
    acceptance_rubric: partial.acceptance_rubric || ['evidence'],
    discovery_hypotheses: [],
    clarification_required: false,
    confidence: 0.9,
    canonical_signal_hints: partial.canonical_signal_hints || [],
  }
}

function basePlan(overrides: {
  raw_query: string
  semantic_query_contract: SemanticQueryContract
  required_signals?: string[]
}): CommercialSearchPlan {
  const signals = overrides.required_signals || []
  return {
    schema_version: '1.0.0',
    search_id: 'bridge-test',
    raw_query: overrides.raw_query,
    language: 'it',
    seller: {
      offer_description: 'n/a',
      products_or_services: [],
      problems_solved: [],
      preferred_buyer_roles: [],
    },
    target: {
      entity_types: ['operating_company'],
      industries: [],
      company_sizes: [],
      geographies: overrides.semantic_query_contract.geography,
      local_business_preference: true,
      required_attributes: [],
      excluded_attributes: [],
      excluded_entities: [],
    },
    commercial_hypotheses: [{
      id: 'h1',
      buyer_problem: 'need',
      triggering_events: ['event'],
      signals,
      implied_need: 'need',
      relevance_to_offer: 'fit',
      confidence: 0.9,
    }],
    signal_policy: {
      required_signals: signals,
      optional_signals: [],
      negative_signals: [],
      maximum_age_days_by_signal: Object.fromEntries(signals.map((s) => [s, 180])),
      minimum_signal_confidence: 0.75,
    },
    source_policy: {
      preferred_source_classes: ['official_company_website', 'recognized_local_news', 'company_careers'],
      allowed_source_classes: ['official_company_website', 'recognized_local_news', 'company_careers', 'industry_publication'],
      excluded_source_classes: ['search_snippet'],
      primary_source_required_for: [],
      minimum_independent_sources: 1,
    },
    evidence_policy: {
      require_source_url: true,
      require_official_domain: false,
      accept_secondary_corroboration: true,
      require_date_when_available: true,
      minimum_evidence_confidence: 0.7,
    },
    ranking_policy: {
      weight_buyer_fit: 0.25,
      weight_need_gap: 0.2,
      weight_signal_strength: 0.2,
      weight_freshness: 0.15,
      weight_evidence_confidence: 0.1,
      weight_contactability: 0.1,
    },
    ambiguity: { score: 0.1, unresolved_points: [], clarifying_questions: [] },
    planner_metadata: {
      prompt_version: 'commercial-intent-v1.4.1',
      model: 'test',
      generated_at: new Date().toISOString(),
    },
    semantic_query_contract: overrides.semantic_query_contract,
  } as unknown as CommercialSearchPlan
}

{
  const query = 'Trova aziende lombarde che stanno ampliando la squadra incaricata di sviluppare nuovi clienti.'
  const plan = canonicalPlanToLegacy(basePlan({
    raw_query: query,
    required_signals: ['hiring_sales'],
    semantic_query_contract: semantic({
      original_query: query,
      target_role_in_event: 'employer',
      required_relationships: ['sales_customer_acquisition_team_expansion_by_target_company'],
      geography: ['Lombardia'],
      canonical_signal_hints: ['hiring_sales'],
      acceptance_rubric: ['verified hiring evidence'],
    }),
  }))
  assert.equal(plan.search_strategy, 'organic_web_search')
  assert.ok(plan.required_signals.includes('hiring_sales'))
  assert.equal(plan.semantic_query_contract?.target_role_in_event, 'employer')
  assert.ok(plan.source_plan?.length)
}

{
  const query = 'Imprese che stanno abbandonando il vecchio gestionale legacy custom.'
  const plan = canonicalPlanToLegacy(basePlan({
    raw_query: query,
    semantic_query_contract: semantic({
      original_query: query,
      target_role_in_event: 'company_ending_supplier_relationship',
      required_relationships: ['legacy_erp_relationship_ended_by_target_company'],
      canonical_signal_hints: [],
    }),
  }))
  assert.equal(plan.required_signals.length, 0, 'must not invent fake canonical signals')
  assert.equal(plan.search_strategy, 'organic_web_search')
  assert.notEqual(plan.search_strategy, 'maps')
  assert.ok(plan.source_plan?.length, 'open-world must remain executable')
  const adapters = plan.source_coverage?.adapter_ids || []
  assert.ok(
    adapters.includes('generic_web_research_v1') ||
      plan.source_plan?.some((lane) => lane.execution_mode === 'generic_fallback' || lane.execution_mode === 'adapter'),
    `expected generic/organic adapters, got ${adapters.join(',')}`,
  )
}

{
  const mapsPlan = applyRoutingGuards(buildHeuristicMiraxQueryPlan('ristoranti Milano'), 'ristoranti Milano')
  assert.equal(mapsPlan.search_strategy, 'maps')
}

{
  const da = applyRoutingGuards(
    buildHeuristicMiraxQueryPlan('hotel a Roma senza meta pixel'),
    'hotel a Roma senza meta pixel',
  )
  assert.equal(da.search_strategy, 'maps')
}

assert.equal(isPersonOrJobTitleTargetRole('recipient'), false)
assert.equal(isPersonOrJobTitleTargetRole('CFO'), true)

console.log('semantic-role-routing-bridge: OK')
