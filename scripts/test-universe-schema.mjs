#!/usr/bin/env node
/**
 * Verifica schema Universe su Supabase dev.
 * REST API se disponibile; fallback Postgres diretto (pooler).
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
  'universe_query_cache',
  'universe_webhook_deliveries',
  'universe_events_archive',
]

const expectedIndexes = [
  'idx_universe_entities_type_city',
  'idx_observations_entity_attr_time',
  'idx_relationships_source_type',
  'idx_universe_events_entity_type_time',
]

const helperFunctions = [
  'universe_latest_observation',
  'universe_related_entities',
  'universe_resolve_entity_by_alias',
  'universe_archive_old_events',
]

async function tableExistsPg(client, table) {
  const r = await client.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1`,
    [table],
  )
  return r.rowCount > 0
}

async function runViaPg() {
  const client = await connectMiraxDb()
  console.log('✓ connessione Postgres diretta (pooler)')

  for (const table of tables) {
    const exists = await tableExistsPg(client, table)
    if (!exists) {
      if (['universe_query_cache', 'universe_webhook_deliveries', 'universe_events_archive'].includes(table)) {
        console.warn(`⚠ tabella ${table} mancante — riesegui: npm run db:apply-mirax`)
        continue
      }
      assert.fail(`Tabella ${table} mancante`)
    }
    console.log(`✓ tabella ${table} esiste`)
  }

  const cols = await client.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'universe_entities'`,
  )
  const names = cols.rows.map((r) => r.column_name)
  for (const col of ['canonical_id', 'entity_type', 'name', 'metadata', 'merged_into_id', 'confidence']) {
    assert.ok(names.includes(col), `Colonna mancante: ${col}`)
  }
  console.log('✓ colonne universe_entities ok')

  const idx = await client.query(
    `SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND indexname = ANY($1::text[])`,
    [expectedIndexes],
  )
  const found = new Set(idx.rows.map((r) => r.indexname))
  for (const name of expectedIndexes) {
    assert.ok(found.has(name), `Indice mancante: ${name}`)
    console.log(`✓ indice ${name}`)
  }

  for (const fn of helperFunctions) {
    const r = await client.query(
      `SELECT 1 FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
       WHERE n.nspname = 'public' AND p.proname = $1`,
      [fn],
    )
    if (r.rowCount === 0 && fn === 'universe_archive_old_events') {
      console.warn(`⚠ funzione ${fn} mancante — applica migration fase 10`)
      continue
    }
    assert.ok(r.rowCount > 0, `Funzione mancante: ${fn}`)
    console.log(`✓ funzione ${fn} esiste`)
  }

  await client.end()
}

async function runViaRest(sb) {
  for (const table of tables) {
    const { error } = await sb.from(table).select('*', { count: 'exact', head: true })
    if (error && /does not exist|schema cache/i.test(error.message)) {
      if (['universe_query_cache', 'universe_webhook_deliveries', 'universe_events_archive'].includes(table)) {
        console.warn(`⚠ tabella ${table} mancante — riesegui: npm run db:apply-mirax`)
        continue
      }
    }
    assert.ok(!error, `Tabella ${table}: ${error?.message}`)
    console.log(`✓ tabella ${table} esiste`)
  }

  const { data: infoCols, error: infoError } = await sb
    .from('information_schema.columns')
    .select('column_name')
    .eq('table_name', 'universe_entities')
    .eq('table_schema', 'public')
  assert.ok(!infoError, infoError?.message)
  const names = infoCols.map((c) => c.column_name)
  for (const col of ['canonical_id', 'entity_type', 'name', 'metadata', 'merged_into_id', 'confidence']) {
    assert.ok(names.includes(col), `Colonna mancante: ${col}`)
  }
  console.log('✓ colonne universe_entities ok')

  const { data: indexes, error: idxError } = await sb
    .from('pg_indexes')
    .select('indexname')
    .eq('schemaname', 'public')
    .in('indexname', expectedIndexes)
  assert.ok(!idxError, idxError?.message)
  const found = new Set(indexes.map((i) => i.indexname))
  for (const idx of expectedIndexes) {
    assert.ok(found.has(idx), `Indice mancante: ${idx}`)
    console.log(`✓ indice ${idx}`)
  }

  for (const fn of helperFunctions) {
    const args =
      fn === 'universe_archive_old_events'
        ? { p_days: 180 }
        : { p_entity_id: '00000000-0000-0000-0000-000000000000', p_attribute: 'meta_pixel' }
    const { error } = await sb.rpc(fn, args)
    if (error && /does not exist/i.test(error.message) && fn === 'universe_archive_old_events') {
      console.warn(`⚠ funzione ${fn} mancante`)
      continue
    }
    assert.ok(!error || !/does not exist/i.test(error.message), `${fn}: ${error?.message}`)
    console.log(`✓ funzione ${fn} esiste`)
  }
}

const env = loadEnv('.env.local')
assert.ok(env.NEXT_PUBLIC_SUPABASE_URL, 'NEXT_PUBLIC_SUPABASE_URL mancante')

try {
  if (env.SUPABASE_SERVICE_ROLE_KEY) {
    const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
    const probe = await sb.from('universe_entities').select('id', { head: true, count: 'exact' })
    if (!probe.error || !isNetworkError(probe.error.message)) {
      await runViaRest(sb)
      console.log('\n[test-universe-schema] OK (REST)')
      process.exit(0)
    }
    console.warn('REST non disponibile — fallback Postgres:', probe.error?.message)
  } else {
    console.warn('SUPABASE_SERVICE_ROLE_KEY assente — uso Postgres diretto')
  }

  await runViaPg()
  console.log('\n[test-universe-schema] OK (Postgres)')
} catch (e) {
  const msg = e instanceof Error ? e.message : String(e)
  if (isNetworkError(msg)) {
    console.error('\n[test-universe-schema] FAIL — né REST né Postgres raggiungibili:', msg)
    process.exit(1)
  }
  throw e
}
