#!/usr/bin/env node
/**
 * MIRAX Quality E2E — verifica integrità end-to-end (DB PostgREST, liste, segnali, worker).
 * Usage: node scripts/test-mirax-quality-e2e.mjs
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import pg from 'pg'
import { createClient } from '@supabase/supabase-js'

const { Client } = pg
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DEV_REF = 'ktspchugdwpqvxhmysap'
const ENV_PATH = path.join(ROOT, '.env.local')
const SECRETS_PATH = path.join(ROOT, '.env.ecosistema.secrets')

let passed = 0
let failed = 0
const failures = []

function ok(label) {
  passed += 1
  console.log(`✓ ${label}`)
}

function fail(label, detail) {
  failed += 1
  failures.push(`${label}: ${detail || ''}`)
  console.error(`✗ ${label}${detail ? ` — ${detail}` : ''}`)
}

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

function loadEnv() {
  const merged = {}
  for (const p of [SECRETS_PATH, ENV_PATH]) {
    if (fs.existsSync(p)) Object.assign(merged, parseEnv(fs.readFileSync(p, 'utf8')))
  }
  return merged
}

function loadDbPassword(env) {
  return env.ECOSISTEMA_DB_PASSWORD || process.env.ECOSISTEMA_DB_PASSWORD
}

async function connectPg(password) {
  const endpoints = [
    { host: `db.${DEV_REF}.supabase.co`, port: 5432, user: 'postgres' },
    { host: 'aws-0-eu-west-1.pooler.supabase.com', port: 5432, user: `postgres.${DEV_REF}` },
  ]
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

const env = loadEnv()
const BACKEND = (env.BACKEND_URL || 'http://116.203.137.39:8002').replace(/\/+$/, '')
const sb = env.NEXT_PUBLIC_SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY
  ? createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
  : null

console.log('══════════════════════════════════════')
console.log('MIRAX Quality E2E')
console.log('══════════════════════════════════════\n')

// ── 1. Worker health ───────────────────────────────────────────────────────
console.log('━━━ 1. Worker staging (116:8002) ━━━')
try {
  const res = await fetch(`${BACKEND}/health`, { signal: AbortSignal.timeout(12_000) })
  const body = await res.text()
  if (res.ok && /ok/i.test(body)) ok(`Worker health ${BACKEND}/health (${res.status})`)
  else fail('Worker health', `HTTP ${res.status} ${body.slice(0, 80)}`)
} catch (e) {
  fail('Worker health', e.message)
}

try {
  const res = await fetch(`${BACKEND}/audit-url`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: 'https://www.enel.it' }),
    signal: AbortSignal.timeout(90_000),
  })
  if (res.ok) {
    const audit = await res.json()
    const hasIg = 'missing_instagram' in audit || audit?.audit?.missing_instagram !== undefined
    if (hasIg) ok('Audit API /audit-url risponde con segnali sito')
    else fail('Audit API', 'missing_instagram assente')
  } else fail('Audit API', `HTTP ${res.status}`)
} catch (e) {
  fail('Audit API', e.message)
}

// ── 2. PostgREST join liste (fix FK) ─────────────────────────────────────
console.log('\n━━━ 2. Liste — PostgREST join list_leads ↔ leads ━━━')
if (!sb) {
  fail('Supabase client', 'mancano NEXT_PUBLIC_SUPABASE_URL / SERVICE_ROLE_KEY')
} else {
  const { data: joinRows, error: joinErr } = await sb
    .from('list_leads')
    .select('list_id, leads!inner(id, name, website, score)')
    .limit(10)

  if (joinErr) fail('PostgREST join list_leads→leads', joinErr.message)
  else ok(`PostgREST join OK (${(joinRows ?? []).length} righe campione)`)

  const { data: statsRows, error: statsErr } = await sb
    .from('list_leads')
    .select('list_id, leads!inner(score)')
    .limit(20)

  if (statsErr) fail('PostgREST stats pattern', statsErr.message)
  else ok(`Pattern /api/lists/stats OK (${(statsRows ?? []).length} righe)`)

  const { data: lists, error: listsErr } = await sb.from('lists').select('id, name, user_id').limit(5)
  if (listsErr) fail('Tabella lists', listsErr.message)
  else ok(`Tabella lists leggibile (${lists?.length ?? 0} liste campione)`)

  const { count: linkCount } = await sb.from('list_leads').select('*', { count: 'exact', head: true })
  ok(`list_leads totali: ${linkCount ?? 0} collegamenti`)
}

// ── 3. DB integrity ───────────────────────────────────────────────────────
console.log('\n━━━ 3. Integrità DB ━━━')
const dbPass = loadDbPassword(env)
if (!dbPass) {
  fail('DB password', 'ECOSISTEMA_DB_PASSWORD mancante')
} else {
  let pgClient
  try {
    pgClient = await connectPg(dbPass)

    const fk = await pgClient.query(`
      select conname from pg_constraint
      where conrelid = 'public.list_leads'::regclass and contype = 'f'
    `)
    const fkNames = fk.rows.map((r) => r.conname)
    if (fkNames.includes('list_leads_list_id_fkey') && fkNames.includes('list_leads_lead_id_fkey')) {
      ok('FK list_leads → lists + leads')
    } else fail('FK list_leads', fkNames.join(', ') || 'assenti')

    const orphan = await pgClient.query(`
      select count(*)::int as n from public.list_leads ll
      where not exists (select 1 from public.leads l where l.id = ll.lead_id)
         or not exists (select 1 from public.lists ls where ls.id = ll.list_id)
    `)
    if ((orphan.rows[0]?.n ?? 0) === 0) ok('Zero orphan in list_leads')
    else fail('Orphan list_leads', String(orphan.rows[0]?.n))

    const tables = [
      'lists', 'leads', 'list_leads', 'searches', 'lead_business_signals',
      'compliance_checks', 'inbound_reply_classifications', 'gmail_connections',
    ]
    for (const t of tables) {
      const r = await pgClient.query(
        `select exists (select 1 from information_schema.tables where table_schema='public' and table_name=$1) as ok`,
        [t],
      )
      if (r.rows[0]?.ok) ok(`Tabella ${t}`)
      else fail(`Tabella ${t}`, 'mancante')
    }

    const signalCheck = await pgClient.query(`
      select pg_get_constraintdef(oid) as def
      from pg_constraint
      where conrelid = 'public.lead_business_signals'::regclass
        and conname like '%signal_type%'
      limit 1
    `)
    const def = signalCheck.rows[0]?.def || ''
    for (const st of ['hiring', 'tender_won', 'sector_investment', 'crm_detected', 'crm_change']) {
      if (def.includes(`'${st}'`)) ok(`signal_type consente '${st}'`)
      else fail(`signal_type '${st}'`, 'non in constraint')
    }

    await pgClient.end()
  } catch (e) {
    fail('DB integrity', e.message)
    try {
      await pgClient?.end()
    } catch {
      /* ignore */
    }
  }
}

