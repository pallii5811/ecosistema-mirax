import assert from 'node:assert/strict'
import { buildHeuristicMiraxQueryPlan } from '../src/lib/uqe/mirax-query-planner'

const procurement = buildHeuristicMiraxQueryPlan(
  'Trovami imprese edili a Torino che hanno vinto gare negli ultimi giorni.',
)
assert.equal(procurement.search_strategy, 'organic_web_search')
assert.ok(procurement.required_signals.includes('tender_won'))
assert.ok(procurement.source_plan?.some((lane) => lane.lane === 'public_procurement'))
assert.equal(procurement.source_plan?.find((lane) => lane.lane === 'public_procurement')?.coverage_status, 'supported')
assert.deepEqual(procurement.source_plan?.find((lane) => lane.lane === 'public_procurement')?.adapter_ids, ['public_procurement_v1'])
assert.equal(procurement.source_coverage?.status, 'generic_fallback_partial')

const marketing = buildHeuristicMiraxQueryPlan(
  'Trovami aziende in Lombardia che stanno investendo concretamente in marketing.',
)
assert.equal(marketing.search_strategy, 'organic_web_search')
assert.ok(marketing.required_signals.includes('investing_marketing'))
assert.ok(!marketing.required_signals.includes('hiring'))
assert.ok(!marketing.required_signals.includes('expansion'))
assert.ok(marketing.source_plan?.some((lane) => lane.lane === 'ads'))
assert.equal(marketing.source_coverage?.status, 'generic_fallback_partial')

const hiring = buildHeuristicMiraxQueryPlan(
  'Trovami PMI italiane che stanno assumendo personale operativo.',
)
assert.equal(hiring.search_strategy, 'organic_web_search')
assert.ok(hiring.required_signals.includes('hiring_operational'))
assert.ok(hiring.source_plan?.some((lane) => lane.lane === 'job_market'))
assert.equal(hiring.source_plan?.find((lane) => lane.lane === 'job_market')?.coverage_status, 'supported')
assert.deepEqual(hiring.source_plan?.find((lane) => lane.lane === 'job_market')?.adapter_ids, ['structured_hiring_v1'])
assert.equal(hiring.source_coverage?.status, 'generic_fallback_partial')

console.log('adapter routing three traces: OK')
