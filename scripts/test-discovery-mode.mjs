/**
 * Test Fase 2 — discovery intent + copy (standalone)
 * Run: node scripts/test-discovery-mode.mjs
 */

import assert from 'node:assert/strict'

const DISCOVERY_INTENTS = [
  { id: 'siti_web', defaultCategory: 'imprese edili', filterSuffix: 'senza sito' },
  { id: 'marketing_ads', defaultCategory: 'aziende', filterSuffix: 'senza Google Ads' },
  { id: 'seo', defaultCategory: 'imprese', filterSuffix: 'errori SEO' },
]

function buildDiscoverySearchQuery({ intentId, city, category }) {
  const intent = DISCOVERY_INTENTS.find((i) => i.id === intentId)
  const cat = (category || intent?.defaultCategory || 'imprese').trim()
  const parts = [`${cat} ${city.trim()}`]
  if (intent?.filterSuffix) parts.push(intent.filterSuffix)
  return parts.join(' ')
}

function humanize(title) {
  return title.replace(/missing\s*gtm/gi, 'Non misura da dove arrivano i clienti')
}

function detectIntentMarketingSpend(lead) {
  let score = 0
  if (lead.google_ads) score += 30
  if (lead.meta_pixel) score += 15
  if (lead.freshness_score >= 70) score += 25
  return score >= 30 ? { id: 'intent_marketing_spend', evidence: [{ source: 'test' }] } : null
}

const q1 = buildDiscoverySearchQuery({ intentId: 'siti_web', city: 'Milano', category: 'ristoranti' })
assert.ok(q1.includes('Milano') && q1.includes('senza sito'))

const human = humanize('MISSING GTM on site')
assert.ok(!human.includes('MISSING'))

const intent = detectIntentMarketingSpend({ google_ads: true, meta_pixel: true, freshness_score: 85 })
assert.ok(intent !== null)

console.log('[test-discovery-mode] OK')
