#!/usr/bin/env node
/**
 * Integration test: ingest a MIRAX lead into Universe.
 * Requires Supabase dev credentials.
 * Run: node scripts/test-universe-ingest.mjs
 */
import fs from 'node:fs'
import assert from 'node:assert/strict'
import { createClient } from '@supabase/supabase-js'
import { ingestMiraxLead, getEntityById, getRelatedEntities, getTimeline } from '../src/lib/universe/index.ts'

function loadEnv(path) {
  return Object.fromEntries(
    fs
      .readFileSync(path, 'utf8')
      .split(/\r?\n/)
      .filter((l) => l && !l.startsWith('#'))
      .map((l) => {
        const i = l.indexOf('=')
        return [l.slice(0, i), l.slice(i + 1)]
      }),
  )
}

const env = loadEnv('.env.local')
assert.ok(env.NEXT_PUBLIC_SUPABASE_URL)
assert.ok(env.SUPABASE_SERVICE_ROLE_KEY)

const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

const testLead = {
  azienda: 'Test Universe Srl',
  sito: 'https://www.test-universe-mirax.it',
  telefono: '+39 333 999 8888',
  email: 'info@test-universe-mirax.it',
  citta: 'Roma',
  categoria: 'Software House',
  meta_pixel: false,
  google_tag_manager: false,
  ssl: true,
  load_speed_seconds: 2.5,
  tech_stack: ['wordpress', 'google_analytics'],
  rating: 4.2,
  reviews_count: 12,
  business_hiring_jobs: [{ title: 'Sviluppatore React', url: 'https://test-universe-mirax.it/jobs/react', source: 'indeed' }],
  last_audited_at: new Date().toISOString(),
}

// Cleanup pre-test by domain alias
const { data: existing } = await sb
  .from('universe_entity_aliases')
  .select('entity_id')
  .eq('alias_type', 'domain')
  .eq('alias_value', 'test-universe-mirax.it')
  .maybeSingle()

if (existing?.entity_id) {
  await sb.from('universe_entities').delete().eq('id', existing.entity_id)
  console.log('✓ cleanup entity precedente')
}

const result = await ingestMiraxLead(sb, testLead, 'test')

assert.ok(result.entity_id, 'entity_id mancante')
assert.equal(result.entity_type, 'company')
assert.ok(result.observations_created >= 6, `observations troppo poche: ${result.observations_created}`)
assert.ok(result.relationships_created >= 3, `relationships troppo poche: ${result.relationships_created}`)
assert.ok(result.events_created >= 1, `events troppo pochi: ${result.events_created}`)
assert.ok(result.is_new, 'entity dovrebbe essere nuova')
console.log(`✓ ingest creato: ${result.observations_created} obs, ${result.relationships_created} rel, ${result.events_created} events`)

// Verify entity
const company = await getEntityById(sb, result.entity_id)
assert.equal(company.name, 'Test Universe Srl')
assert.equal(company.city, 'Roma')
assert.equal(company.entity_type, 'company')
console.log('✓ entity letta')

// Verify related entities
const related = await getRelatedEntities(sb, result.entity_id)
assert.ok(related.some((r) => r.relationship_type === 'owns'), 'manca relazione owns')
assert.ok(related.some((r) => r.relationship_type === 'uses'), 'manca relazione uses')
assert.ok(related.some((r) => r.relationship_type === 'hires'), 'manca relazione hires')
assert.ok(related.some((r) => r.relationship_type === 'located_in'), 'manca relazione located_in')
console.log('✓ related entities ok')

// Verify timeline
const timeline = await getTimeline(sb, result.entity_id)
assert.ok(timeline.some((t) => t.attribute === 'rating'), 'manca observation rating')
console.log('✓ timeline ok')

// Cleanup
await sb.from('universe_entities').delete().eq('id', result.entity_id)
console.log('✓ cleanup')

console.log('\n[test-universe-ingest] OK')
