import assert from 'node:assert/strict'
import fs from 'node:fs'

import { compileCommercialSearchPlan } from '../src/lib/intent-compiler/compile-commercial-search-plan'
import { canonicalPlanToLegacy } from '../src/lib/uqe/mirax-query-planner'
import { sourceSupportsSignal } from '../src/lib/source-intelligence/registry'
import { parseSignalIntentHeuristic } from '../src/lib/signal-intent/parse-heuristic'

const fixture = JSON.parse(
  fs.readFileSync('contracts/fixtures/commercial-search-plan.valid.json', 'utf8'),
  // Test fixtures are intentionally mutated across partial-payload scenarios.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
) as Record<string, any>
const semanticContract = {
  query_goal: 'Find operating target companies satisfying the explicit commercial condition',
  seller: {}, offer: {}, target_entity_types: ['operating_company'],
  target_company_description: 'The operating company requested by the user',
  event_or_state_description: 'The explicit query condition holds for the target company',
  target_role_in_event: 'subject_company',
  required_relationships: ['query_condition_holds_for_target'], optional_relationships: [],
  excluded_roles: ['publisher', 'advisor'], excluded_entities: [], geography: ['Italia'], industry: [],
  size_constraints: {}, temporal_constraints: { maximum_age_days: 365 },
  positive_conditions: ['explicit condition is evidenced'], negative_conditions: [],
  must_have_facts: ['target identity', 'source evidence'],
  forbidden_inferences: ['publisher is target'], data_requirements: ['official_domain', 'source_url'],
  ranking_objective: 'strongest recent grounded evidence first',
  acceptance_rubric: ['target_identity_verified', 'query_condition_grounded'],
  discovery_hypotheses: [{ source_classes: ['official_company_website'] }],
  clarification_required: false, confidence: 0.9, canonical_signal_hints: [],
}
fixture.semantic_query_contract = semanticContract
fixture.untrusted_extra = 'must be pruned'
fixture.seller.untrusted_extra = true
fixture.signal_policy.required_signals = ['tender_won']
fixture.signal_policy.optional_signals = ['unknown_signal']
fixture.signal_policy.maximum_age_days_by_signal = {}
fixture.commercial_hypotheses[0].signals = ['unknown_signal']
fixture.source_policy.allowed_source_classes = ['invented_source']
fixture.source_policy.preferred_source_classes = ['invented_source']
fixture.ranking_policy = {
  weight_buyer_fit: 1,
  weight_signal_strength: 1,
  weight_freshness: 1,
  weight_evidence_confidence: 1,
  weight_contactability: 1,
  weight_need_gap: 1,
}
fixture.target.company_sizes = ['enterprise']

const priorKey = process.env.ANTHROPIC_API_KEY
const priorModel = process.env.UQE_ANTHROPIC_MODEL
const priorFetch = globalThis.fetch

const digitalAuditIntent = parseSignalIntentHeuristic(
  'Trova imprese di pulizia a Milano con sito ufficiale, criticità SEO e assenza di strumenti di tracciamento pubblicitario.',
)
assert.equal(digitalAuditIntent.category, 'imprese di pulizia')
assert.equal(digitalAuditIntent.location, 'Milano')
assert.ok(digitalAuditIntent.required_signals.includes('site_stale'))
assert.ok(digitalAuditIntent.required_signals.includes('no_pixel'))
assert.ok(digitalAuditIntent.required_signals.includes('no_gtm'))
process.env.ANTHROPIC_API_KEY = 'test-only'
process.env.UQE_ANTHROPIC_MODEL = 'claude-sonnet-5\\r\\n'

let fetchCalls = 0
globalThis.fetch = async () => {
  fetchCalls += 1
  return new Response(JSON.stringify({
    usage: { input_tokens: 100, output_tokens: 50 },
    content: [{ type: 'tool_use', name: 'submit_commercial_search_plan', input: fixture }],
  }), { status: 200, headers: { 'content-type': 'application/json' } })
}

