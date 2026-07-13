import assert from 'node:assert/strict'

import { parseSignalIntentHeuristic } from '../src/lib/signal-intent/parse-heuristic'
import { inferSellerBuyerProfile } from '../src/lib/signal-intent/seller-buyer-inference'

const neverHiring = [
  'commercialista',
  'commercialisti',
  'studio commercialista',
]

for (const query of neverHiring) {
  const parsed = parseSignalIntentHeuristic(query)
  assert.equal(parsed.required_signals.includes('hiring'), false, `${query} must not become hiring`)
  assert.equal(parsed.hiring_roles.includes('commerciale'), false, `${query} must not become commercial role`)
}

for (const query of ['consulente commerciale', 'direttore commerciale', 'commerciale in espansione']) {
  const parsed = parseSignalIntentHeuristic(query)
  assert.equal(parsed.required_signals.includes('hiring'), false, `${query} alone is not evidence of hiring`)
}

const signalCases = [
  ['nuova società', 'new_company'],
  ['nuova apertura', 'new_company'],
  ['nuova apertura', 'expansion'],
  ['cambio societario', 'registry_change'],
  ['aumento di capitale', 'sector_investment'],
  ['nuova sede', 'expansion'],
] as const

for (const [query, signal] of signalCases) {
  const parsed = parseSignalIntentHeuristic(query)
  assert.ok(parsed.required_signals.includes(signal), `${query} must preserve ${signal}`)
}

const fleet = parseSignalIntentHeuristic('Sono un broker assicurativo: trovami PMI con flotta in espansione')
assert.ok(fleet.required_signals.includes('fleet_expansion'), 'fleet expansion must be preserved as fleet_expansion')
assert.equal(fleet.required_signals.includes('expansion'), false, 'fleet expansion must not become geographic expansion')

const operationalHiring = parseSignalIntentHeuristic('PMI con assunzioni operative recenti')
assert.ok(operationalHiring.required_signals.includes('hiring_operational'))
assert.equal(operationalHiring.required_signals.includes('hiring'), false)

const technologyHiring = parseSignalIntentHeuristic('PMI con assunzioni tech e migrazione software verificabile')
assert.ok(technologyHiring.required_signals.includes('hiring_technology'))
assert.ok(technologyHiring.required_signals.includes('tech_migration'))
assert.equal(technologyHiring.required_signals.includes('hiring'), false)

const salesHiring = parseSignalIntentHeuristic('PMI con assunzioni sales recenti')
assert.ok(salesHiring.required_signals.includes('hiring_sales'))
assert.equal(salesHiring.required_signals.includes('hiring'), false)

assert.ok(parseSignalIntentHeuristic('workflow manuali su Excel').required_signals.includes('manual_processes'))

const sellerScopedSoftware = parseSignalIntentHeuristic(
  'Sono una software house: trovami PMI italiane con assunzioni tech o migrazione software verificabile',
)
assert.ok(sellerScopedSoftware.required_signals.includes('hiring_technology'))
assert.ok(sellerScopedSoftware.required_signals.includes('tech_migration'))
assert.equal(sellerScopedSoftware.required_signals.includes('hiring'), false)

const sellerScopedSolar = parseSignalIntentHeuristic(
  'Vendo impianti fotovoltaici: trovami PMI italiane con sedi produttive in espansione',
)
assert.equal(
  sellerScopedSolar.required_signals.includes('sector_investment'),
  false,
  'seller offer terms must never become buyer evidence',
)

const sellerScopedErp = parseSignalIntentHeuristic(
  'Vendo ERP e CRM: trovami PMI italiane con migrazione gestionale verificabile',
)
assert.ok(sellerScopedErp.required_signals.includes('tech_migration'))
assert.equal(sellerScopedErp.required_signals.includes('crm_detected'), false)

for (const phrase of ['sito debole', 'sito inefficace']) {
  assert.ok(parseSignalIntentHeuristic(phrase).required_signals.includes('site_stale'), phrase)
}

assert.ok(
  parseSignalIntentHeuristic('PMI italiane non famose con sito debole').required_signals.includes('site_stale'),
  'an unrelated enterprise exclusion must not negate a later buying signal',
)
assert.equal(
  parseSignalIntentHeuristic('PMI senza sito debole').required_signals.includes('site_stale'),
  false,
  'a negation immediately attached to the matched signal must remain local and effective',
)

const apostropheSeller = inferSellerBuyerProfile("Sono un'agenzia web locale: trovami PMI con sito debole")
assert.equal(apostropheSeller.is_seller_query, true)
assert.match(apostropheSeller.user_service || '', /agenzia web locale/i)

console.log('Contextual adversarial parser: 38/38 OK')
