import assert from 'node:assert/strict'
import { buildHeuristicMiraxQueryPlan } from '../src/lib/uqe/mirax-query-planner'
import { sourceRuntimeCoverage } from '../src/lib/source-intelligence/registry'

const plan = buildHeuristicMiraxQueryPlan(
  'Trovami concessionari auto a Torino senza DMARC e senza Instagram.',
)

assert.equal(plan.search_strategy, 'maps')
assert.equal(plan.location, 'Torino')
assert.ok(plan.required_signals.includes('no_dmarc'))
assert.ok(plan.required_signals.includes('missing_instagram'))
const technology = plan.source_plan?.find((lane) => lane.lane === 'technology')
assert.equal(technology?.coverage_status, 'supported')
assert.equal(technology?.execution_mode, 'adapter')
assert.deepEqual(technology?.adapter_ids, ['legacy_digital_audit_v1'])
assert.equal(sourceRuntimeCoverage('technology_audit'), 'supported')
assert.equal(sourceRuntimeCoverage('google_business_maps'), 'supported')

const replayCases = [
  ['Trovami imprese di pulizia a Genova senza GTM e Pixel.', ['no_gtm', 'no_pixel']],
  ['Trovami agenzie stampa con errori SEO e senza Google Ads a Milano.', ['seo_errors', 'missing_google_ads']],
] as const
for (const [query, signals] of replayCases) {
  const replay = buildHeuristicMiraxQueryPlan(query)
  assert.equal(replay.search_strategy, 'maps', query)
  for (const signal of signals) assert.ok(replay.required_signals.includes(signal), `${query}: ${signal}`)
  assert.equal(replay.source_plan?.find((lane) => lane.lane === 'technology')?.coverage_status, 'supported')
}

const categoryOnly = buildHeuristicMiraxQueryPlan('Trovami imprese di pulizia a Genova.')
assert.equal(categoryOnly.search_strategy, 'maps')
assert.ok(categoryOnly.source_plan?.some((lane) => lane.coverage_status === 'supported'))

const exact = buildHeuristicMiraxQueryPlan(
  'Trova imprese di pulizia a Milano con sito ufficiale, criticità SEO e assenza di strumenti di tracciamento pubblicitario.',
)
assert.equal(exact.sector, 'imprese di pulizia')
assert.equal(exact.location, 'Milano')
assert.equal(exact.search_strategy, 'maps')
assert.ok(exact.required_signals.includes('site_stale'))
assert.ok(exact.required_signals.includes('no_pixel'))
assert.ok(exact.required_signals.includes('no_gtm'))
assert.equal(exact.source_plan?.find((lane) => lane.lane === 'technology')?.coverage_status, 'supported')
assert.ok(exact.source_plan?.find((lane) => lane.lane === 'technology')?.adapter_ids?.includes('legacy_digital_audit_v1'))

console.log('digital audit adapter routing: OK')
