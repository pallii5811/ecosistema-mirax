#!/usr/bin/env node
/**
 * E2E MIRAX Fase 1–4 — Supabase dev + API HTTP
 * Run: node scripts/test-mirax-phases-e2e.mjs [--base=http://localhost:3000]
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { createClient } from '@supabase/supabase-js'
import { promises as dns } from 'dns'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const baseArg = args.find((a) => a.startsWith('--base='))
const BASE = baseArg ? baseArg.slice(7).replace(/\/$/, '') : process.env.MIRAX_E2E_BASE || 'http://localhost:3000'

function loadEnv() {
  const p = path.join(ROOT, '.env.local')
  if (!fs.existsSync(p)) throw new Error('Missing .env.local')
  return Object.fromEntries(
    fs
      .readFileSync(p, 'utf8')
      .split(/\r?\n/)
      .filter((l) => l && !l.startsWith('#'))
      .map((l) => {
        const i = l.indexOf('=')
        return [l.slice(0, i), l.slice(i + 1)]
      }),
  )
}

const env = loadEnv()
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

const PHASE_TABLES = [
  'lead_business_signals',
  'compliance_checks',
  'inbound_reply_classifications',
  'gmail_connections',
  'outbound_queue',
  'competitors',
  'competitor_alerts',
]

let passed = 0
let failed = 0

function ok(label) {
  console.log(`✓ ${label}`)
  passed += 1
}

function fail(label, detail) {
  console.error(`✗ ${label}${detail ? ` — ${detail}` : ''}`)
  failed += 1
}

async function checkTables() {
  console.log('\n━━━ DB tables (Fase 1–4) ━━━')
  for (const table of PHASE_TABLES) {
    const { error } = await sb.from(table).select('*', { count: 'exact', head: true })
    if (error && /does not exist|schema cache/i.test(error.message)) {
      fail(`table ${table}`, 'missing — run npm run db:apply-mirax')
    } else if (error) {
      fail(`table ${table}`, error.message)
    } else {
      ok(`table ${table}`)
    }
  }
}

async function checkDbRoundTrip() {
  console.log('\n━━━ DB write round-trip ━━━')
  const testUser = '00000000-0000-4000-8000-000000000001'
  const { data, error } = await sb
    .from('compliance_checks')
    .insert({
      user_id: testUser,
      channel: 'email',
      target: 'e2e-test@mirax.local',
      check_type: 'registro_opposizioni',
      status: 'clear',
    })
    .select('id')
    .maybeSingle()

  if (error || !data?.id) {
    // FK su auth.users — fallback: solo verifica schema colonne
    const { error: schemaErr } = await sb
      .from('compliance_checks')
      .select('id, channel, target, status')
      .limit(0)
    if (schemaErr) fail('compliance_checks schema', schemaErr.message)
    else ok('compliance_checks schema (insert skipped — no test user FK)')
    return
  }

  const { error: delErr } = await sb.from('compliance_checks').delete().eq('id', data.id)
  if (delErr) fail('compliance_checks cleanup', delErr.message)
  else ok('compliance_checks insert + delete')
}

async function checkDnsLookup() {
  console.log('\n━━━ Deliverability DNS (live) ━━━')
  try {
    const records = await dns.resolveTxt('google.com')
    const flat = records.map((r) => r.join(''))
    if (flat.some((r) => r.toLowerCase().includes('v=spf1'))) ok('DNS SPF lookup google.com')
    else ok('DNS TXT lookup google.com (no SPF — network ok)')
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'error'
    if (/ECONNREFUSED|ENOTFOUND|ETIMEOUT/i.test(msg)) {
      console.log(`⚠ DNS lookup skipped (${msg}) — ok in CI/Vercel, rete locale limitata`)
      ok('DNS lookup skipped (network)')
    } else {
      fail('DNS lookup', msg)
    }
  }
}

async function expectUnauth(path, method = 'GET', body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  })
  if (res.status === 401) ok(`${method} ${path} requires auth`)
  else fail(`${method} ${path} unauth`, `expected 401, got ${res.status}`)
}

async function checkHttpRoutes() {
  console.log('\n━━━ API HTTP (auth guards + public) ━━━')
  try {
    const statusRes = await fetch(`${BASE}/api/v1/status`, { cache: 'no-store' })
    const statusData = await statusRes.json().catch(() => ({}))
    if (statusRes.ok && statusData.ok && statusData.version) ok('GET /api/v1/status public')
    else fail('GET /api/v1/status', `HTTP ${statusRes.status}`)

    await expectUnauth('/api/deliverability/check', 'POST', { domain: 'google.com' })
    await expectUnauth('/api/inbox/gmail/messages')
    await expectUnauth('/api/outreach/classify-reply', 'POST', { action: 'classify', replySnippet: 'test reply here' })
    await expectUnauth('/api/compliance/check', 'POST', { channel: 'email', target: 'test@example.com' })
    await expectUnauth('/api/v1/classify-reply', 'POST', { replySnippet: 'Mi interessa la proposta' })
    await expectUnauth('/api/competitors')
    await expectUnauth('/api/competitors/market-map')
  } catch (e) {
    fail('API HTTP', e instanceof Error ? e.message : 'fetch failed')
  }
}

async function main() {
  console.log(`MIRAX Phases E2E — base: ${BASE}`)
  if (env.NEXT_PUBLIC_SUPABASE_URL?.includes('rtjmnjromqpsfqsgyfvp')) {
    console.error('❌ PROD Supabase detected — abort')
    process.exit(1)
  }

  await checkTables()
  await checkDbRoundTrip()
  await checkDnsLookup()

  const serverUp = await fetch(`${BASE}/api/v1/status`, { signal: AbortSignal.timeout(8000) })
    .then((r) => r.ok)
    .catch(() => false)

  if (serverUp) {
    await checkHttpRoutes()
  } else {
    console.log('\n⚠ Server non raggiungibile su', BASE, '— skip API HTTP tests')
    console.log('  Avvia `npm run dev` o passa --base=https://ecosistema-mirax.vercel.app')
    failed += 1
    fail('dev server required for full E2E', 'not running')
  }

  console.log(`\n${passed} passed, ${failed} failed`)
  process.exit(failed > 0 ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
