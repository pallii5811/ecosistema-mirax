import assert from 'node:assert/strict'

import {
  compileCommercialSearchPlan,
  type QueryCompilerTelemetry,
} from '../src/lib/intent-compiler/compile-commercial-search-plan'

type Case = {
  query: string
  relationship: string
  role: string
  excluded: string[]
  hints?: string[]
  seller?: string
  geography?: string[]
}

const groups: Array<Omit<Case, 'query'> & { queries: string[] }> = [
  {
    relationship: 'international_sales_preparation_by_target_company', role: 'expanding_company',
    excluded: ['advisor', 'publisher'], hints: ['internationalization'], geography: ['Italia'],
    queries: [
      'Cerco imprese che si stanno preparando a vendere anche all’estero.',
      'Società italiane che stanno organizzando l’ingresso in mercati stranieri.',
      'Imprese pronte a portare la propria offerta fuori dall’Italia.',
      'Chi sta costruendo adesso una presenza commerciale internazionale?',
      'Aziende che sembrano prepararsi a trovare clienti oltreconfine.',
    ],
  },
  {
    relationship: 'sales_team_expansion_by_target_company', role: 'employer',
    excluded: ['recruiter', 'job_board', 'publisher'], hints: ['hiring_sales'], seller: 'CRM', geography: ['Italia'],
    queries: [
      'Vendo CRM e cerco società che stanno rafforzando la squadra incaricata di trovare nuovi clienti.',
      'Offro sales intelligence: chi sta inserendo persone per sviluppare clientela B2B?',
      'Sono un consulente commerciale, trovami imprese che ampliano il team vendite.',
      'Cerco aziende dove stanno entrando nuovi business developer.',
      'Aziende che potenziano adesso chi si occupa di acquisire clienti.',
    ],
  },
  {
    relationship: 'financial_resources_received_by_target_company', role: 'recipient',
    excluded: ['lender', 'funder', 'investor_only', 'publisher'], hints: ['funding', 'financing'], geography: ['Italia'],
    queries: [
      'Imprese a cui sono state destinate nuove risorse economiche.',
      'Trova aziende italiane che hanno ricevuto recentemente nuova finanza.',
      'Società alle quali è stato concesso capitale per crescere.',
      'A chi sono arrivati fondi freschi negli ultimi mesi?',
      'Imprese beneficiarie di nuove risorse finanziarie, non gli enti erogatori.',
    ],
  },
  {
    relationship: 'previous_supplier_relationship_ended_by_target_company', role: 'former_customer',
    excluded: ['former_supplier', 'publisher'], hints: [], geography: ['Italia'],
    queries: [
      'Trova aziende che non lavorano più con il loro precedente fornitore.',
      'Imprese rimaste senza il partner operativo che usavano prima.',
      'Società che hanno interrotto una relazione con un fornitore importante.',
      'Chi ha appena lasciato il vecchio provider e deve sostituirlo?',
      'Aziende per cui è terminato il rapporto con il fornitore storico.',
    ],
  },
  {
    relationship: 'territorial_presence_expanded_by_target_company', role: 'expanding_company',
    excluded: ['landlord', 'publisher', 'municipality'], hints: ['geographic_expansion'], geography: ['Lombardia'],
    queries: [
      'Società la cui presenza commerciale si sta allargando fuori dalla regione.',
      'Imprese lombarde che stanno aprendo nuovi presidi sul territorio.',
      'Chi sta estendendo la propria presenza in nuove province lombarde?',
      'Aziende che allargano ora la copertura territoriale.',
      'Trova attività lombarde entrate di recente in nuove aree.',
    ],
  },
  {
    relationship: 'corporate_change_affecting_target_company', role: 'changed_company',
    excluded: ['accountant', 'registry', 'publisher'], hints: ['registry_change'], seller: 'servizi contabili', geography: ['Italia'],
    queries: [
      'Sono commercialista: cerco PMI con cambi societari recenti.',
      'Offro consulenza fiscale a imprese che hanno appena modificato la compagine.',
      'Vendo servizi amministrativi, chi ha cambiato assetto aziendale?',
      'Trovami società con passaggi di proprietà o amministratori nuovi.',
      'PMI italiane interessate da una trasformazione societaria recente.',
    ],
  },
  {
    relationship: 'advertising_tracking_absent_on_target_website', role: 'website_owner',
    excluded: ['web_agency', 'directory', 'publisher'], hints: ['missing_advertising_pixel', 'missing_analytics'], geography: ['Milano'],
    queries: [
      'Imprese di pulizia a Milano senza strumenti pubblicitari sul sito.',
      'Cerco pulizie milanesi con tracciamento marketing assente.',
      'Aziende di cleaning a Milano il cui sito non misura le campagne.',
      'Chi fa pulizie a Milano ma non usa pixel o analytics?',
      'Trova imprese milanesi di pulizia prive di tracking pubblicitario.',
    ],
  },
  {
    relationship: 'public_contract_awarded_to_target_company', role: 'winner',
    excluded: ['contracting_authority', 'participant_only', 'publisher'], hints: ['contract_awarded'], geography: ['Italia'],
    queries: [
      'Aziende italiane a cui è stato aggiudicato un nuovo appalto.',
      'Chi ha vinto di recente una gara pubblica in Italia?',
      'Imprese risultate aggiudicatarie, non le stazioni appaltanti.',
      'Trova PMI che si sono assicurate una commessa pubblica.',
      'Società beneficiarie di una recente aggiudicazione.',
    ],
  },
  {
    relationship: 'legacy_software_replaced_by_target_company', role: 'technology_adopter',
    excluded: ['software_vendor', 'publisher', 'advisor'], hints: ['technology_migration'], geography: ['Italia'],
    queries: [
      'Imprese che hanno abbandonato il vecchio gestionale per una nuova piattaforma.',
      'Chi sta sostituendo il software aziendale precedente?',
      'Società migrate da un CRM storico a uno diverso.',
      'Aziende che non usano più il gestionale di prima.',
      'Trovami imprese nel mezzo di un cambio di piattaforma gestionale.',
    ],
  },
  {
    relationship: 'territorial_and_sales_expansion_by_target_company', role: 'expanding_employer',
    excluded: ['recruiter', 'publisher', 'landlord'], hints: ['geographic_expansion', 'hiring_sales'], geography: ['Lombardia'],
    queries: [
      'Aziende lombarde che ampliano il territorio e nello stesso periodo rafforzano le vendite.',
      'Chi in Lombardia apre nuove aree commerciali e assume venditori?',
      'Società che si espandono geograficamente mentre potenziano il team sales.',
      'Imprese lombarde con nuovi presidi e più persone dedicate ai clienti.',
      'Trova aziende che allargano insieme copertura territoriale e capacità commerciale.',
    ],
  },
]

