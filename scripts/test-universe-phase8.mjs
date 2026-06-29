#!/usr/bin/env node
/**
 * Fase 8 — wiring realtime + analytics + cron consumer.
 */
import fs from 'node:fs'
import assert from 'node:assert/strict'

const files = [
  'db/migrations/2026_07_03_universe_realtime_analytics.sql',
  'src/lib/realtime/universe-event-stream.ts',
  'src/lib/universe/analytics.ts',
  'src/lib/universe/event-consumer.ts',
  'src/app/api/universe/analytics/route.ts',
  'src/app/api/universe/events/recent/route.ts',
  'src/app/api/cron/universe-process-events/route.ts',
  'src/components/universe/UniverseAnalyticsPanel.tsx',
  'src/components/universe/UniverseLiveEventsFeed.tsx',
]

for (const f of files) {
  assert.ok(fs.existsSync(f), `mancante: ${f}`)
  console.log(`✓ ${f}`)
}

const migration = fs.readFileSync('db/migrations/2026_07_03_universe_realtime_analytics.sql', 'utf8')
assert.ok(migration.includes('universe_analytics_summary'), 'migration senza RPC analytics')
assert.ok(migration.includes('supabase_realtime'), 'migration senza realtime publication')
console.log('✓ migration')

const page = fs.readFileSync('src/app/dashboard/universe/page.tsx', 'utf8')
assert.ok(page.includes('UniverseAnalyticsPanel'), 'page senza analytics')
assert.ok(page.includes('UniverseLiveEventsFeed'), 'page senza live feed')
assert.ok(page.includes('analytics'), 'page senza tab analytics')
console.log('✓ universe page')

const vercel = fs.readFileSync('vercel.json', 'utf8')
assert.ok(vercel.includes('universe-process-events'), 'vercel.json senza cron process-events')
console.log('✓ vercel cron')

const apply = fs.readFileSync('scripts/apply-mirax-migrations.mjs', 'utf8')
assert.ok(apply.includes('2026_07_03_universe_realtime_analytics.sql'), 'apply-migrations senza fase 8')
console.log('✓ apply migrations')

console.log('\n[test-universe-phase8] OK')