const settled: Array<{ key: string; actual: number }> = []
const reservedEstimates: number[] = []
const meter = {
  async reserve(input: { estimatedCostEur: number }) {
    reservedEstimates.push(input.estimatedCostEur)
    return { status: 'reserved' }
  },
  async settle(_searchId: string, key: string, actual: number) {
    settled.push({ key, actual })
    return { status: 'settled' }
  },
  async release() { throw new Error('release must not be used after provider execution') },
}

async function main() {
try {
  const accountantIntent = parseSignalIntentHeuristic(
    'Sono un commercialista: trovami PMI italiane con crescita, nuova apertura o cambi societari recenti',
  )
  assert.equal(accountantIntent.hiring_roles.includes('commerciale'), false, 'commercialista must not match commercial hiring role')
  assert.equal(accountantIntent.required_signals.includes('hiring'), false, 'commercialista must not create a hiring signal')
  assert.ok(accountantIntent.required_signals.includes('registry_change'), 'cambi societari must map to registry_change')
  assert.ok(accountantIntent.required_signals.includes('new_company'), 'nuova apertura must map to company formation')
  assert.ok(accountantIntent.required_signals.includes('expansion'), 'nuova apertura must map to expansion')
  const plan = await compileCommercialSearchPlan(
    'Sono un broker: trovami PMI italiane con appalti vinti, escludi grandi gruppi e brand famosi',
    {
      searchId: '00000000-0000-0000-0000-000000000001',
      requestedLeadCount: 5,
      costMeter: meter,
    },
  )
  assert.ok(plan, 'canonical plan must survive safe deterministic normalization')
  assert.equal(fetchCalls, 1, 'normalizable payload must not spend a repair call')
  assert.equal(plan.planner_metadata.model, 'claude-sonnet-5')
  assert.deepEqual(plan.signal_policy.required_signals, ['contract_awarded'])
  assert.ok(plan.signal_policy.maximum_age_days_by_signal.contract_awarded > 0)
  assert.ok(plan.commercial_hypotheses.some((item) => item.signals.includes('contract_awarded')))
  assert.ok(plan.source_policy.allowed_source_classes.every((source) => source !== 'invented_source'))
  assert.ok(plan.target.company_sizes.some((size) => /micro|small|medium/i.test(size)))
  assert.equal('untrusted_extra' in (plan as unknown as Record<string, unknown>), false)
  assert.equal(settled.length, 1)

  globalThis.fetch = async () => {
    fetchCalls += 1
    return new Response(JSON.stringify({
      usage: { input_tokens: 80, output_tokens: 40 },
      content: [{
        type: 'tool_use', name: 'submit_commercial_search_plan', input: {
          target: { company_sizes: ['micro', 'small', 'medium'], local_business_preference: true },
          signal_policy: { required_signals: [], optional_signals: [], negative_signals: [] },
          source_policy: { allowed_source_classes: ['company_careers', 'job_board'] },
          commercial_hypotheses: [],
        },
      }],
    }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  const sparse = await compileCommercialSearchPlan(
    'Trova PMI italiane che stanno assumendo un responsabile commerciale B2B, escludi grandi gruppi e brand famosi',
    {
      searchId: '00000000-0000-0000-0000-000000000002',
      requestedLeadCount: 5,
      costMeter: meter,
      allowRepair: false,
    },
  )
  assert.equal(sparse, null, 'sparse payload without buyer problem/triggering event must fail closed')
  assert.equal(fetchCalls, 2, 'sparse payload must not spend a repair call')

  globalThis.fetch = async () => {
    fetchCalls += 1
    return new Response(JSON.stringify({
      usage: { input_tokens: 90, output_tokens: 45 },
      content: [{
        type: 'tool_use', name: 'submit_commercial_search_plan', input: {
          semantic_query_contract: semanticContract,
          seller: {
            offer_category: 'insurance_brokerage',
            offer_description: 'Consulenza e coperture assicurative per PMI',
            products_or_services: ['polizze aziendali'],
            problems_solved: ['rischi operativi non coperti'],
            preferred_buyer_roles: ['titolare', 'CFO'],
          },
          target: { company_sizes: ['micro', 'small', 'medium'], local_business_preference: true },
          signal_policy: { required_signals: ['contract_awarded'], optional_signals: [], negative_signals: [] },
          source_policy: { allowed_source_classes: ['public_procurement_portal', 'official_company_website'] },
          commercial_hypotheses: [],
        },
      }],
    }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  const insurance = await compileCommercialSearchPlan(
    'Sono un broker assicurativo: trovami PMI italiane con nuovi appalti o flotta in espansione',
    {
      searchId: '00000000-0000-0000-0000-000000000003',
      requestedLeadCount: 5,
      costMeter: meter,
      allowRepair: false,
    },
  )
  assert.ok(insurance, 'ontology must complete planning hypotheses without inventing evidence or companies')
  assert.equal(fetchCalls, 3, 'ontology causal completion must not spend a repair call')
  assert.ok(insurance.commercial_hypotheses.every((item) => item.triggering_events.length > 0))
  assert.ok(insurance.commercial_hypotheses.every((item) => item.relevance_to_offer.length >= 12))
  assert.ok(insurance.commercial_hypotheses.some((item) => item.signals.includes('contract_awarded')))

  globalThis.fetch = async () => {
    fetchCalls += 1
    return new Response(JSON.stringify({
      usage: { input_tokens: 70, output_tokens: 35 },
      content: [{ type: 'tool_use', name: 'submit_commercial_search_plan', input: {
        semantic_query_contract: semanticContract,
        target: { company_sizes: ['micro', 'small', 'medium'], local_business_preference: true },
        signal_policy: { required_signals: [], optional_signals: [], negative_signals: [] },
        source_policy: { allowed_source_classes: [] },
        commercial_hypotheses: [],
      } }],
    }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  const webAgencyDiagnostics: unknown[] = []
  const webAgency = await compileCommercialSearchPlan(
    "Sono un'agenzia web locale: trovami PMI italiane non famose con sito debole",
    {
      searchId: '00000000-0000-0000-0000-000000000004', requestedLeadCount: 5,
      costMeter: meter, allowRepair: false,
      onDiagnostic: (diagnostic) => webAgencyDiagnostics.push(diagnostic),
    },
  )
  assert.ok(
    webAgency,
    `explicit seller + ontology signal must survive sparse model seller output: ${JSON.stringify(webAgencyDiagnostics)}`,
  )
  assert.match(webAgency.seller.offer_description, /agenzia web locale/i)
  assert.ok(webAgency.seller.products_or_services.length > 0)
  assert.ok(webAgency.seller.problems_solved.length > 0)
  assert.ok(webAgency.seller.preferred_buyer_roles.length > 0)
  assert.ok(webAgency.signal_policy.required_signals.includes('website_weakness'))
  assert.equal(fetchCalls, 4)

  globalThis.fetch = async () => {
    fetchCalls += 1
    return new Response(JSON.stringify({
      usage: { input_tokens: 70, output_tokens: 35 },
      content: [{ type: 'tool_use', name: 'submit_commercial_search_plan', input: {
        semantic_query_contract: semanticContract,
        target: { company_sizes: ['micro', 'small', 'medium'], local_business_preference: true },
        signal_policy: { required_signals: [], optional_signals: [], negative_signals: [] },
        source_policy: { allowed_source_classes: [] },
        commercial_hypotheses: [],
      } }],
    }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  const cyberDiagnostics: unknown[] = []
  const cybersecurity = await compileCommercialSearchPlan(
    'Vendo cybersecurity: trovami PMI italiane digitalizzate con esposizione web, ecommerce, posta o compliance e segnali tecnici verificabili',
    {
      searchId: '00000000-0000-0000-0000-000000000005', requestedLeadCount: 5,
      costMeter: meter, allowRepair: false,
      onDiagnostic: (diagnostic) => cyberDiagnostics.push(diagnostic),
    },
  )
  assert.ok(
    cybersecurity,
    `explicit Vendo offer must complete sparse causal payload: ${JSON.stringify(cyberDiagnostics)}`,
  )
  assert.equal(cybersecurity.seller.offer_description, 'cybersecurity')
  assert.ok(cybersecurity.signal_policy.required_signals.includes('cybersecurity_exposure'))
  assert.ok(cybersecurity.commercial_hypotheses.some((item) => item.signals.includes('cybersecurity_exposure')))
  assert.equal(fetchCalls, 5)

  globalThis.fetch = async () => {
    fetchCalls += 1
    return new Response(JSON.stringify({
      usage: { input_tokens: 70, output_tokens: 35 },
      content: [{ type: 'tool_use', name: 'submit_commercial_search_plan', input: {
        semantic_query_contract: semanticContract,
        target: { company_sizes: ['micro', 'small', 'medium'], local_business_preference: true },
        signal_policy: { required_signals: [], optional_signals: [], negative_signals: [] },
        source_policy: { allowed_source_classes: [] },
        commercial_hypotheses: [],
      } }],
    }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  const erp = await compileCommercialSearchPlan(
    'Vendo ERP e CRM: trovami PMI italiane con nuove sedi, assunzioni o migrazione gestionale verificabile',
    {
      searchId: '00000000-0000-0000-0000-000000000006', requestedLeadCount: 5,
      costMeter: meter, allowRepair: false,
    },
  )
  assert.ok(erp, 'explicit composite Vendo offer must survive sparse payload')
  assert.equal(erp.seller.offer_description, 'ERP e CRM')
  assert.deepEqual(erp.seller.products_or_services, ['ERP e CRM'])
  assert.ok(erp.signal_policy.required_signals.includes('technology_migration'))
  const erpExecutable = canonicalPlanToLegacy(erp)
  assert.ok(erp.signal_policy.required_signals.every((required) => erpExecutable.source_plan?.some((lane) =>
    lane.expected_evidence.includes(required) && lane.source_types.some((source) => sourceSupportsSignal(source, required)))),
  'every signal in a multi-signal ERP plan must have an executable compatible source lane')
  assert.equal(fetchCalls, 6)

  const semanticOnlyContract = {
    ...semanticContract,
    query_goal: 'Find Lombardy companies expanding their sales team',
    target_company_description: 'Operating companies in Lombardy that are hiring sales staff',
    event_or_state_description: 'The target company is actively expanding its sales team',
    required_relationships: ['sales_hiring_by_target_company'],
    optional_relationships: [],
    geography: ['Lombardia'],
    positive_conditions: ['a concrete sales vacancy is active'],
    negative_conditions: [],
    acceptance_rubric: ['target_is_operating_employer', 'sales_vacancy_is_current'],
    discovery_hypotheses: [{ source_classes: ['official_careers', 'ats_job_posting'] }],
    canonical_signal_hints: ['hiring_sales'],
  }
  globalThis.fetch = async () => {
    fetchCalls += 1
    return new Response(JSON.stringify({
      stop_reason: 'tool_use',
      usage: { input_tokens: 70, output_tokens: 35 },
      content: [{ type: 'tool_use', name: 'submit_commercial_search_plan', input: semanticOnlyContract }],
    }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  const semanticOnly = await compileCommercialSearchPlan(
    'aziende lombarde che stanno ampliando la squadra commerciale',
    {
      searchId: '00000000-0000-0000-0000-000000000008', requestedLeadCount: 2,
      costMeter: meter, allowRepair: false,
    },
  )
  assert.ok(semanticOnly, 'a semantic-contract-only tool response must become an executable canonical plan')
  const semanticOnlyQueryContract = semanticOnly.semantic_query_contract
  assert.ok(semanticOnlyQueryContract, 'semantic authority must remain attached to the canonical plan')
  assert.ok(semanticOnlyQueryContract.required_relationships.includes('sales_hiring_by_target_company'))
  assert.ok(semanticOnly.signal_policy.required_signals.includes('hiring_sales'))
  assert.ok(semanticOnly.source_policy.allowed_source_classes.some((source) => sourceSupportsSignal(source, 'hiring_sales')))
  assert.equal(semanticOnly.budget_policy.hard_cost_eur, 0.05)
  assert.ok(semanticOnly.budget_policy.maximum_llm_evaluations >= 6)
  assert.ok(reservedEstimates.at(-1)! <= 0.05, 'two-lead semantic compilation must fit its €0.05 hard cap')
  assert.equal(fetchCalls, 7, 'semantic-only output must require one provider call and no repair')

  const exactDigitalQuery = 'Trova imprese di pulizia a Milano con sito ufficiale, criticità SEO e assenza di strumenti di tracciamento pubblicitario.'
  const digitalFixture = JSON.parse(
    fs.readFileSync('contracts/fixtures/commercial-search-plan.valid.json', 'utf8'),
    // Test fixture is intentionally reshaped to reproduce a sparse provider payload.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ) as Record<string, any>
  digitalFixture.semantic_query_contract = semanticContract
  digitalFixture.seller = {
    offer_category: null,
    offer_description: 'Audit tecnico del sito aziendale',
    products_or_services: [],
    problems_solved: [],
    preferred_buyer_roles: [],
    sales_motion: null,
  }
  digitalFixture.target.industries = ['Servizi generici']
  digitalFixture.target.entity_types = ['company']
  digitalFixture.target.geographies = []
  digitalFixture.signal_policy.required_signals = []
  digitalFixture.signal_policy.optional_signals = []
  digitalFixture.signal_policy.maximum_age_days_by_signal = {}
  digitalFixture.source_policy.allowed_source_classes = ['official_company_website']
  digitalFixture.source_policy.preferred_source_classes = ['official_company_website']
  digitalFixture.commercial_hypotheses = []
  digitalFixture.audit_policy.detect_technologies = false
  globalThis.fetch = async () => {
    fetchCalls += 1
    return new Response(JSON.stringify({
      usage: { input_tokens: 70, output_tokens: 35 },
      content: [{ type: 'tool_use', name: 'submit_commercial_search_plan', input: digitalFixture }],
    }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  const digitalDiagnostics: unknown[] = []
  const digital = await compileCommercialSearchPlan(exactDigitalQuery, {
    searchId: '00000000-0000-0000-0000-000000000007', requestedLeadCount: 5,
    costMeter: meter, allowRepair: false,
    onDiagnostic: (diagnostic) => digitalDiagnostics.push(diagnostic),
  })
  assert.ok(digital, `exact digital audit query must compile: ${JSON.stringify(digitalDiagnostics)}`)
  assert.deepEqual(digital.signal_policy.required_signals.sort(), [
    'missing_advertising_pixel', 'missing_analytics', 'website_weakness',
  ])
  assert.deepEqual(digital.target.industries, ['imprese di pulizia'])
  assert.deepEqual(digital.target.geographies, ['Milano'])
  assert.deepEqual(digital.target.entity_types, ['company'])
  assert.equal(digital.audit_policy.detect_technologies, true)
  assert.ok(digital.source_policy.allowed_source_classes.includes('technology_audit'))
  assert.ok(digital.commercial_hypotheses.every((item) => item.signals.length > 0))
  const digitalExecutable = canonicalPlanToLegacy(digital)
  assert.equal(digitalExecutable.search_strategy, 'maps')
  assert.equal(digitalExecutable.sector, 'imprese di pulizia')
  assert.equal(digitalExecutable.location, 'Milano')
  assert.equal(digitalExecutable.source_coverage?.status, 'supported')
  assert.ok(digitalExecutable.source_coverage?.adapter_ids.includes('legacy_digital_audit_v1'))
  assert.equal(fetchCalls, 8, 'exact-query regression must use one mocked compiler response and no repair')
  console.log('Intent compiler normalization: safe structural + ontology causal completion; no repair call')
} finally {
  globalThis.fetch = priorFetch
  if (priorKey === undefined) delete process.env.ANTHROPIC_API_KEY
  else process.env.ANTHROPIC_API_KEY = priorKey
  if (priorModel === undefined) delete process.env.UQE_ANTHROPIC_MODEL
  else process.env.UQE_ANTHROPIC_MODEL = priorModel
}
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
