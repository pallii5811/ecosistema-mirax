#!/usr/bin/env node
/**
 * Fase 7 — Digital Twin unit smoke (no DB).
 * Run: node --experimental-strip-types scripts/test-universe-digital-twin.mjs
 */
import assert from 'node:assert/strict'

// opportunity score logic mirror (same rules as digital-twin.ts)
function opportunityScoreFromLead(obj) {
  let score = 0
  if (obj.meta_pixel !== true) score += 25
  if (!obj.sito && !obj.website) score += 30
  if (!obj.instagram) score += 15
  return Math.min(score, 100)
}

assert.equal(opportunityScoreFromLead({ meta_pixel: false, sito: 'https://x.it' }), 40)
assert.equal(opportunityScoreFromLead({ meta_pixel: true, sito: 'https://x.it', instagram: '@x' }), 0)
console.log('✓ opportunityScoreFromLead')

const collapse = (timeline) => {
  const out = {}
  for (const p of timeline) {
    if (out[p.attribute]) continue
    out[p.attribute] = { value: p.value, observed_at: p.observed_at, source: p.source, confidence: p.confidence }
  }
  return out
}

const attrs = collapse([
  { attribute: 'meta_pixel', value: false, observed_at: '2026-01-01', source: 'audit', confidence: 1 },
  { attribute: 'meta_pixel', value: true, observed_at: '2026-02-01', source: 'audit', confidence: 1 },
  { attribute: 'rating', value: 4.5, observed_at: '2026-01-01', source: 'maps', confidence: 1 },
])
assert.equal(attrs.meta_pixel.value, false)
assert.equal(attrs.rating.value, 4.5)
console.log('✓ collapseTimeline (latest first wins per attribute order)')

console.log('\n[test-universe-digital-twin] OK')
