/**
 * Offline dry-run of the live S1 semantic payload (no provider calls).
 * Replays the failed S1 contract shape and asserts employer + hiring_sales only.
 */
import assert from 'node:assert/strict'

import {
  COMMERCIAL_INTENT_PROMPT_VERSION,
  contractImpliesStaffingEvent,
  filterRoutingHintsForContract,
  isStaffingRoleMismatch,
  relationshipImpliesGeographicExpansion,
  relationshipImpliesStaffing,
} from '../src/lib/intent-compiler/compile-commercial-search-plan'
import { canonicalPlanToLegacy } from '../src/lib/uqe/mirax-query-planner'
import type { CommercialSearchPlan, SemanticQueryContract } from '../src/lib/contracts/commercial-search-plan'
import { ResearchCostGovernor } from '../src/lib/research/cost-governor'

const QUERY = 'Trova aziende lombarde che stanno ampliando la squadra incaricata di sviluppare nuovi clienti.'

// Payload shape observed in the failed live S1 compile (before P0 fix).
const liveBadContract: SemanticQueryContract = {
  original_query: QUERY,
  query_goal: 'Find Lombardy companies expanding their customer development team',
  seller: {},
  offer: {},
  target_entity_types: ['Company', 'Organization'],
  target_company_description: 'Lombardy-based companies actively expanding their customer development and sales teams',
  event_or_state_description: 'Team expansion in customer development and new client acquisition functions',
  target_role_in_event: 'expanding_company',
  required_relationships: [
    'expanding sales team',
    'hiring customer development staff',
    'scaling customer acquisition',
  ],
  optional_relationships: [],
  excluded_roles: [],
  excluded_entities: [],
  geography: ['Lombardy', 'Italy'],
  industry: [],
  size_constraints: {},
  temporal_constraints: {},
  positive_conditions: ['Active hiring in sales'],
  negative_conditions: [],
  must_have_facts: [],
  forbidden_inferences: [],
  data_requirements: [],
  ranking_objective: 'evidence-first',
  acceptance_rubric: ['evidence'],
  discovery_hypotheses: [],
  clarification_required: false,
  confidence: 0.85,
  canonical_signal_hints: ['hiring_sales', 'geographic_expansion'],
}

assert.equal(contractImpliesStaffingEvent(liveBadContract), true)
assert.equal(isStaffingRoleMismatch('expanding_company', liveBadContract), true)
assert.equal(isStaffingRoleMismatch('employer', liveBadContract), false)
assert.ok(liveBadContract.required_relationships.some(relationshipImpliesStaffing))
assert.equal(
  liveBadContract.required_relationships.some(relationshipImpliesGeographicExpansion),
  false,
)

const hints = filterRoutingHintsForContract(liveBadContract.canonical_signal_hints, liveBadContract)
assert.deepEqual(hints, ['hiring_sales'])
assert.ok(!hints.includes('geographic_expansion'))

const plan = {
  schema_version: '1.0.0',
  search_id: 's1-dry-run',
  raw_query: QUERY,
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
    geographies: ['Lombardia'],
    local_business_preference: true,
    required_attributes: [],
    excluded_attributes: [],
    excluded_entities: [],
  },
  commercial_hypotheses: [{
    id: 'h1',
    buyer_problem: 'team expansion',
    triggering_events: ['hiring sales'],
    signals: ['hiring_sales'],
    implied_need: 'sales capacity',
    relevance_to_offer: 'fit',
    confidence: 0.9,
  }],
  signal_policy: {
    required_signals: ['hiring_sales'],
    optional_signals: [],
    negative_signals: [],
    maximum_age_days_by_signal: { hiring_sales: 60 },
    minimum_signal_confidence: 0.75,
  },
  source_policy: {
    preferred_source_classes: ['company_careers'],
    allowed_source_classes: ['company_careers', 'job_board', 'official_company_website', 'recognized_local_news'],
    excluded_source_classes: ['search_snippet'],
    primary_source_required_for: ['hiring_sales'],
    minimum_independent_sources: 1,
  },
  evidence_policy: {
    require_source_url: true,
    require_official_domain: true,
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
    prompt_version: COMMERCIAL_INTENT_PROMPT_VERSION,
    model: 'dry-run',
    generated_at: new Date().toISOString(),
  },
  semantic_query_contract: {
    ...liveBadContract,
    target_role_in_event: 'employer',
    target_entity_types: ['operating_company'],
    required_relationships: ['sales_customer_acquisition_team_expansion_by_target_company'],
    canonical_signal_hints: ['hiring_sales'],
  },
} as unknown as CommercialSearchPlan

const legacy = canonicalPlanToLegacy(plan)
assert.equal(legacy.search_strategy, 'organic_web_search')
assert.ok(legacy.required_signals.includes('hiring_sales'))
assert.ok(!legacy.required_signals.includes('geographic_expansion'))
assert.equal(legacy.semantic_query_contract?.target_role_in_event, 'employer')
assert.ok(
  (legacy.source_coverage?.adapter_ids || []).includes('structured_hiring_v1') ||
    (legacy.source_plan || []).some((lane) => (lane.adapter_ids || []).includes('structured_hiring_v1')),
)
assert.ok(!(legacy.source_coverage?.adapter_ids || []).includes('maps'))
assert.notEqual(legacy.search_strategy, 'maps')

const governor = new ResearchCostGovernor(0.042, 0.05)
governor.reserve('compile', 'intent_compilation', 0.005)
governor.settle('compile', 0.005)
governor.reserve('hiring', 'structured_hiring', 0.02)
governor.settle('hiring', 0.02)
governor.reserve('web', 'generic_web', 0.02)
try {
  governor.settle('web', 0.0306)
  assert.fail('settle should refuse overshoot')
} catch {
  assert.ok(governor.committedCostEur <= 0.05 + 1e-9)
}

console.log(JSON.stringify({
  dry_run: 'PASS',
  role: legacy.semantic_query_contract?.target_role_in_event,
  relationships: legacy.semantic_query_contract?.required_relationships,
  hints,
  strategy: legacy.search_strategy,
  adapters: legacy.source_coverage?.adapter_ids || [],
  prompt_version: COMMERCIAL_INTENT_PROMPT_VERSION,
  budget_invariant: 'PASS',
}, null, 2))