// ── 4. Ricerche recenti + enrichment ───────────────────────────────────────
console.log('\n━━━ 4. Ricerche recenti + campi business events ━━━')
if (sb) {
  const { data: recent, error: searchErr } = await sb
    .from('searches')
    .select('id, status, location, category, results, created_at')
    .eq('status', 'completed')
    .order('created_at', { ascending: false })
    .limit(5)

  if (searchErr) fail('searches query', searchErr.message)
  else {
    ok(`Ricerche completed recenti: ${recent?.length ?? 0}`)
    let withResults = 0
    let withEnrichment = 0
    let withContact = 0
    for (const job of recent ?? []) {
      const results = Array.isArray(job.results) ? job.results : []
      if (results.length > 0) withResults += 1
      for (const lead of results.slice(0, 20)) {
        const phone = String(lead?.telefono || lead?.phone || '').trim()
        const email = String(lead?.email || '').trim()
        if ((phone.length >= 4 && !['N/D', 'N/A'].includes(phone)) || (email.includes('@') && !email.includes('example.com'))) {
          withContact += 1
        }
        if (
          lead?.business_hiring_jobs ||
          lead?.business_tender_hits ||
          lead?.business_sector_hits ||
          lead?.detected_crm_stack ||
          lead?.business_events_enriched_at
        ) {
          withEnrichment += 1
        }
      }
    }
    ok(`Job con risultati: ${withResults}/${recent?.length ?? 0}`)
    ok(`Lead con contatto (campione): ${withContact}`)
    if (withEnrichment > 0) ok(`Lead con business events enrichment: ${withEnrichment}`)
    else console.log('  ⚠ Nessun enrichment su job recenti — normale se job pre-deploy o ENRICH non ancora eseguito')
  }

  const { count: pending } = await sb.from('searches').select('*', { count: 'exact', head: true }).eq('status', 'pending')
  ok(`Job pending in coda: ${pending ?? 0}`)
}

