/**
 * Self-check routing guards — no network, no LLM.
 * Run: npx tsx scripts/test-routing-guards.ts
 */
import {
  buildHeuristicMiraxQueryPlan,
  applyRoutingGuards,
  isSellerAbstractQuery,
} from '../src/lib/uqe/mirax-query-planner'
import { MAX_LEADS_PER_SEARCH, clampSearchMaxLeads } from '../src/lib/search-job-payload'
import type { UqeSearchStrategy } from '../src/types/uqe'

type RoutingCase = {
  query: string
  expectStrategy: UqeSearchStrategy
  notStrategy?: UqeSearchStrategy
  expectSector?: string
  expectSignals?: string[]
  label: string
}

const cases: RoutingCase[] = [
  {
    query: 'imprese di pulizie a otranto',
    expectStrategy: 'maps' as const,
    label: 'categoria + città',
  },
  {
    query: 'ristoranti Milano',
    expectStrategy: 'maps' as const,
    label: 'maps classico',
  },
  {
    query: 'aziende che stanno investendo in marketing',
    expectStrategy: 'organic_web_search' as const,
    expectSector: 'Segnali acquisto',
    expectSignals: ['investing_marketing'],
    label: 'buyer signal marketing',
  },
  {
    query: 'trovami clienti per commercialista',
    expectStrategy: 'organic_web_search' as const,
    label: 'seller abstract',
  },
  {
    query: 'hotel a Roma senza meta pixel',
    expectStrategy: 'maps' as const,
    label: 'categoria + città + filtro tecnico',
  },
]

let failed = 0

for (const c of cases) {
  const plan = buildHeuristicMiraxQueryPlan(c.query)
  const guarded = applyRoutingGuards(plan, c.query)
  const strategy = guarded.search_strategy
  const ok =
    strategy === c.expectStrategy &&
    (!c.notStrategy || strategy !== c.notStrategy) &&
    (!('expectSector' in c) || guarded.sector === (c as { expectSector?: string }).expectSector) &&
    (!('expectSignals' in c) ||
      (c as { expectSignals?: string[] }).expectSignals?.every((s) =>
        guarded.required_signals.includes(s),
      ))

  if (!ok) {
    failed++
    console.error(`FAIL [${c.label}] "${c.query}"`)
    console.error(`  got: ${strategy}, expected: ${c.expectStrategy}`)
    console.error(`  sector=${guarded.sector} location=${guarded.location}`)
  } else {
    console.log(`OK   [${c.label}] → ${strategy}`)
  }
}

const sellerOk = isSellerAbstractQuery('trovami clienti per commercialista')
const buyerOk = !isSellerAbstractQuery('aziende che stanno investendo in marketing')
if (!sellerOk || !buyerOk) {
  failed++
  console.error('FAIL isSellerAbstractQuery heuristics')
} else {
  console.log('OK   isSellerAbstractQuery')
}

const hotAccountQuery =
  'Trovami 50 PMI italiane a cui vendere il mio software di lead generation e Sales Intelligence, estremamente calde con segnali di acquisto concreti'
const hotAccountPlan = buildHeuristicMiraxQueryPlan(hotAccountQuery)
const hotAccountOk =
  hotAccountPlan.search_strategy === 'organic_web_search' &&
  hotAccountPlan.location === 'Italia' &&
  hotAccountPlan.sector === 'PMI B2B con team commerciale in espansione' &&
  hotAccountPlan.required_signals.includes('hiring') &&
  hotAccountPlan.required_signals.includes('expansion') &&
  hotAccountPlan.commercial_hypothesis?.hiring_roles.includes('Sales Development Representative') &&
  hotAccountPlan.commercial_hypothesis?.decision_maker_roles.includes('Head of Sales') &&
  hotAccountPlan.source_plan?.some((lane) => lane.lane === 'ads') &&
  hotAccountPlan.source_plan?.some((lane) => lane.lane === 'partnerships') &&
  hotAccountPlan.source_plan?.some((lane) => lane.lane === 'events') &&
  hotAccountPlan.ranking_policy?.require_concrete_evidence === true &&
  hotAccountPlan.extraction_schema.includes('source_url') &&
  hotAccountPlan.extraction_schema.includes('decision_maker')
if (!hotAccountOk) {
  failed++
  console.error('FAIL seller-to-buyer hot-account reasoning', hotAccountPlan)
} else {
  console.log('OK   seller-to-buyer hot-account reasoning')
}

const accountantPlan = buildHeuristicMiraxQueryPlan('sono un commercialista, trovami clienti caldi per contabilita e fiscalita')
const accountantOk =
  accountantPlan.search_strategy === 'organic_web_search' &&
  accountantPlan.sector.toLowerCase().includes('amministrativo') &&
  accountantPlan.required_signals.includes('new_company') &&
  accountantPlan.required_signals.includes('registry_change') &&
  accountantPlan.required_signals.includes('hiring') &&
  accountantPlan.commercial_hypothesis?.hiring_roles.includes('Impiegato amministrativo') &&
  accountantPlan.source_plan?.some((lane) => lane.lane === 'public_registry') &&
  accountantPlan.source_plan?.some((lane) => lane.lane === 'job_market')
