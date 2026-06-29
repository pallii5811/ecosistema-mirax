#!/usr/bin/env node
/**
 * Phase 3 — verifica wiring worker + business_events + sidecar Python.
 * Run: node scripts/test-universe-worker-integration.mjs
 */
import fs from 'node:fs'
import assert from 'node:assert/strict'

const worker = fs.readFileSync('backend_mirror/worker_supabase.py', 'utf8')
assert.ok(worker.includes('from universe.sidecar import ingest_leads_batch'), 'worker deve usare universe.sidecar')
assert.ok(worker.includes('source="maps_scrape"'), 'worker deve ingest maps_scrape')
assert.ok(worker.includes('source="business_events_external"'), 'worker deve re-ingest post-external')
assert.ok(worker.includes('universe re-ingest post-external'), 'worker deve loggare re-ingest post-external')
console.log('✓ worker sidecar wired')

const sidecar = fs.readFileSync('backend_mirror/universe/sidecar.py', 'utf8')
assert.ok(sidecar.includes('def is_universe_enabled'), 'sidecar.py manca is_universe_enabled')
assert.ok(sidecar.includes('def ingest_leads_batch'), 'sidecar.py manca ingest_leads_batch')
console.log('✓ universe/sidecar.py presente')

const biz = fs.readFileSync('backend_mirror/business_events_enrich.py', 'utf8')
assert.ok(!biz.includes('universe.sidecar'), 'business_events non deve duplicare ingest worker (worker owns job flow)')
console.log('✓ business_events_enrich no duplicate sidecar')

const bizRoute = fs.readFileSync('src/app/api/lead/business-events/route.ts', 'utf8')
assert.ok(bizRoute.includes('ingestMiraxLeadSidecarAsync'), 'business-events API deve chiamare sidecar')
assert.ok(bizRoute.includes('business_events_api'), 'business-events API source tag')
console.log('✓ business-events API sidecar wired')

console.log('\n[test-universe-worker-integration] OK')