const cases: Case[] = groups.flatMap(({ queries, ...rest }) => queries.map((query) => ({ query, ...rest })))
assert.equal(cases.length, 50)

function seed(testCase: Case, confidence = 0.91) {
  return {
    query_goal: testCase.query,
    seller: testCase.seller ? {
      offer_category: testCase.seller,
      products_or_services: [testCase.seller],
      problems_solved: ['the buyer condition described in the request'],
      preferred_buyer_roles: ['commercial decision maker'],
    } : {},
    offer: testCase.seller ? { description: testCase.seller, sales_motion: 'consultative_outbound' } : {},
    target_entity_types: ['operating_company'],
    target_company_description: 'The operating company satisfying the user condition',
    event_or_state_description: testCase.relationship.replaceAll('_', ' '),
    target_role_in_event: testCase.role,
    required_relationships: [testCase.relationship],
    excluded_roles: testCase.excluded,
    excluded_entities: [],
    geography: testCase.geography || [],
    industry: [],
    size_constraints: { preference: 'SME' },
    temporal_constraints: { recent: true },
    positive_conditions: ['the relationship is explicitly evidenced'],
    negative_conditions: [],
    clarification_required: false,
    confidence,
    canonical_signal_hints: testCase.hints || [],
  }
}

async function main() {
const priorFetch = globalThis.fetch
const priorKey = process.env.ANTHROPIC_API_KEY
const priorTier1 = process.env.UQE_ANTHROPIC_TIER1_MODEL
const priorTier2 = process.env.UQE_ANTHROPIC_TIER2_MODEL
process.env.ANTHROPIC_API_KEY = 'test-only'
process.env.UQE_ANTHROPIC_TIER1_MODEL = 'claude-haiku-4-5'
process.env.UQE_ANTHROPIC_TIER2_MODEL = 'claude-sonnet-5'

let fetchCalls = 0
const toolNames: string[] = []
const telemetry: QueryCompilerTelemetry[] = []
const reservations: number[] = []
const meter = {
  async reserve(input: { estimatedCostEur: number }) {
    reservations.push(input.estimatedCostEur)
    return { status: 'reserved' }
  },
  async settle() { return { status: 'settled' } },
  async release() { return { status: 'released' } },
}

try {
  globalThis.fetch = async (_url, init) => {
    fetchCalls += 1
    const body = JSON.parse(String(init?.body || '{}')) as Record<string, unknown>
    const tools = body.tools as Array<{ name: string }> || []
    toolNames.push(String(tools[0]?.name || ''))
    const messages = body.messages as Array<{ content: string }> || []
    const payload = JSON.parse(messages[0]?.content || '{}') as { original_query?: string }
    const testCase = cases.find((item) => item.query === payload.original_query)
    assert.ok(testCase, `fixture missing for ${payload.original_query}`)
    return new Response(JSON.stringify({
      stop_reason: 'tool_use', usage: { input_tokens: 500, output_tokens: 300 },
      content: [{ type: 'tool_use', name: 'submit_commercial_search_plan', input: seed(testCase) }],
    }), { status: 200, headers: { 'content-type': 'application/json' } })
  }

  for (const [index, testCase] of cases.entries()) {
    const plan = await compileCommercialSearchPlan(testCase.query, {
      searchId: `tiered-offline-${String(index + 1).padStart(3, '0')}`,
      requestedLeadCount: 5, costMeter: meter, allowRepair: false,
      onDiagnostic: (diagnostic) => console.error(JSON.stringify({ case: index + 1, diagnostic })),
      onTelemetry: (event) => telemetry.push(event),
    })
    assert.ok(plan, `valid semantic contract required for case ${index + 1}`)
    assert.equal(plan.raw_query, testCase.query)
    assert.equal(plan.semantic_query_contract?.original_query, testCase.query)
    assert.equal(plan.semantic_query_contract?.target_role_in_event, testCase.role)
    assert.ok(plan.semantic_query_contract?.required_relationships.includes(testCase.relationship))
    assert.deepEqual(plan.semantic_query_contract?.excluded_roles, testCase.excluded)
    if ((testCase.hints || []).length === 0) {
      assert.equal(plan.semantic_query_contract?.canonical_signal_hints.length, 0)
    }
  }
  assert.equal(fetchCalls, 50, 'valid Tier-1 contracts must never trigger a duplicate full call')
  assert.ok(toolNames.every((name) => name === 'submit_commercial_search_plan'))
  assert.ok(telemetry.every((item) => item.query_tier1_calls === 1 && item.query_tier2_calls === 0))
  assert.ok(telemetry.every((item) => item.query_compilation_status === 'tier1_accepted'))
  const costs = telemetry.map((item) => item.query_compilation_cost).sort((a, b) => a - b)
  const average = costs.reduce((sum, value) => sum + value, 0) / costs.length
  const p95 = costs[Math.ceil(costs.length * 0.95) - 1]
  assert.ok(average <= 0.008)
  assert.ok(p95 <= 0.012)
  assert.ok(reservations.every((value) => value <= 0.012))

  let tieredCalls = 0
  let tieredTelemetry: QueryCompilerTelemetry | null = null
  const tieredCase = cases[2]
  globalThis.fetch = async (_url, init) => {
    tieredCalls += 1
    const body = JSON.parse(String(init?.body || '{}')) as Record<string, unknown>
    const tool = (body.tools as Array<{ name: string }>)[0]
    if (tieredCalls === 1) {
      return new Response(JSON.stringify({
        stop_reason: 'max_tokens', usage: { input_tokens: 450, output_tokens: 1000 }, content: [],
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    assert.equal(tool.name, 'submit_semantic_query_patch')
    return new Response(JSON.stringify({
      stop_reason: 'tool_use', usage: { input_tokens: 650, output_tokens: 180 },
      content: [{ type: 'tool_use', name: 'submit_semantic_query_patch', input: {
        decision: 'patch', reason: 'Recover the semantic core only', confidence: 0.94,
        patch: {
          query_goal: tieredCase.query,
          target_company_description: 'companies receiving newly allocated financial resources',
          event_or_state_description: 'new financial resources were allocated to the target company',
          target_role_in_event: tieredCase.role,
          required_relationships: [tieredCase.relationship],
          excluded_roles: tieredCase.excluded,
          geography: tieredCase.geography || [],
          confidence: 0.94,
        },
      } }],
    }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  const recovered = await compileCommercialSearchPlan(tieredCase.query, {
    searchId: 'tiered-offline-recovery', requestedLeadCount: 5, costMeter: meter,
    allowRepair: false, allowTier2: true, onTelemetry: (event) => { tieredTelemetry = event },
  })
  assert.ok(recovered)
  assert.equal(tieredCalls, 2)
  assert.equal((tieredTelemetry as QueryCompilerTelemetry | null)?.query_tier2_calls, 1)
  assert.equal((tieredTelemetry as QueryCompilerTelemetry | null)?.query_compilation_status, 'tier2_patched')

  let failedTier2Calls = 0
  const doubleTruncationCase = { ...cases[3], query: `${cases[3].query} Variante fail-closed.` }
  globalThis.fetch = async () => {
    failedTier2Calls += 1
    return new Response(JSON.stringify({
      stop_reason: 'max_tokens', usage: { input_tokens: 400, output_tokens: failedTier2Calls === 1 ? 1_000 : 700 }, content: [],
    }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  await assert.rejects(
    compileCommercialSearchPlan(doubleTruncationCase.query, {
      searchId: 'tiered-offline-double-truncation', requestedLeadCount: 5, costMeter: meter,
      allowTier2: true,
    }),
    /SEMANTIC_QUERY_COMPILATION_FAILED/,
  )
  assert.equal(failedTier2Calls, 2, 'Tier-2 truncation must fail closed without a third provider call')

  let confidenceCalls = 0
  const lowConfidenceCase = { ...cases[4], query: `${cases[4].query} Variante confidence.` }
  globalThis.fetch = async (_url, init) => {
    confidenceCalls += 1
    const body = JSON.parse(String(init?.body || '{}')) as Record<string, unknown>
    const tool = (body.tools as Array<{ name: string }>)[0]
    if (confidenceCalls === 1) {
      return new Response(JSON.stringify({
        stop_reason: 'tool_use', usage: { input_tokens: 500, output_tokens: 300 },
        content: [{ type: 'tool_use', name: tool.name, input: seed(lowConfidenceCase, 0.5) }],
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    return new Response(JSON.stringify({
      stop_reason: 'tool_use', usage: { input_tokens: 600, output_tokens: 80 },
      content: [{ type: 'tool_use', name: tool.name, input: {
        decision: 'patch', patch: { confidence: 0.9 }, reason: 'Resolve low confidence only', confidence: 0.9,
      } }],
    }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  const confidenceRecovered = await compileCommercialSearchPlan(lowConfidenceCase.query, {
    searchId: 'tiered-offline-low-confidence', requestedLeadCount: 5, costMeter: meter, allowTier2: true,
  })
  assert.ok(confidenceRecovered)
  assert.equal(confidenceCalls, 2)
  assert.equal(confidenceRecovered.semantic_query_contract?.confidence, 0.9)

  let roleMismatchCalls = 0
  const roleMismatchCase = {
    ...cases[1],
    query: `${cases[1].query} Variante ruolo azienda.`,
  }
  globalThis.fetch = async (_url, init) => {
    roleMismatchCalls += 1
    const body = JSON.parse(String(init?.body || '{}')) as Record<string, unknown>
    const tool = (body.tools as Array<{ name: string }>)[0]
    if (roleMismatchCalls === 1) {
      const bad = seed(roleMismatchCase)
      bad.target_role_in_event = 'Business development team member or sales leadership'
      bad.target_entity_types = ['operating_company']
      return new Response(JSON.stringify({
        stop_reason: 'tool_use', usage: { input_tokens: 500, output_tokens: 300 },
        content: [{ type: 'tool_use', name: tool.name, input: bad }],
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    assert.equal(tool.name, 'submit_semantic_query_patch')
    return new Response(JSON.stringify({
      stop_reason: 'tool_use', usage: { input_tokens: 600, output_tokens: 120 },
      content: [{ type: 'tool_use', name: tool.name, input: {
        decision: 'patch',
        reason: 'Company entity requires company-in-event role',
        confidence: 0.93,
        patch: {
          target_role_in_event: 'employer',
          required_relationships: [roleMismatchCase.relationship],
        },
      } }],
    }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  const roleRecovered = await compileCommercialSearchPlan(roleMismatchCase.query, {
    searchId: 'tiered-offline-role-mismatch', requestedLeadCount: 5, costMeter: meter, allowTier2: true,
  })
  assert.ok(roleRecovered)
  assert.equal(roleMismatchCalls, 2)
  assert.equal(roleRecovered.semantic_query_contract?.target_role_in_event, 'employer')

  console.log(JSON.stringify({
    cases: 50, truncations: 0, average_cost_eur: average, p95_cost_eur: p95,
    tier2_patch_recovery: 'PASS', tier2_truncation_fail_closed: 'PASS', low_confidence_patch_only: 'PASS',
    target_role_entity_mismatch_patch: 'PASS',
  }))
} finally {
  globalThis.fetch = priorFetch
  if (priorKey === undefined) delete process.env.ANTHROPIC_API_KEY
  else process.env.ANTHROPIC_API_KEY = priorKey
  if (priorTier1 === undefined) delete process.env.UQE_ANTHROPIC_TIER1_MODEL
  else process.env.UQE_ANTHROPIC_TIER1_MODEL = priorTier1
  if (priorTier2 === undefined) delete process.env.UQE_ANTHROPIC_TIER2_MODEL
  else process.env.UQE_ANTHROPIC_TIER2_MODEL = priorTier2
}
}

void main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
