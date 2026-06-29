#!/usr/bin/env node
/**
 * Smoke test API Universe — file wiring (no HTTP).
 */
import fs from 'node:fs'
import assert from 'node:assert/strict'

const routes = {
  resolve: 'src/app/api/universe/entities/resolve/route.ts',
  search: 'src/app/api/universe/entities/search/route.ts',
  detail: 'src/app/api/universe/entities/[id]/route.ts',
  related: 'src/app/api/universe/entities/[id]/related/route.ts',
  query: 'src/app/api/universe/query/route.ts',
  timeline: 'src/app/api/universe/timeline/[id]/route.ts',
  agentic: 'src/app/api/universe/agentic-search/route.ts',
  reconcile: 'src/app/api/cron/universe-reconcile/route.ts',
}

for (const [name, path] of Object.entries(routes)) {
  const content = fs.readFileSync(path, 'utf8')
  assert.ok(content.length > 50, `${name} route vuota`)
  if (name === 'reconcile') {
    assert.ok(content.includes('getEntityByCanonicalId'), 'reconcile deve confrontare entità')
    assert.ok(content.includes('ingestMiraxLead'), 'reconcile deve supportare backfill')
  } else if (name === 'agentic') {
    assert.ok(content.includes('parseSignalIntent'), 'agentic deve parsare intent')
    assert.ok(content.includes('executeAgenticUniverseSearch'), 'agentic deve eseguire query')
    assert.ok(content.includes('signal_intent'), 'agentic deve restituire signal_intent')
  } else if (name === 'timeline') {
    assert.ok(content.includes('getTimeline'), 'timeline deve usare getTimeline')
  } else if (name === 'resolve') {
    assert.ok(content.includes('normalizeDomain'), 'resolve deve normalizzare dominio')
    assert.ok(content.includes('getEntityByCanonicalId'), 'resolve deve cercare per canonical_id')
  } else {
    assert.ok(content.includes('createServiceRoleClient'), `${name} usa service role`)
  }
  console.log(`✓ ${name}`)
}

console.log('\n[test-universe-api] OK')
