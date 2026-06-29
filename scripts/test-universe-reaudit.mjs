#!/usr/bin/env node
/**
 * Phase 3 — verifica reaudit Universe sidecar (entity_id collegato).
 * Run: node scripts/test-universe-reaudit.mjs
 */
import fs from 'node:fs'
import assert from 'node:assert/strict'

const reaudit = fs.readFileSync('src/app/api/cron/reaudit/route.ts', 'utf8')
assert.ok(reaudit.includes('ingestMiraxLead'), 'reaudit deve chiamare ingestMiraxLead')
assert.ok(reaudit.includes('ingestResult.entity_id'), 'reaudit deve usare entity_id da ingest')
assert.ok(reaudit.includes("event_type: 'website_changed'"), 'reaudit deve emettere website_changed')
assert.ok(!reaudit.includes('entity_id: undefined'), 'reaudit non deve lasciare entity_id undefined')
console.log('✓ reaudit universe sidecar wired')

console.log('\n[test-universe-reaudit] OK')
