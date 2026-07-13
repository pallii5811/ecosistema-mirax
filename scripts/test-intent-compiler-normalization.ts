import assert from 'node:assert/strict'
import fs from 'node:fs'

import { compileCommercialSearchPlan } from '../src/lib/intent-compiler/compile-commercial-search-plan'
import { canonicalPlanToLegacy } from '../src/lib/uqe/mirax-query-planner'
import { sourceSupportsSignal } from '../src/lib/source-intelligence/registry'
import { parseSignalIntentHeuristic } from '../src/lib/signal-intent/parse-heuristic'

const fixture = JSON.parse(
  fs.readFileSync('contracts/fixtures/commercial-search-plan.valid.json', 'utf8'),
) as Record<string, any>
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
const meter = {
  async reserve() { return { status: 'reserved' } },
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
