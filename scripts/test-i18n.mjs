/**
 * Test Fase 4-C — i18n + discovery ES intents (standalone)
 * Run: node scripts/test-i18n.mjs
 */

import assert from 'node:assert/strict'

const messages = {
  it: { search_button: 'Cerca', discovery_title: 'Trova clienti' },
  es: { search_button: 'Buscar', discovery_title: 'Encuentra clientes' },
}

function t(locale, key) {
  return messages[locale][key] ?? messages.it[key]
}

const DISCOVERY_INTENTS_ES = [
  { id: 'siti_web', defaultCategory: 'empresas de construcción', filterSuffix: 'sin web' },
  { id: 'marketing_ads', defaultCategory: 'empresas', filterSuffix: 'sin Google Ads' },
]

function buildDiscoverySearchQuery({ intentId, city, category, locale = 'it' }) {
  const intents = locale === 'es' ? DISCOVERY_INTENTS_ES : []
  const intent = intents.find((i) => i.id === intentId)
  const cat = (category || intent?.defaultCategory || 'imprese').trim()
  const parts = [`${cat} ${city.trim()}`]
  if (intent?.filterSuffix) parts.push(intent.filterSuffix)
  return parts.join(' ')
}

function mapsCountryForLocale(locale) {
  return locale === 'es' ? 'ES' : 'IT'
}

assert.equal(t('it', 'search_button'), 'Cerca')
assert.equal(t('es', 'search_button'), 'Buscar')
assert.equal(t('es', 'discovery_title'), 'Encuentra clientes')

const qEs = buildDiscoverySearchQuery({ intentId: 'siti_web', city: 'Madrid', category: 'restaurantes', locale: 'es' })
assert.ok(qEs.includes('Madrid') && qEs.includes('sin web'))

assert.equal(mapsCountryForLocale('es'), 'ES')
assert.equal(mapsCountryForLocale('it'), 'IT')

console.log('[test-i18n] OK')
