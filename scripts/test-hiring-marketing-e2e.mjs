#!/usr/bin/env node
/**
 * E2E: agenzie marketing Milano + hiring commerciale
 * Inserisce job piccolo (15 lead), attende completed + enrichment, verifica segnali.
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { createClient } from '@supabase/supabase-js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const QUERY = 'agenzie marketing a Milano che stanno assumendo commerciali'
const POLL_MS = 12_000
const TIMEOUT_MS = 18 * 60_000

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'

function loadEnv() {
  const m = {}
  for (const p of [path.join(ROOT, '.env.ecosistema.secrets'), path.join(ROOT, '.env.local')]) {
    if (!fs.existsSync(p)) continue
    for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
      const t = line.trim()
      if (!t || t.startsWith('#')) continue
      const i = t.indexOf('=')
      if (i < 1) continue
      m[t.slice(0, i).trim()] = t.slice(i + 1).trim()
    }
  }
  return m
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

function expandCommerciale(text) {
  return /\bcommerciale\b|\bcommercial\b|\bsales\b|\bvenditor\w*\b|\baccount manager\b/i.test(text)
}

function analyzeResults(results) {
  const r = Array.isArray(results) ? results : []
  let contact = 0
  let external = 0
  let hiring = 0
  let commerciale = 0
  let commercialeStrict = 0
  const samples = []

  for (const l of r) {
    if (!l || typeof l !== 'object') continue
    if (l.telefono || l.email) contact++
    if (l.business_events_external_at) external++
    const sigs = Array.isArray(l.business_signals) ? l.business_signals : []
    const jobs = Array.isArray(l.business_hiring_jobs) ? l.business_hiring_jobs : []
    const hasH = sigs.some((s) => s?.type === 'hiring') || jobs.length
    if (!hasH) continue
    hiring++
    const blob = JSON.stringify({ sigs, jobs, azienda: l.azienda }).toLowerCase()
    if (/commerc|sales|vendit|account manager/.test(blob)) commerciale++
    const offerText = [
      ...jobs.map((j) => j?.title || ''),
      ...sigs.filter((s) => s?.type === 'hiring').flatMap((s) => (s.evidence || []).map((e) => e?.value || '')),
    ].join(' ')
    if (expandCommerciale(offerText)) {
      commercialeStrict++
      if (samples.length < 5) {
        samples.push({
          azienda: (l.azienda || '?').slice(0, 50),
          telefono: l.telefono || 'N/D',
          offer: offerText.slice(0, 80),
          source: sigs.find((s) => s?.type === 'hiring')?.evidence?.[0]?.source || jobs[0]?.source,
        })
      }
    }
  }
  return { leads: r.length, contact, external, hiring, commerciale, commercialeStrict, samples }
}

const env = loadEnv()
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
const BACKEND = (env.BACKEND_URL || 'http://116.203.137.39:8002').replace(/\/+$/, '')

console.log('══════════════════════════════════════')
console.log('E2E Hiring Marketing Milano')
console.log('══════════════════════════════════════\n')

try {
  const hres = await fetch(`${BACKEND}/health`, { signal: AbortSignal.timeout(10_000) })
  console.log(`✓ Worker health ${hres.ok ? 'OK' : 'FAIL'}`)
} catch (e) {
  console.error(`✗ Worker health — ${e.message}`)
  process.exit(1)
}

// 1) Analisi job precedente (regression baseline)
const OLD_ID = 'b3593264-d378-4ec9-8f46-ca468b32b65d'
const { data: oldRow } = await sb.from('searches').select('status,results').eq('id', OLD_ID).maybeSingle()
if (oldRow?.results) {
  const old = analyzeResults(oldRow.results)
  console.log(`\n[baseline] job precedente ${OLD_ID.slice(0, 8)}… status=${oldRow.status}`)
  console.log(`  leads=${old.leads} external=${old.external} hiring=${old.hiring} commerciale_strict=${old.commercialeStrict}`)
}

// 2) Live job piccolo
const intent = {
  query: QUERY,
  original_query: QUERY,
  hiring_roles: ['commerciale'],
  target_profile: { industries: ['Agenzie Di Marketing'], locations: ['Milano'], roles: ['commerciale'] },
  signals: [{ type: 'hiring', params: { role: 'commerciale', roles: ['commerciale'] } }],
}

const { data: inserted, error: insErr } = await sb
  .from('searches')
  .insert({
    category: 'Agenzie Di Marketing',
    location: 'Milano',
    status: 'pending',
    results: [],
    zone: '15',
    intent,
    created_at: new Date().toISOString(),
  })
  .select('id')
  .single()

if (insErr || !inserted?.id) {
  console.error('✗ Insert job failed', insErr?.message)
  process.exit(1)
}

const jobId = inserted.id
console.log(`\n→ Live job ${jobId} (max 15 lead, hiring commerciale)`)

const start = Date.now()
let lastLine = ''
let finalStats = null
let finalStatus = null

while (Date.now() - start < TIMEOUT_MS) {
  await sleep(POLL_MS)
  const { data: row } = await sb.from('searches').select('status,results').eq('id', jobId).single()
  const stats = analyzeResults(row?.results)
  const elapsed = Math.round((Date.now() - start) / 1000)
  const line = `[${elapsed}s] ${row?.status} leads=${stats.leads} ext=${stats.external}/${stats.leads} hiring=${stats.hiring} comm=${stats.commercialeStrict}`
  if (line !== lastLine) {
    console.log(line)
    lastLine = line
  }
  if (row?.status === 'completed' || row?.status === 'error') {
    finalStats = stats
    finalStatus = row.status
    // Attendi enrichment bg se completed ma external basso
    if (row.status === 'completed' && stats.leads > 0 && stats.external < Math.min(stats.leads, 10)) {
      if (elapsed < TIMEOUT_MS / 1000 - 120) continue
    }
    break
  }
}

console.log('\n═══ REPORT E2E ═══')
if (!finalStats) {
  console.error('✗ TIMEOUT — job non completato entro 18 min')
  process.exit(1)
}

console.log(`Status: ${finalStatus}`)
console.log(`Lead: ${finalStats.leads}`)
console.log(`Con contatto: ${finalStats.contact}`)
console.log(`External enrich: ${finalStats.external}/${finalStats.leads}`)
console.log(`Hiring (qualsiasi): ${finalStats.hiring}`)
console.log(`Hiring commerciale (strict): ${finalStats.commercialeStrict}`)

if (finalStats.samples.length) {
  console.log('\nEsempi commerciale strict:')
  for (const s of finalStats.samples) {
    console.log(`  • ${s.azienda} | ${s.telefono} | ${s.source} | ${s.offer}`)
  }
}

let passed = true
const checks = []

if (finalStatus !== 'completed') {
  checks.push(['Job completed', false, finalStatus])
  passed = false
} else {
  checks.push(['Job completed', true, ''])
}

checks.push(['Lead >= 8', finalStats.leads >= 8, `${finalStats.leads}`])
checks.push(['Contact >= 70%', finalStats.contact >= Math.floor(finalStats.leads * 0.7), `${finalStats.contact}`])
checks.push(['External enrich >= 10', finalStats.external >= 10, `${finalStats.external}`])
checks.push(['Hiring >= 1', finalStats.hiring >= 1, `${finalStats.hiring}`])
checks.push(['Commerciale strict >= 1', finalStats.commercialeStrict >= 1, `${finalStats.commercialeStrict}`])

for (const [name, ok, detail] of checks) {
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` (${detail})` : ''}`)
  if (!ok) passed = false
}

console.log(`\n${passed ? '✓ E2E PASS' : '✗ E2E FAIL — non 100%'}`)
process.exit(passed ? 0 : 1)
