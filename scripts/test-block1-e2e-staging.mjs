#!/usr/bin/env node
/**
 * E2E Blocco 1 — staging (Supabase dev + Hetzner 116:8002).
 * Usage: node scripts/test-block1-e2e-staging.mjs [city] [category]
 */
import fs from 'fs'
import { createClient } from '@supabase/supabase-js'

const env = Object.fromEntries(
  fs.readFileSync('.env.local', 'utf8')
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=')
      return [l.slice(0, i), l.slice(i + 1)]
    }),
)

const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
const BACKEND = env.BACKEND_URL || 'http://116.203.137.39:8002'
const city = process.argv[2] || 'Benevento'
const category = process.argv[3] || 'idraulici'
const PLATEAU_MS = 120_000
const POLL_MS = 4000
/** Staging worker: search + audit completi possono richiedere 8–12 min */
const MAX_WAIT_MS = 720_000

function hasContact(lead) {
  const phone = String(lead?.telefono || lead?.phone || '').trim()
  const email = String(lead?.email || '').trim()
  return (phone.length >= 4 && !['N/D', 'N/A'].includes(phone)) || (email.includes('@') && !email.includes('example.com'))
}

async function testAuditInstagram() {
  const res = await fetch(`${BACKEND}/audit-url`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: 'https://www.enel.it' }),
    signal: AbortSignal.timeout(90_000),
  })
  if (!res.ok) throw new Error(`audit-url HTTP ${res.status}`)
  const audit = await res.json()
  if (!('missing_instagram' in audit) && !(audit.audit && 'missing_instagram' in audit.audit)) {
    throw new Error('audit-url missing missing_instagram field')
  }
  console.log('OK audit-url returns instagram signal', audit.instagram ? 'has link' : 'missing_instagram')
}

async function runSearchE2E() {
  const { data: inserted, error } = await sb
    .from('searches')
    .insert({ category, location: city, status: 'pending', results: [] })
    .select('id')
    .single()
  if (error || !inserted?.id) throw new Error(`insert search failed: ${error?.message}`)
  const jobId = inserted.id
  console.log(`Job ${jobId}: ${category} @ ${city}`)

  const started = Date.now()
  let lastCount = 0
  let stale = 0

  while (Date.now() - started < MAX_WAIT_MS) {
    await new Promise((r) => setTimeout(r, POLL_MS))
    const { data: job } = await sb.from('searches').select('status,results').eq('id', jobId).single()
    const results = Array.isArray(job?.results) ? job.results : []
    if (results.length === lastCount) stale += 1
    else {
      stale = 0
      lastCount = results.length
    }
    console.log(`  poll status=${job?.status} raw=${results.length} stale=${stale}`)

    if (job?.status === 'completed' || job?.status === 'error') break
    if (stale >= 30 && results.length > 0) {
      console.warn('  plateau detected — worker should mark completed (Blocco 1.4)')
      break
    }
  }

  const { data: final } = await sb.from('searches').select('status,results').eq('id', jobId).single()
  const results = Array.isArray(final?.results) ? final.results : []
  const withContact = results.filter(hasContact)

  if (final?.status === 'processing') {
    throw new Error(`Job stuck in processing after ${Math.round((Date.now() - started) / 1000)}s (max ${MAX_WAIT_MS / 1000}s)`)
  }

  console.log(`OK search E2E: status=${final?.status} raw=${results.length} withContact=${withContact.length}`)

  await sb.from('searches').delete().eq('id', jobId)
}

let failed = 0
for (const [name, fn] of [
  ['audit instagram field', testAuditInstagram],
  [`search ${category} ${city}`, runSearchE2E],
]) {
  try {
    await fn()
  } catch (e) {
    failed += 1
    console.error('FAIL', name, e.message)
  }
}
process.exit(failed ? 1 : 0)
