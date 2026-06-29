#!/usr/bin/env node
/**
 * Test query builder + agentic intent mapping (no DB).
 * Run: node --experimental-strip-types scripts/test-universe-query-builder.mjs
 */
import assert from 'node:assert/strict'
import { signalIntentToUniverseQuery } from '../src/lib/universe/agentic-search.ts'
import { buildHiringMilanoQuery, buildNoPixelRomaQuery } from '../src/lib/universe/query-builder.ts'

const noPixel = buildNoPixelRomaQuery()
assert.equal(noPixel.entity_type, 'company')
assert.equal(noPixel.filters?.city, 'Roma')
assert.equal(noPixel.filters?.observations?.[0]?.attribute, 'meta_pixel')
assert.equal(noPixel.filters?.observations?.[0]?.value, false)
console.log('✓ buildNoPixelRomaQuery')

const hiring = buildHiringMilanoQuery('programmatore')
assert.equal(hiring.filters?.city, 'Milano')
assert.equal(hiring.relationships?.[0]?.relationship_type, 'hires')
console.log('✓ buildHiringMilanoQuery')

const intentMapped = signalIntentToUniverseQuery({
  required_signals: ['hiring'],
  hiring_roles: ['python'],
  sector_keywords: [],
  crm_keywords: [],
  require_crm_change: false,
  time_window_days: null,
  intent_summary: 'Assunzioni Python Milano',
  location: 'Milano',
  category: 'Software House',
  technical_filters: { has_meta_pixel: false },
  parse_source: 'heuristic',
})
assert.equal(intentMapped.query.filters?.city, 'Milano')
assert.ok(intentMapped.query.filters?.observations?.some((o) => o.attribute === 'meta_pixel'))
assert.equal(intentMapped.query.relationships?.[0]?.relationship_type, 'hires')
console.log('✓ signalIntentToUniverseQuery')

console.log('\n[test-universe-query-builder] OK')
