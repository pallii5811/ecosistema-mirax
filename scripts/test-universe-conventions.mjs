#!/usr/bin/env node
/**
 * Verifica convenzioni Universe (moduli, naming, API routes).
 * Run: node scripts/test-universe-conventions.mjs
 */
import fs from 'node:fs'
import assert from 'node:assert/strict'

const TS_MODULES = [
  'src/lib/universe/types.ts',
  'src/lib/universe/canonical.ts',
  'src/lib/universe/errors.ts',
  'src/lib/universe/entity-repository.ts',
  'src/lib/universe/observation-repository.ts',
  'src/lib/universe/relationship-repository.ts',
  'src/lib/universe/event-repository.ts',
  'src/lib/universe/ingest-lead.ts',
  'src/lib/universe/ingest-clay.ts',
  'src/lib/universe/query-builder.ts',
  'src/lib/universe/agentic-search.ts',
  'src/lib/universe/hydrate-leads.ts',
  'src/lib/universe/digital-twin.ts',
  'src/lib/universe/user-context-repository.ts',
  'src/lib/universe/analytics.ts',
  'src/lib/universe/event-consumer.ts',
  'src/lib/universe/query-cache.ts',
  'src/lib/universe/analytics-cache.ts',
  'src/lib/universe/alerting.ts',
  'src/lib/universe/graph-ranking.ts',
  'src/lib/universe/webhooks.ts',
  'src/lib/universe/event-archive.ts',
  'src/lib/universe/require-auth.ts',
  'src/lib/universe/feedback.ts',
  'src/lib/universe/quality.ts',
  'src/lib/universe/pii.ts',
  'src/lib/universe/index.ts',
]

for (const f of TS_MODULES) {
  assert.ok(fs.existsSync(f), `Manca modulo TS: ${f}`)
  console.log(`✓ ${f}`)
}

const PY_MODULES = [
  'backend_mirror/universe/__init__.py',
  'backend_mirror/universe/models.py',
  'backend_mirror/universe/canonical.py',
  'backend_mirror/universe/repository.py',
  'backend_mirror/universe/ingest.py',
]

for (const f of PY_MODULES) {
  assert.ok(fs.existsSync(f), `Manca modulo Python: ${f}`)
  console.log(`✓ ${f}`)
}

const API_ROUTES = [
  'src/app/api/universe/entities/search/route.ts',
  'src/app/api/universe/entities/[id]/route.ts',
  'src/app/api/universe/entities/[id]/related/route.ts',
  'src/app/api/universe/query/route.ts',
  'src/app/api/universe/timeline/[id]/route.ts',
  'src/app/api/universe/agentic-search/route.ts',
  'src/app/api/universe/hydrate-leads/route.ts',
  'src/app/api/universe/stats/route.ts',
  'src/app/api/universe/entities/[id]/twin/route.ts',
  'src/app/api/universe/entities/[id]/context/route.ts',
  'src/app/api/universe/analytics/route.ts',
  'src/app/api/universe/events/recent/route.ts',
  'src/app/api/cron/universe-reconcile/route.ts',
  'src/app/api/cron/universe-process-events/route.ts',
  'src/app/api/universe/alerts/route.ts',
  'src/app/api/universe/webhooks/deliveries/route.ts',
  'src/app/api/universe/feedback/route.ts',
  'src/app/api/universe/quality/route.ts',
  'src/app/api/universe/entities/[id]/pii/route.ts',
]

for (const f of API_ROUTES) {
  assert.ok(fs.existsSync(f), `Manca API route: ${f}`)
  const content = fs.readFileSync(f, 'utf8')
  if (f.includes('/cron/')) {
    assert.ok(content.includes('verifyCronBearer'), `${f} deve usare verifyCronBearer`)
  } else {
    assert.ok(
      content.includes('requireUniverseAuth'),
      `${f} deve richiedere auth`,
    )
  }
  console.log(`✓ ${f}`)
}

assert.ok(fs.existsSync('db/migrations/2026_07_02_universe_entities.sql'), 'Manca migration Universe')
assert.ok(fs.existsSync('docs/UNIVERSE_DATA_MODEL.md'), 'Manca UNIVERSE_DATA_MODEL.md')

const applyMirax = fs.readFileSync('scripts/apply-mirax-migrations.mjs', 'utf8')
assert.ok(applyMirax.includes('2026_07_02_universe_entities.sql'), 'Migration non in apply-mirax-migrations')

console.log('\n[test-universe-conventions] OK')
