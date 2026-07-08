#!/usr/bin/env node
/**
 * Fase 6/7 — PII exposure + audit trail smoke test.
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function assert(cond, msg) {
  if (!cond) {
    console.error('✗', msg)
    process.exit(1)
  }
  console.log('✓', msg)
}

function hasFile(rel) {
  return fs.existsSync(path.join(ROOT, rel))
}

function readFile(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8')
}

assert(hasFile('src/lib/universe/pii.ts'), 'pii.ts module exists')
assert(hasFile('src/app/api/universe/entities/[id]/pii/route.ts'), 'pii API route exists')
assert(hasFile('db/migrations/2026_12_22_pii_access_log.sql'), 'pii_access_log migration exists')

const migration = readFile('db/migrations/2026_12_22_pii_access_log.sql')
assert(migration.includes('CREATE TABLE IF NOT EXISTS public.universe_pii_access_log'), 'migration creates universe_pii_access_log')
assert(migration.includes('ENABLE ROW LEVEL SECURITY'), 'pii access log RLS enabled')

const applyScript = readFile('scripts/apply-mirax-migrations.mjs')
assert(applyScript.includes('2026_12_22_pii_access_log.sql'), 'apply-mirax-migrations includes pii migration')

const agentic = readFile('src/lib/universe/agentic-search.ts')
assert(!agentic.includes("'phone', 'email', 'pec_email', 'mobile_phone'"), 'phone/email no longer suppressed from lead rows')
assert(agentic.includes('pec_email: null'), 'pec_email placeholder in lead row')

console.log('\n[test-universe-pii] OK')
