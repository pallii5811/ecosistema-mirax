#!/usr/bin/env node
/**
 * Fase 10 — graph ranking unit tests (no DB).
 * Run: node --experimental-strip-types scripts/test-universe-graph-ranking.mjs
 */
import assert from 'node:assert/strict'
import {
  computeGraphRankScore,
  buildGraphRankFactors,
} from '../src/lib/universe/graph-ranking.ts'

const base = buildGraphRankFactors(
  {
    id: 'e1',
    canonical_id: 'acme.it',
    entity_type: 'company',
    name: 'Acme Software',
    city: 'Milano',
    last_seen_at: new Date().toISOString(),
    confidence: 0.9,
  },
  {
    required_signals: [],
    hiring_roles: [],
    sector_keywords: [],
    crm_keywords: [],
    require_crm_change: false,
    time_window_days: null,
    intent_summary: 'test',
    location: 'Milano',
    category: 'Software',
    parse_source: 'heuristic',
  },
  { recent_events: 2, relationships: 3, observations: 8 },
)

const high = computeGraphRankScore(base)
assert.ok(high >= 70, `expected high score, got ${high}`)
console.log('✓ high relevance score')

const low = computeGraphRankScore({
  freshness: 0,
  intent_location: 0,
  intent_category: 0,
  recent_events: 0,
  relationships: 0,
  observations: 0,
  confidence: 0,
})
assert.ok(low <= 40, `expected low score, got ${low}`)
console.log('✓ low relevance score')

console.log('\n[test-universe-graph-ranking] OK')
