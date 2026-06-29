#!/usr/bin/env node
/**
 * Fase 6 — wiring read sidecar (hydrate, stats, ResultsTable badge).
 */
import fs from 'node:fs'
import assert from 'node:assert/strict'

const files = [
  'src/lib/universe/hydrate-leads.ts',
  'src/app/api/universe/hydrate-leads/route.ts',
  'src/app/api/universe/stats/route.ts',
  'src/components/universe/UniverseHydratedBadge.tsx',
  'src/components/universe/UniverseGraphStats.tsx',
]

for (const f of files) {
  assert.ok(fs.existsSync(f), `mancante: ${f}`)
  console.log(`✓ ${f}`)
}

const index = fs.readFileSync('src/lib/universe/index.ts', 'utf8')
assert.ok(index.includes('hydrateLeadFromUniverse'), 'index.ts deve esportare hydrate')
assert.ok(index.includes('isUniverseReadEnabled'), 'index.ts deve esportare isUniverseReadEnabled')
console.log('✓ index exports')

const checkJob = fs.readFileSync('src/app/api/check-scrape-job/route.ts', 'utf8')
assert.ok(checkJob.includes('hydrateLeadsFromUniverse'), 'check-scrape-job deve chiamare hydrate')
assert.ok(checkJob.includes('isUniverseReadEnabled'), 'check-scrape-job deve rispettare flag read')
console.log('✓ check-scrape-job hydrate')

const results = fs.readFileSync('src/components/ResultsTable.tsx', 'utf8')
assert.ok(results.includes('UniverseHydratedBadge'), 'ResultsTable senza badge grafo')
console.log('✓ ResultsTable badge')

const env = fs.readFileSync('.env.staging.example', 'utf8')
assert.ok(env.includes('UNIVERSE_READ_ENABLED'), '.env.staging.example senza UNIVERSE_READ_ENABLED')
console.log('✓ env docs')

const sidecar = fs.readFileSync('backend_mirror/universe/sidecar.py', 'utf8')
assert.ok(
  sidecar.includes('universe_entity_id'),
  'sidecar.py deve stampare universe_entity_id sul lead',
)
console.log('✓ sidecar stamp entity_id')

console.log('\n[test-universe-phase6] OK')