if (!accountantOk) {
  failed++
  console.error('FAIL seller-to-buyer commercialista playbook', accountantPlan)
} else {
  console.log('OK   seller-to-buyer commercialista playbook')
}

const insurancePlan = buildHeuristicMiraxQueryPlan('sono un broker assicurativo, trovami aziende calde per polizze aziendali')
const insuranceOk =
  insurancePlan.search_strategy === 'organic_web_search' &&
  insurancePlan.sector.toLowerCase().includes('rischio assicurabile') &&
  insurancePlan.required_signals.includes('hiring') &&
  insurancePlan.required_signals.includes('tender_won') &&
  insurancePlan.required_signals.includes('regulatory') &&
  insurancePlan.commercial_hypothesis?.hiring_roles.includes('Autista') &&
  insurancePlan.source_plan?.some((lane) => lane.lane === 'public_procurement') &&
  insurancePlan.source_plan?.some((lane) => lane.lane === 'compliance')
if (!insuranceOk) {
  failed++
  console.error('FAIL seller-to-buyer insurance broker playbook', insurancePlan)
} else {
  console.log('OK   seller-to-buyer insurance broker playbook')
}

const webAgencyPlan = buildHeuristicMiraxQueryPlan('sono un sales manager di agenzia web, trovami aziende a cui rifare il sito')
const webAgencyOk =
  webAgencyPlan.search_strategy === 'organic_web_search' &&
  webAgencyPlan.sector.toLowerCase().includes('sito migliorabile') &&
  webAgencyPlan.required_signals.includes('site_stale') &&
  webAgencyPlan.required_signals.includes('no_pixel') &&
  webAgencyPlan.required_signals.includes('no_gtm') &&
  webAgencyPlan.commercial_hypothesis?.disqualifiers.some((d) => d.toLowerCase().includes('agenzie')) &&
  webAgencyPlan.source_plan?.some((lane) => lane.lane === 'technology') &&
  webAgencyPlan.source_plan?.some((lane) => lane.lane === 'ads')
if (!webAgencyOk) {
  failed++
  console.error('FAIL seller-to-buyer web agency playbook', webAgencyPlan)
} else {
  console.log('OK   seller-to-buyer web agency playbook')
}
const adsSignalPlan = buildHeuristicMiraxQueryPlan('PMI che spendono in pubblicità e hanno campagne attive a Milano')
const adsSignalOk =
  adsSignalPlan.search_strategy === 'organic_web_search' &&
  adsSignalPlan.required_signals.includes('investing_marketing') &&
  adsSignalPlan.source_plan?.some((lane) => lane.lane === 'ads')
if (!adsSignalOk) {
  failed++
  console.error('FAIL ads/source-lane hot signal reasoning', adsSignalPlan)
} else {
  console.log('OK   ads/source-lane hot signal reasoning')
}

if (failed > 0) {
  console.error(`\n${failed} test(s) failed`)
  process.exit(1)
}

const capOk =
  MAX_LEADS_PER_SEARCH === 10000 &&
  clampSearchMaxLeads(1000) === 1000 &&
  clampSearchMaxLeads(10000) === 10000 &&
  clampSearchMaxLeads(10001) === 10000
if (!capOk) {
  failed++
  console.error('FAIL lead target cap contract', {
    MAX_LEADS_PER_SEARCH,
    c1000: clampSearchMaxLeads(1000),
    c10000: clampSearchMaxLeads(10000),
    c10001: clampSearchMaxLeads(10001),
  })
} else {
  console.log('OK   lead target cap contract 1000/10000')
}

// Simula risposta GPT errata (sector=marketing, segnali sbagliati)
const gptWrong = applyRoutingGuards(
  {
    original_query: 'aziende che stanno investendo in marketing',
    search_strategy: 'hybrid',
    sector: 'marketing',
    location: '',
    required_signals: ['funding_received', 'expansion'],
    technical_filters: {},
    extraction_schema: ['email'],
    confidence: 0.9,
    intent_summary: 'test',
    parse_source: 'llm',
    user_message: null,
    reasoning: null,
  },
  'aziende che stanno investendo in marketing',
)
if (
  gptWrong.search_strategy !== 'organic_web_search' ||
  gptWrong.sector !== 'Segnali acquisto' ||
  !gptWrong.required_signals.includes('investing_marketing') ||
  gptWrong.required_signals.includes('funding_received')
) {
  failed++
  console.error('FAIL GPT override for buyer marketing', gptWrong)
} else {
  console.log('OK   GPT override buyer marketing → organic_web_search + investing_marketing')
}

if (failed > 0) {
  console.error(`\n${failed} test(s) failed`)
  process.exit(1)
}
console.log(`\nAll ${cases.length + 8} routing checks passed.`)