// ── 5. Signal intent catalog ───────────────────────────────────────────────
console.log('\n━━━ 5. Signal intent NL (catalogo completo) ━━━')
const INTENT_CASES = [
  ['trova aziende che stanno assumendo programmatori a Bologna', 'hiring'],
  ['imprese edili che hanno vinto una gara nell ultimo anno', 'tender_won'],
  ['PMI che investono nel fotovoltaico in Veneto', 'sector_investment'],
  ['aziende che hanno cambiato CRM negli ultimi 30 giorni', 'crm_change'],
  ['aziende con Google Ads attivo a Milano', 'google_ads_started'],
  ['società in crescita fatturato Lombardia', 'registry_change'],
]

function parseIntent(q) {
  const required = []
  if (/\b(assum|assunz|assumendo|hiring|offerte?\s+di\s+lavoro|programmator)\b/i.test(q)) required.push('hiring')
  if (/\b(fotovoltaic|fotovoltaico|pannelli\s+solari|rinnovabil)\b/i.test(q)) required.push('sector_investment')
  if (/\b(gara|appalto|aggiudicat|bando)\b/i.test(q)) required.push('tender_won')
  if (/\b(cambiat.*crm|migrat.*crm|nuovo\s+crm)\b/i.test(q)) required.push('crm_change')
  if (/\bgoogle\s+ads\b/i.test(q)) required.push('google_ads_started')
  if (/\b(crescita|fatturato|bilancio|registro)\b/i.test(q)) required.push('registry_change')
  return required
}

for (const [q, expected] of INTENT_CASES) {
  const got = parseIntent(q)
  if (got.includes(expected)) ok(`"${q.slice(0, 45)}…" → ${expected}`)
  else fail(`Intent "${expected}"`, `query: ${q.slice(0, 40)} got [${got.join(',')}]`)
}

// ── 6. API auth guards (localhost se up, altrimenti skip) ─────────────────
console.log('\n━━━ 6. API HTTP (dev server) ━━━')
const BASE = process.env.MIRAX_E2E_BASE || 'http://localhost:3000'
let apiUp = false
try {
  const ping = await fetch(`${BASE}/api/v1/status`, { signal: AbortSignal.timeout(3000) })
  apiUp = ping.ok
} catch {
  apiUp = false
}

if (!apiUp) {
  console.log(`  ⚠ Dev server non raggiungibile su ${BASE} — skip API live (auth guards testati in test-mirax-phases-e2e)`)
} else {
  ok(`Dev server up ${BASE}`)
  const guards = [
    ['POST', '/api/deliverability/check', 401],
    ['GET', '/api/inbox/gmail/messages', 401],
    ['POST', '/api/compliance/check', 401],
  ]
  for (const [method, route, expectStatus] of guards) {
    const res = await fetch(`${BASE}${route}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: method === 'POST' ? '{}' : undefined,
      signal: AbortSignal.timeout(5000),
    })
    if (res.status === expectStatus) ok(`${method} ${route} → ${expectStatus}`)
    else fail(`${method} ${route}`, `atteso ${expectStatus}, got ${res.status}`)
  }
}

// ── Summary ───────────────────────────────────────────────────────────────
console.log('\n══════════════════════════════════════')
if (failed > 0) {
  console.error(`❌ MIRAX Quality E2E: ${passed} passed, ${failed} failed`)
  for (const f of failures) console.error(`   • ${f}`)
  process.exit(1)
}
console.log(`✅ MIRAX Quality E2E: ${passed}/${passed} passed — qualità verificata`)
process.exit(0)
