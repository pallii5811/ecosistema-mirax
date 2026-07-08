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
    assert.ok(content.includes('SUPABASE_SERVICE_ROLE_KEY'), 'reconcile usa service role')
  } else if (name === 'agentic') {
    assert.ok(content.includes('parseSignalIntent'), 'agentic deve parsare intent')
    assert.ok(content.includes('executeAgenticUniverseSearch'), 'agentic deve eseguire query')
    assert.ok(content.includes('signal_intent'), 'agentic deve restituire signal_intent')
    assert.ok(content.includes('createClient'), 'agentic deve usare client autenticato per la ricerca')
  } else if (name === 'timeline') {
    assert.ok(content.includes('getTimeline'), 'timeline deve usare getTimeline')
    assert.ok(content.includes('createClient'), 'timeline deve usare client autenticato')
  } else if (name === 'resolve') {
    assert.ok(content.includes('normalizeDomain'), 'resolve deve normalizzare dominio')
    assert.ok(content.includes('getEntityByCanonicalId'), 'resolve deve cercare per canonical_id')
    assert.ok(content.includes('createClient'), 'resolve deve usare client autenticato')
  } else {
    assert.ok(content.includes('createClient'), `${name} deve usare client autenticato`)
  }
  console.log(`✓ ${name}`)
}

console.log('\n[test-universe-api] OK')
