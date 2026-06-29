#!/usr/bin/env node
/**
 * Smoke test: verifica che i punti di integrazione Universe esistano
 * nel worker Python e nelle API routes (no DB).
 * Run: node scripts/test-universe-integration.mjs
 */
import fs from 'node:fs'
import assert from 'node:assert/strict'

const worker = fs.readFileSync('backend_mirror/worker_supabase.py', 'utf8')
assert.ok(worker.includes('UNIVERSE_ENABLED') || worker.includes('universe.sidecar'), 'worker non contiene Universe sidecar')
assert.ok(worker.includes('ingest_leads_batch'), 'worker non chiama ingest_leads_batch')
console.log('✓ worker integration wired')

const enrichRoute = fs.readFileSync('src/app/api/enrich-lead/route.ts', 'utf8')
assert.ok(enrichRoute.includes('ingestClayEnrichedLead'), 'enrich-lead non importa ingestClayEnrichedLead')
assert.ok(enrichRoute.includes('UNIVERSE_ENABLED'), 'enrich-lead non contiene UNIVERSE_ENABLED')
console.log('✓ enrich-lead integration wired')

const pipelineRoute = fs.readFileSync('src/app/api/pipeline/route.ts', 'utf8')
assert.ok(pipelineRoute.includes('@/lib/universe'), 'pipeline non importa Universe')
assert.ok(pipelineRoute.includes('universe_user_context'), 'pipeline non scrive universe_user_context')
console.log('✓ pipeline integration wired')

const reauditRoute = fs.readFileSync('src/app/api/cron/reaudit/route.ts', 'utf8')
assert.ok(reauditRoute.includes('ingestMiraxLead'), 'reaudit non importa ingestMiraxLead')
assert.ok(reauditRoute.includes("event_type: 'website_changed'"), 'reaudit non emette website_changed')
console.log('✓ reaudit integration wired')

const websiteChangeRoute = fs.readFileSync('src/app/api/cron/website-change-detect/route.ts', 'utf8')
assert.ok(websiteChangeRoute.includes('appendEvent'), 'website-change-detect non importa appendEvent')
assert.ok(websiteChangeRoute.includes("event_type: 'website_changed'"), 'website-change-detect non emette evento Universe')
console.log('✓ website-change-detect integration wired')

const agenticRoute = fs.readFileSync('src/app/api/universe/agentic-search/route.ts', 'utf8')
assert.ok(agenticRoute.includes('executeAgenticUniverseSearch'), 'agentic-search route mancante')
console.log('✓ agentic-search route wired')

const reconcileRoute = fs.readFileSync('src/app/api/cron/universe-reconcile/route.ts', 'utf8')
assert.ok(reconcileRoute.includes('universe-reconcile') || reconcileRoute.includes('drift_pct'), 'reconcile cron mancante')
console.log('✓ universe-reconcile cron wired')

const bizRoute = fs.readFileSync('src/app/api/lead/business-events/route.ts', 'utf8')
assert.ok(bizRoute.includes('ingestMiraxLeadSidecarAsync'), 'business-events sidecar mancante')
console.log('✓ business-events sidecar wired')

const sidecarTs = fs.readFileSync('src/lib/universe/sidecar.ts', 'utf8')
assert.ok(sidecarTs.includes('isUniverseEnabled'), 'sidecar.ts mancante')
console.log('✓ universe/sidecar.ts presente')

console.log('\n[test-universe-integration] OK')
