#!/usr/bin/env node
/**
 * Fase 5 — unit test agentic-ui formatters (no DB).
 * Run: node --experimental-strip-types scripts/test-universe-agentic-logic.mjs
 */
import assert from 'node:assert/strict'
import {
  collectIntentChips,
  formatTechnicalFilterChip,
  buildUniverseQueryPlan,
  buildGraphRankEvidence,
  readGraphRankFactors,
  labelParseSource,
  labelSignalRequirement,
  readLeadString,
  agenticResultsToCsv,
} from '../src/lib/universe/agentic-ui.ts'
import { buildNoPixelRomaQuery } from '../src/lib/universe/query-builder.ts'

assert.equal(labelParseSource('heuristic'), 'Interpretazione rapida')
assert.equal(labelParseSource('unknown_xyz'), 'unknown_xyz')
console.log('✓ labelParseSource')

assert.equal(labelSignalRequirement('hiring'), 'In assunzione')
console.log('✓ labelSignalRequirement')

assert.equal(formatTechnicalFilterChip('has_meta_pixel', false), 'Senza Meta Pixel')
assert.equal(formatTechnicalFilterChip('has_meta_pixel', true), 'Con Meta Pixel')
assert.equal(formatTechnicalFilterChip('site_speed', 'slow'), 'Sito lento')
assert.equal(formatTechnicalFilterChip('unknown', 'x'), 'unknown: x')
console.log('✓ formatTechnicalFilterChip')

const chips = collectIntentChips({
  category: 'Edilizia',
  location: 'Roma',
  required_signals: ['hiring'],
  hiring_roles: ['muratore'],
  sector_keywords: [],
  crm_keywords: [],
  require_crm_change: false,
  time_window_days: null,
  intent_summary: 'test',
  technical_filters: { has_meta_pixel: false },
  business_filters: { revenue_min: 1_000_000 },
  parse_source: 'heuristic',
})
assert.ok(chips.includes('Edilizia'))
assert.ok(chips.includes('Roma'))
assert.ok(chips.some((c) => c.includes('Meta Pixel')))
assert.ok(chips.some((c) => c.includes('Fatturato')))
console.log('✓ collectIntentChips')

const plan = buildUniverseQueryPlan(buildNoPixelRomaQuery())
assert.ok(plan.length >= 2)
assert.ok(plan.some((s) => s.icon === 'observation'))
assert.ok(plan.some((s) => s.icon === 'limit'))
console.log('✓ buildUniverseQueryPlan')

assert.equal(readLeadString({ azienda: ' Acme ' }, ['azienda', 'nome']), 'Acme')
assert.equal(readLeadString({}, ['azienda']), '')
console.log('✓ readLeadString')

const csv = agenticResultsToCsv([
  { azienda: 'Test "Co"', citta: 'Roma', entity_id: 'abc-123', _score: 42 },
])
assert.ok(csv.startsWith('\uFEFF'))
assert.ok(csv.includes('"Test ""Co"""'))
assert.ok(csv.includes('abc-123'))
console.log('✓ agenticResultsToCsv')

const evidence = buildGraphRankEvidence({
  freshness: 12,
  intent_location: 10,
  intent_category: 8,
  recent_events: 3,
  relationships: 1,
  observations: 5,
  confidence: 4,
})
assert.ok(evidence.some((e) => e.includes('7 giorni')), 'evidence freshness')
assert.ok(evidence.some((e) => e.includes('Località')), 'evidence location')
assert.ok(evidence.some((e) => e.includes('Settore')), 'evidence category')
assert.ok(evidence.some((e) => e.includes('3 eventi recenti')), 'evidence events plural')
assert.ok(evidence.some((e) => e.includes('1 relazione') && !e.includes('relazioni')), 'evidence rel singular')
assert.ok(evidence.some((e) => e.includes('Affidabilità')), 'evidence confidence')
assert.deepEqual(buildGraphRankEvidence(null), [], 'evidence null safe')
assert.deepEqual(buildGraphRankEvidence({}), [], 'evidence empty')
console.log('✓ buildGraphRankEvidence')

assert.equal(readGraphRankFactors({ graph_rank_factors: { freshness: 5 } })?.freshness, 5)
assert.equal(readGraphRankFactors({}), null)
console.log('✓ readGraphRankFactors')

console.log('\n[test-universe-agentic-logic] OK')
