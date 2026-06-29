#!/usr/bin/env node
/**
 * Fase 9 — cache + alerting + scale wiring.
 */
import fs from 'node:fs'
import assert from 'node:assert/strict'

const files = [
  'db/migrations/2026_07_04_universe_scale.sql',
  'src/lib/universe/query-cache.ts',
  'src/lib/universe/analytics-cache.ts',
  'src/lib/universe/alerting.ts',
  'src/app/api/universe/alerts/route.ts',
  'src/components/universe/UniverseAlertsPanel.tsx',
]

for (const f of files) {
  assert.ok(fs.existsSync(f), `mancante: ${f}`)
  console.log(`✓ ${f}`)
}

const migration = fs.readFileSync('db/migrations/2026_07_04_universe_scale.sql', 'utf8')
assert.ok(migration.includes('universe_query_cache'), 'migration senza cache table')
assert.ok(migration.includes('universe_purge_query_cache'), 'migration senza purge fn')
console.log('✓ migration')

const consumer = fs.readFileSync('src/lib/universe/event-consumer.ts', 'utf8')
assert.ok(consumer.includes('dispatchUniverseEventAlerts'), 'consumer senza alerting')
assert.ok(consumer.includes('purgeExpiredQueryCache'), 'consumer senza cache purge')
console.log('✓ event consumer')

const analyticsRoute = fs.readFileSync('src/app/api/universe/analytics/route.ts', 'utf8')
assert.ok(analyticsRoute.includes('getUniverseAnalyticsCached'), 'analytics senza cache')
assert.ok(analyticsRoute.includes('cache_hit'), 'analytics senza cache_hit')
console.log('✓ analytics API')

const agenticRoute = fs.readFileSync('src/app/api/universe/agentic-search/route.ts', 'utf8')
assert.ok(agenticRoute.includes('cache_hit'), 'agentic-search senza cache')
console.log('✓ agentic API')

const page = fs.readFileSync('src/app/dashboard/universe/page.tsx', 'utf8')
assert.ok(page.includes('UniverseAlertsPanel'), 'page senza alerts panel')
console.log('✓ universe page')

const apply = fs.readFileSync('scripts/apply-mirax-migrations.mjs', 'utf8')
assert.ok(apply.includes('2026_07_04_universe_scale.sql'), 'apply-migrations senza fase 9')
console.log('✓ apply migrations')

console.log('\n[test-universe-phase9] OK')
