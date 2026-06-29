#!/usr/bin/env node
/**
 * Verifica RLS Universe — REST se disponibile, altrimenti Postgres diretto.
 */
import fs from 'node:fs'
import assert from 'node:assert/strict'
import { createClient } from '@supabase/supabase-js'
import { connectMiraxDb } from './lib/mirax-db.mjs'

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

function isNetworkError(msg) {
  return /fetch failed|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|network/i.test(msg)
}

const tables = [
  'universe_entities',
  'universe_entity_aliases',
  'universe_observations',
  'universe_relationships',
  'universe_events',
  'universe_user_context',
]

const expectedPolicies = [
  { table: 'universe_entities', policy: 'universe_entities_public_read' },
  { table: 'universe_entities', policy: 'universe_entities_service_write' },
  { table: 'universe_observations', policy: 'universe_observations_public_read' },
  { table: 'universe_relationships', policy: 'universe_relationships_public_read' },
  { table: 'universe_events', policy: 'universe_events_public_read' },
  { table: 'universe_user_context', policy: 'universe_user_context_owner' },
]

async function runViaPg() {
  const client = await connectMiraxDb()
  console.log('✓ connessione Postgres diretta (pooler)')

  for (const table of tables) {
    const r = await client.query(
      `SELECT rowsecurity FROM pg_tables WHERE schemaname = 'public' AND tablename = $1`,
      [table],
    )
    assert.equal(r.rows[0]?.rowsecurity, true, `RLS non abilitato su ${table}`)
    console.log(`✓ RLS abilitato su ${table}`)
  }

  const pol = await client.query(
    `SELECT tablename, policyname FROM pg_policies WHERE schemaname = 'public'`,
  )
  const keys = new Set(pol.rows.map((p) => `${p.tablename}.${p.policyname}`))
  for (const { table, policy } of expectedPolicies) {
    const key = `${table}.${policy}`
    assert.ok(keys.has(key), `Policy mancante: ${key}`)
    console.log(`✓ policy ${key}`)
  }

  const ins = await client.query(
    `INSERT INTO universe_entities (canonical_id, entity_type, name, metadata)
     VALUES ($1, $2, $3, $4::jsonb)
     RETURNING id`,
    ['test:mirax:schema:rls', 'company', 'Test RLS Entity', JSON.stringify({ test: true })],
  )
  assert.ok(ins.rows[0]?.id, 'service role write via Postgres fallito')
  console.log('✓ service role write ok')
  await client.query(`DELETE FROM universe_entities WHERE id = $1`, [ins.rows[0].id])
  console.log('✓ cleanup test entity')

  await client.end()
}

async function runViaRest(sb) {
  for (const table of tables) {
    const { data, error } = await sb
      .from('pg_tables')
      .select('rowsecurity')
      .eq('schemaname', 'public')
      .eq('tablename', table)
      .single()
    assert.ok(!error, error?.message)
    assert.equal(data.rowsecurity, true, `RLS non abilitato su ${table}`)
    console.log(`✓ RLS abilitato su ${table}`)
  }

  const { data: policies, error: polError } = await sb
    .from('pg_policies')
    .select('tablename, policyname')
    .eq('schemaname', 'public')
  assert.ok(!polError, polError?.message)
  const keys = new Set(policies.map((p) => `${p.tablename}.${p.policyname}`))
  for (const { table, policy } of expectedPolicies) {
    assert.ok(keys.has(`${table}.${policy}`), `Policy mancante: ${table}.${policy}`)
    console.log(`✓ policy ${table}.${policy}`)
  }

  const { data: inserted, error: insertError } = await sb
    .from('universe_entities')
    .insert({
      canonical_id: 'test:mirax:schema:rls',
      entity_type: 'company',
      name: 'Test RLS Entity',
      metadata: { test: true },
    })
    .select()
    .single()
  assert.ok(!insertError, insertError?.message)
  console.log('✓ service role write ok')
  if (inserted?.id) {
    await sb.from('universe_entities').delete().eq('id', inserted.id)
    console.log('✓ cleanup test entity')
  }
}

const env = loadEnv('.env.local')
assert.ok(env.NEXT_PUBLIC_SUPABASE_URL)

try {
  if (env.SUPABASE_SERVICE_ROLE_KEY) {
    const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
    const probe = await sb.from('universe_entities').select('id', { head: true, count: 'exact' })
    if (!probe.error || !isNetworkError(probe.error.message)) {
      await runViaRest(sb)
      console.log('\n[test-universe-rls] OK (REST)')
      process.exit(0)
    }
    console.warn('REST non disponibile — fallback Postgres:', probe.error?.message)
  }

  await runViaPg()
  console.log('\n[test-universe-rls] OK (Postgres)')
} catch (e) {
  const msg = e instanceof Error ? e.message : String(e)
  console.error('\n[test-universe-rls] FAIL:', msg)
  process.exit(1)
}
