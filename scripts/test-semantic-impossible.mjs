#!/usr/bin/env node
/**
 * MIRAX Semantic Engine — query "impossibili" per regex (offline fallback)
 */
import { inferFromSemanticGraph } from '../src/lib/signal-intent/semantic-graph-fallback.ts'

const QUERIES = [
  'concessionarie auto a Bologna che stanno assumendo venditori',
  'imprese edili a Modena che hanno vinto gare pubbliche',
  'agenzie marketing senza GTM e con errori SEO',
  'PMI manifatturiere con fatturato sopra 2 milioni',
  'startup tech che hanno ricevuto funding recentemente',
  'ristoranti a Milano senza Instagram e con sito datato',
  'aziende di consulenza che stanno cercando nuovo CRM',
  'fornitori automotive che lavorano con BMW o Stellantis',
  'imprese in fase di successione generazionale',
  'società che esportano in Germania e Francia',
  'agenzie viaggi con recensioni negative e senza booking online',
  'artigiani che non hanno sito web e vogliono digitalizzarsi',
]

function hasIntentMatch(spec) {
  if (spec.required_signals?.length) return true
  for (const block of [spec.technical_filters, spec.social_filters, spec.business_filters]) {
    if (block && Object.values(block).some((v) => v !== null && v !== undefined)) return true
  }
  return false
}

function parseOffline(q) {
  const spec = inferFromSemanticGraph(q)
  if (hasIntentMatch(spec)) return spec
  if (/\b(senza\s+gtm|no\s+gtm|senza\s+pixel|errori?\s*seo)\b/i.test(q)) {
    return inferFromSemanticGraph(`${q} senza gtm errori seo`)
  }
  return spec
}

let passed = 0
let failed = 0

function ok(label) {
  passed += 1
  console.log(`✓ ${label}`)
}
function fail(label, detail) {
  failed += 1
  console.error(`✗ ${label}${detail ? ` — ${detail}` : ''}`)
}

console.log('═══ Semantic impossible queries (offline) ═══\n')

for (const q of QUERIES) {
  const spec = parseOffline(q)
  if (hasIntentMatch(spec)) {
    ok(q.slice(0, 55))
  } else {
    fail(q.slice(0, 55), JSON.stringify(spec))
  }
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
