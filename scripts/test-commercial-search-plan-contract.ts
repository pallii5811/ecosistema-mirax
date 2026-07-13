import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  COMMERCIAL_SEARCH_PLAN_SCHEMA_VERSION,
  parseCommercialSearchPlan,
  safeParseCommercialSearchPlan,
} from '../src/lib/contracts/commercial-search-plan'
import {
  compilerToolSchema,
  validateCommercialPlanSemantics,
} from '../src/lib/intent-compiler/compile-commercial-search-plan'
import { SIGNAL_ONTOLOGY, canonicalSignalId } from '../src/lib/signal-ontology/ontology'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const fixture = JSON.parse(
  fs.readFileSync(path.join(root, 'contracts/fixtures/commercial-search-plan.valid.json'), 'utf8'),
)
const jsonSchema = JSON.parse(
  fs.readFileSync(path.join(root, 'contracts/commercial-search-plan.schema.json'), 'utf8'),
)

const parsed = parseCommercialSearchPlan(fixture)
assert.equal(parsed.schema_version, COMMERCIAL_SEARCH_PLAN_SCHEMA_VERSION)
assert.equal(jsonSchema.properties.schema_version.const, COMMERCIAL_SEARCH_PLAN_SCHEMA_VERSION)
assert.equal(parsed.target.local_business_preference, true)
assert.equal(parsed.commercial_hypotheses[0].signals.includes('tender_won'), true)

const unknownField = structuredClone(fixture)
unknownField.untrusted_llm_field = 'must fail closed'
assert.equal(safeParseCommercialSearchPlan(unknownField).success, false)

const invalidBudget = structuredClone(fixture)
invalidBudget.budget_policy.target_cost_eur = 1
invalidBudget.budget_policy.hard_cost_eur = 0.5
assert.equal(safeParseCommercialSearchPlan(invalidBudget).success, false)

const invalidWeights = structuredClone(fixture)
invalidWeights.ranking_policy.weight_need_gap = 0.5
assert.equal(safeParseCommercialSearchPlan(invalidWeights).success, false)

const sellerBuyerInversion = structuredClone(fixture)
sellerBuyerInversion.raw_query = 'Sono un broker assicurativo e cerco clienti'
sellerBuyerInversion.target.industries = ['broker assicurativo']
const invertedPlan = parseCommercialSearchPlan(sellerBuyerInversion)
assert.equal(
  validateCommercialPlanSemantics(invertedPlan).some((issue) => issue.code === 'SELLER_BUYER_INVERSION'),
  true,
)

const unknownSource = structuredClone(fixture)
unknownSource.source_policy.allowed_source_classes.push('llm_invented_source')
const unknownSourcePlan = parseCommercialSearchPlan(unknownSource)
assert.equal(
  validateCommercialPlanSemantics(unknownSourcePlan).some((issue) => issue.code === 'UNKNOWN_SOURCE_CLASS'),
  true,
)

assert.equal(SIGNAL_ONTOLOGY.length >= 35, true)
assert.equal(canonicalSignalId('tender_won'), 'contract_awarded')

const unknownSignal = structuredClone(fixture)
unknownSignal.signal_policy.optional_signals.push('magic_hot_lead_signal')
assert.equal(
  validateCommercialPlanSemantics(parseCommercialSearchPlan(unknownSignal)).some(
    (issue) => issue.code === 'UNKNOWN_SIGNAL_ID',
  ),
  true,
)

const sparseSeller = structuredClone(fixture)
sparseSeller.raw_query = 'Sono un commercialista: trovami PMI italiane con nuove aperture e cambi societari recenti'
sparseSeller.seller = {
  offer_category: null,
  offer_description: sparseSeller.raw_query,
  products_or_services: [],
  problems_solved: [],
  sales_motion: null,
  preferred_buyer_roles: [],
}
sparseSeller.commercial_hypotheses = [{
  id: 'user-objective',
  buyer_problem: `Necessita commerciale implicita da verificare: ${sparseSeller.raw_query}`,
  triggering_events: [],
  signals: ['registry_change'],
  implied_need: 'Bisogno da confermare esclusivamente con evidenza osservabile',
  relevance_to_offer: 'Coerenza con l obiettivo commerciale espresso dall utente',
  confidence: 0.5,
}]
sparseSeller.signal_policy.required_signals = ['registry_change']
const sparseSellerIssues = validateCommercialPlanSemantics(parseCommercialSearchPlan(sparseSeller))
for (const expected of [
  'SELLER_OFFER_CATEGORY_MISSING',
  'SELLER_PRODUCT_MISSING',
  'SELLER_PROBLEM_MISSING',
  'BUYER_ROLE_MISSING',
  'SELLER_DESCRIPTION_COPIES_QUERY',
  'TRIGGERING_EVENT_MISSING',
  'GENERIC_COMMERCIAL_HYPOTHESIS',
]) {
  assert.equal(sparseSellerIssues.some((issue) => issue.code === expected), true, expected)
}

const strictSellerSchema = compilerToolSchema(sparseSeller.raw_query) as any
assert.equal(strictSellerSchema.$defs.seller.properties.offer_category.type, 'string')
assert.equal(strictSellerSchema.$defs.seller.properties.products_or_services.minItems, 1)
assert.equal(strictSellerSchema.$defs.seller.properties.problems_solved.minItems, 1)
assert.equal(strictSellerSchema.$defs.seller.properties.preferred_buyer_roles.minItems, 1)
assert.equal(strictSellerSchema.$defs.commercialHypothesis.properties.triggering_events.minItems, 1)
assert.equal(strictSellerSchema.$defs.signalPolicy.properties.required_signals.minItems, 1)
const directBuyerSchema = compilerToolSchema('architetti a Genova') as any
assert.equal(directBuyerSchema.$defs.seller.properties.products_or_services.minItems, undefined)

console.log('Commercial plan + source registry + high-value semantics: 23/23 OK')
