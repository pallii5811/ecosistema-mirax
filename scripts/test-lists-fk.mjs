#!/usr/bin/env node
/**
 * Verifica FK list_leads ↔ leads/lists e join PostgREST-style via pg.
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import pg from 'pg'

const { Client } = pg
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DEV_REF = 'ktspchugdwpqvxhmysap'
const ENV_PATH = path.join(ROOT, '.env.local')
const SECRETS_PATH = path.join(ROOT, '.env.ecosistema.secrets')

function parseEnv(text) {
  const out = {}
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const i = t.indexOf('=')
    if (i < 1) continue
    out[t.slice(0, i).trim()] = t.slice(i + 1).trim()
  }
  return out
}

function loadPassword() {
  for (const p of [ENV_PATH, SECRETS_PATH]) {
    if (!fs.existsSync(p)) continue
    const env = parseEnv(fs.readFileSync(p, 'utf8'))
    if (env.ECOSISTEMA_DB_PASSWORD) return env.ECOSISTEMA_DB_PASSWORD
  }
  return process.env.ECOSISTEMA_DB_PASSWORD
}

const password = loadPassword()
if (!password) {
  console.error('Manca ECOSISTEMA_DB_PASSWORD')
  process.exit(1)
}

const endpoints = [
  { host: `db.${DEV_REF}.supabase.co`, port: 5432, user: 'postgres' },
  { host: 'aws-0-eu-west-1.pooler.supabase.com', port: 5432, user: `postgres.${DEV_REF}` },
]

async function connectClient() {
  for (const ep of endpoints) {
    const client = new Client({
      host: ep.host,
      port: ep.port,
      user: ep.user,
      password,
      database: 'postgres',
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 15000,
    })
    try {
      await client.connect()
      return client
    } catch {
      try {
        await client.end()
      } catch {
        /* ignore */
      }
    }
  }
  throw new Error('DB unreachable')
}

let passed = 0
let failed = 0

function ok(label) {
  passed += 1
  console.log(`✓ ${label}`)
}

function fail(label, detail) {
  failed += 1
  console.error(`✗ ${label}${detail ? ` — ${detail}` : ''}`)
}

try {
  const client = await connectClient()

  const fk = await client.query(`
    select conname, confrelid::regclass as ref_table
    from pg_constraint
    where conrelid = 'public.list_leads'::regclass
      and contype = 'f'
    order by conname
  `)

  const names = fk.rows.map((r) => r.conname)
  if (names.includes('list_leads_list_id_fkey') && names.includes('list_leads_lead_id_fkey')) {
    ok('FK list_leads → lists + leads presenti')
  } else {
    fail('FK mancanti', names.join(', ') || 'nessuna')
  }

  const join = await client.query(`
    select count(*)::int as n
    from public.list_leads ll
    inner join public.leads l on l.id = ll.lead_id
    inner join public.lists ls on ls.id = ll.list_id
    limit 1
  `)
  ok(`join SQL list_leads↔leads↔lists (${join.rows[0]?.n ?? 0} righe)`)

  await client.end()

  if (failed > 0) {
    console.error(`\n[test-lists-fk] ${passed} passed, ${failed} failed`)
    process.exit(1)
  }
  console.log(`\n[test-lists-fk] ${passed}/${passed} OK`)
} catch (e) {
  console.error('[test-lists-fk] error:', e.message)
  process.exit(1)
}
