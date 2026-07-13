import assert from 'node:assert/strict'
import fs from 'node:fs'

import { compileCommercialSearchPlan } from '../src/lib/intent-compiler/compile-commercial-search-plan'
import { parseSignalIntentHeuristic } from '../src/lib/signal-intent/parse-heuristic'
import { canonicalSignalId } from '../src/lib/signal-ontology/ontology'
import { sourceSupportsSignal } from '../src/lib/source-intelligence/registry'
import { buildHeuristicMiraxQueryPlan, canonicalPlanToLegacy } from '../src/lib/uqe/mirax-query-planner'

const fixture = JSON.parse(
  fs.readFileSync('evaluation/fixtures/workplace-safety-incomplete-source-coverage-20260713.json', 'utf8'),
) as {
  query: string
  required_signals: string[]
  covered_signals_before_fix: string[]
}

const EVAL_QUERY = fixture.query
const EVAL_REQUIRED = fixture.required_signals
const CONTRACT = 'contract_awarded'
const HIRING = 'hiring_operational'
const EXPANSION = 'production_expansion'

const GENERIC_TEXT = /(?:necessit[aà]\s+(?:commerciale\s+)?implicita|bisogno\s+da\s+(?:confermare|verificare)|coerenza\s+(?:da\s+validare|con\s+l[' ]?obiettivo)|richiesta\s+dell[' ]?utente|da\s+verificare|placeholder)/i

const priorKey = process.env.ANTHROPIC_API_KEY
const priorFetch = globalThis.fetch
process.env.ANTHROPIC_API_KEY = 'offline-test-only'

const base = JSON.parse(fs.readFileSync('contracts/fixtures/commercial-search-plan.valid.json', 'utf8'))
let activePayload: Record<string, unknown> = {}

globalThis.fetch = async () => new Response(JSON.stringify({
  usage: { input_tokens: 80, output_tokens: 40 },
  content: [{ type: 'tool_use', name: 'submit_commercial_search_plan', input: activePayload }],
}), { status: 200, headers: { 'content-type': 'application/json' } })

const meter = {
  async reserve() { return { status: 'reserved' } },
  async settle() { return { status: 'settled' } },
  async release() { throw new Error('no provider failure expected') },
}

function canonicalRequired(query: string): string[] {
  const parsed = parseSignalIntentHeuristic(query)
  return [...new Set(parsed.required_signals.map((signal) => canonicalSignalId(signal) || signal))].sort()
}

function assertRequiredExact(label: string, query: string, expected: string[], forbidden: string[] = []) {
  const got = canonicalRequired(query)
  assert.deepEqual(got, [...expected].sort(), `${label}: unexpected required signal set for ${query}`)
  for (const signal of forbidden) {
    assert.ok(!got.includes(signal), `${label}: ${signal} must not be required for ${query}`)
  }
}

function assertPerSignalLanes(
  label: string,
  sourcePlan: Array<{
    lane: string
    source_types: string[]
    query_templates: string[]
    expected_evidence: string[]
  }>,
  requiredSignals: string[],
) {
  for (const signal of requiredSignals) {
    const lanes = sourcePlan.filter((lane) =>
      lane.expected_evidence.includes(signal) &&
      lane.source_types.some((source) => sourceSupportsSignal(source, signal)),
    )
    assert.ok(lanes.length > 0, `${label}: missing executable lane for ${signal}`)
    const dedicated = lanes.find((lane) => lane.expected_evidence.length === 1 && lane.expected_evidence[0] === signal)
    assert.ok(dedicated, `${label}: missing dedicated single-signal lane for ${signal}`)
    for (const lane of lanes) {
      assert.ok(lane.query_templates.length > 0, `${label}: ${signal} lane has no query templates`)
      assert.ok(
        lane.query_templates.every((template) => template.trim().length > 12),
        `${label}: ${signal} lane has empty or placeholder query template`,
      )
    }
  }

  for (const lane of sourcePlan) {
    if (requiredSignals.length > 1) {
      assert.ok(
        lane.expected_evidence.length < requiredSignals.length,
        `${label}: lane ${lane.lane} must not carry every required signal`,
      )
    }
    assert.ok(
      lane.expected_evidence.every((expected) =>
        lane.source_types.some((source) => sourceSupportsSignal(source, expected))),
      `${label}: lane ${lane.lane} has incompatible evidence`,
    )
  }
}

async function assertCompilerFloor(
  label: string,
  query: string,
  expected: string[],
  forbidden: string[] = [],
) {
  activePayload = structuredClone(base)
  ;(activePayload as any).seller = {
    offer_category: 'workplace_safety',
    offer_description: 'Consulenza sicurezza sul lavoro',
    products_or_services: ['consulenza sicurezza sul lavoro'],
    problems_solved: ['gestione rischio operativo'],
    sales_motion: 'consultative_outbound',
    preferred_buyer_roles: ['titolare', 'responsabile HSE'],
  }
  ;(activePayload as any).commercial_hypotheses = []
  ;(activePayload as any).signal_policy.required_signals = []
  ;(activePayload as any).signal_policy.optional_signals = []
  ;(activePayload as any).source_policy.allowed_source_classes = []
  ;(activePayload as any).source_policy.preferred_source_classes = []

  const plan = await compileCommercialSearchPlan(query, {
    searchId: '00000000-0000-0000-0000-000000000101',
    requestedLeadCount: 5,
    costMeter: meter,
    allowRepair: false,
  })
  assert.ok(plan, `${label}: compiler plan must pass`)
  const got = [...plan.signal_policy.required_signals].sort()
  assert.deepEqual(got, [...expected].sort(), `${label}: compiler required signals`)
  for (const signal of forbidden) {
    assert.ok(!plan.signal_policy.required_signals.includes(signal), `${label}: compiler must not require ${signal}`)
  }
}

async function main() {
  try {
    const caseA = 'Vendo servizi di sicurezza sul lavoro. Trovami aziende italiane che stanno assumendo operai.'
    const caseB = 'Vendo sicurezza sul lavoro. Trovami aziende che hanno recentemente vinto appalti.'
    const caseC = 'Vendo sicurezza sul lavoro. Trovami aziende che stanno aprendo nuovi stabilimenti.'

    assertRequiredExact('A heuristic', caseA, [HIRING], [CONTRACT, EXPANSION])
    assertRequiredExact('B heuristic', caseB, [CONTRACT], [HIRING, EXPANSION])
    assertRequiredExact('C heuristic', caseC, [EXPANSION], [CONTRACT, HIRING])

    await assertCompilerFloor('A compiler', caseA, [HIRING], [CONTRACT, EXPANSION])
    await assertCompilerFloor('B compiler', caseB, [CONTRACT], [HIRING, EXPANSION])
    await assertCompilerFloor('C compiler', caseC, [EXPANSION], [CONTRACT, HIRING])

    assertRequiredExact('D evaluation heuristic', EVAL_QUERY, EVAL_REQUIRED)
    const heuristicEval = buildHeuristicMiraxQueryPlan(EVAL_QUERY)
    assertPerSignalLanes('D heuristic', heuristicEval.source_plan || [], EVAL_REQUIRED)

    activePayload = structuredClone(base)
    ;(activePayload as any).seller = {
      offer_category: 'workplace_safety',
      offer_description: 'Consulenza sicurezza sul lavoro per PMI con cantieri, produzione e appalti',
      products_or_services: ['consulenza sicurezza sul lavoro', 'supporto HSE su cantiere e produzione'],
      problems_solved: ['gestione rischio operativo', 'conformità D.Lgs. 81/08', 'formazione personale di cantiere'],
      sales_motion: 'consultative_outbound',
      preferred_buyer_roles: ['titolare', 'responsabile HSE', 'responsabile operations'],
    }
    ;(activePayload as any).commercial_hypotheses = [{
      id: 'hypothesis-hiring-only',
      buyer_problem: 'La PMI sta aumentando il personale operativo su cantiere o in produzione senza adeguare il sistema HSE.',
      triggering_events: ['pubblicazione annuncio operai o tecnici', 'apertura nuove squadre operative'],
      signals: ['hiring_operational'],
      implied_need: 'Serve consulenza sicurezza per onboarding, DPI, formazione e documentazione del personale operativo.',
      relevance_to_offer: 'L assunzione di personale operativo rende urgente la valutazione dei rischi e la consulenza HSE.',
      confidence: 0.82,
    }]
    ;(activePayload as any).signal_policy.required_signals = fixture.covered_signals_before_fix
    ;(activePayload as any).signal_policy.optional_signals = []
    ;(activePayload as any).signal_policy.maximum_age_days_by_signal = { hiring_operational: 60 }
    ;(activePayload as any).source_policy.allowed_source_classes = ['company_careers', 'job_board']
    ;(activePayload as any).source_policy.preferred_source_classes = ['company_careers']

    const evalPlan = await compileCommercialSearchPlan(EVAL_QUERY, {
      searchId: '6ecc8d72-db71-4b06-a215-9cc0fb92f303',
      requestedLeadCount: 5,
      costMeter: meter,
      allowRepair: false,
    })
    assert.ok(evalPlan, 'D evaluation compiler plan must pass')
    for (const signal of EVAL_REQUIRED) {
      assert.ok(evalPlan.signal_policy.required_signals.includes(signal), `D evaluation must require ${signal}`)
      const hypothesis = evalPlan.commercial_hypotheses.find((item) => item.signals.includes(signal))
      assert.ok(hypothesis, `D evaluation hypothesis required for ${signal}`)
      assert.ok(hypothesis.triggering_events.length > 0, `${signal}: triggering events required`)
      assert.ok(!GENERIC_TEXT.test(hypothesis.buyer_problem), `${signal}: generic buyer problem`)
      assert.ok(!GENERIC_TEXT.test(hypothesis.implied_need), `${signal}: generic implied need`)
      assert.ok(!GENERIC_TEXT.test(hypothesis.relevance_to_offer), `${signal}: generic relevance`)
    }
    assertPerSignalLanes('D compiler', canonicalPlanToLegacy(evalPlan).source_plan || [], EVAL_REQUIRED)

    const paraphrases: Array<{ label: string; original: string; variant: string }> = [
      {
        label: 'A',
        original: caseA,
        variant: 'Offro servizi HSE: cercami imprese italiane in fase di assunzione di operai.',
      },
      {
        label: 'B',
        original: caseB,
        variant: 'Fornisco consulenza sicurezza lavoro: individua aziende con appalti aggiudicati di recente.',
      },
      {
        label: 'C',
        original: caseC,
        variant: 'Vendo sicurezza sul lavoro: trova PMI che inaugurano nuovi stabilimenti produttivi.',
      },
      {
        label: 'D',
        original: EVAL_QUERY,
        variant: 'Sono consulente HSE: individua PMI italiane con cantieri, produzione industriale, appalti recenti o crescita del personale operativo.',
      },
    ]

    for (const pair of paraphrases) {
      const original = canonicalRequired(pair.original)
      const variant = canonicalRequired(pair.variant)
      assert.deepEqual(
        variant,
        original,
        `E paraphrase ${pair.label}: semantic required-signal set must stay stable`,
      )
    }

    console.log('workplace_safety source coverage: PASS (negative/metamorphic + evaluation case D)')
  } finally {
    globalThis.fetch = priorFetch
    if (priorKey === undefined) delete process.env.ANTHROPIC_API_KEY
    else process.env.ANTHROPIC_API_KEY = priorKey
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
