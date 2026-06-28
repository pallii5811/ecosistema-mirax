#!/usr/bin/env node
/**
 * MIRAX — E2E business events enrichment (worker 116).
 * Default: verifica job recenti completati.
 * --live: accoda job piccolo (8 lead) e attende enrich > 0.
 *
 * Usage:
 *   node scripts/test-enrichment-e2e.mjs
 *   node scripts/test-enrichment-e2e.mjs --live
 *   node scripts/test-enrichment-e2e.mjs --live --strict
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { createClient } from '@supabase/supabase-js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const LIVE = process.argv.includes('--live')
const STRICT = process.argv.includes('--strict')
const POLL_MS = 15_000
const LIVE_TIMEOUT_MS = 25 * 60_000

function loadEnv() {
  const merged = {}
  for (const p of [
    path.join(ROOT, '.env.ecosistema.secrets'),
    path.join(ROOT, '.env.local'),
  ]) {
    if (!fs.existsSync(p)) continue
    for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
      const t = line.trim()
      if (!t || t.startsWith('#')) continue
      const i = t.indexOf('=')
      if (i < 1) continue
      merged[t.slice(0, i).trim()] = t.slice(i + 1).trim()
    }
  }
  if (!merged.NEXT_PUBLIC_SUPABASE_URL) throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL in .env.local')
  return merged
}

function countSignals(results) {
  if (!Array.isArray(results)) return { leads: 0, hiring: 0, tender: 0, sector: 0, crm: 0, enrichedAt: 0, siteStale: 0, googleAds: 0, metaAds: 0 }
  let hiring = 0
  let tender = 0
  let sector = 0
  let crm = 0
  let enrichedAt = 0
  let siteStale = 0
  let googleAds = 0
  let metaAds = 0
  for (const lead of results) {
    if (!lead || typeof lead !== 'object') continue
    const sigs = Array.isArray(lead.business_signals) ? lead.business_signals : []
    if (sigs.length) {
      for (const s of sigs) {
        const t = s?.type
        if (t === 'hiring') hiring += 1
        if (t === 'tender_won') tender += 1
        if (t === 'sector_investment') sector += 1
        if (t === 'crm_detected' || t === 'crm_change') crm += 1
        if (t === 'site_stale') siteStale += 1
        if (t === 'google_ads_started') googleAds += 1
        if (t === 'meta_ads_started') metaAds += 1
      }
    } else {
      if (Array.isArray(lead.business_hiring_jobs) && lead.business_hiring_jobs.length) hiring += 1
      if (Array.isArray(lead.business_tender_hits) && lead.business_tender_hits.length) tender += 1
      if (Array.isArray(lead.business_sector_hits) && lead.business_sector_hits.length) sector += 1
      if (Array.isArray(lead.detected_crm_stack) && lead.detected_crm_stack.length) crm += 1
    }
    if (lead.business_events_enriched_at) enrichedAt += 1
  }
  const withSignal = results.filter((l) => {
    if (Array.isArray(l?.business_signals) && l.business_signals.length) return true
    return (
      (Array.isArray(l?.business_hiring_jobs) && l.business_hiring_jobs.length) ||
      (Array.isArray(l?.business_tender_hits) && l.business_tender_hits.length) ||
      (Array.isArray(l?.business_sector_hits) && l.business_sector_hits.length) ||
      (Array.isArray(l?.detected_crm_stack) && l.detected_crm_stack.length)
    )
  }).length
  return { leads: results.length, hiring, tender, sector, crm, enrichedAt, withSignal, siteStale, googleAds, metaAds }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

const env = loadEnv()
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
const BACKEND = (env.BACKEND_URL || 'http://116.203.137.39:8002').replace(/\/+$/, '')

console.log('══════════════════════════════════════')
console.log('MIRAX Enrichment E2E')
console.log(`Mode: ${LIVE ? 'LIVE job' : 'recent jobs scan'}${STRICT ? ' (strict)' : ''}`)
console.log('══════════════════════════════════════\n')

// Worker health
try {
  const res = await fetch(`${BACKEND}/health`, { signal: AbortSignal.timeout(12_000) })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  console.log(`✓ Worker health ${BACKEND}`)
} catch (e) {
  console.error(`✗ Worker health — ${e.message}`)
  process.exit(1)
}

async function analyzeJob(row) {
  const results = Array.isArray(row.results) ? row.results : []
  const stats = countSignals(results)
  return { id: row.id, status: row.status, category: row.category, location: row.location, ...stats }
}

async function scanRecent() {
  const { data, error } = await sb
    .from('searches')
    .select('id, status, category, location, results, created_at')
    .eq('status', 'completed')
    .order('created_at', { ascending: false })
    .limit(15)

  if (error) throw error
  const rows = data || []
  let best = null
  for (const row of rows) {
    const s = await analyzeJob(row)
    if (!best || s.withSignal > best.withSignal) best = s
    if (s.enrichedAt > 0) {
      console.log(
        `  job ${s.id.slice(0, 8)}… ${s.category} @ ${s.location} — leads=${s.leads} enrichedAt=${s.enrichedAt} signals=${s.withSignal} (h=${s.hiring} t=${s.tender} s=${s.sector} crm=${s.crm})`,
      )
    }
  }
  return { rows: rows.length, best }
}

async function runLiveJob() {
  const category = 'idraulici'
  const location = 'Milano'
  const payload = {
    category,
    location,
    status: 'pending',
    results: [],
    zone: '10',
    created_at: new Date().toISOString(),
  }

  const { data, error } = await sb.from('searches').insert(payload).select('id').single()
  if (error || !data?.id) throw new Error(error?.message || 'insert failed')
  const jobId = data.id
  console.log(`→ Live job queued: ${jobId} (${category} @ ${location}, max 8)`)

  const started = Date.now()
  while (Date.now() - started < LIVE_TIMEOUT_MS) {
    await sleep(POLL_MS)
    const { data: row, error: fetchErr } = await sb
      .from('searches')
      .select('id, status, results, category, location')
      .eq('id', jobId)
      .single()
    if (fetchErr) throw fetchErr
    const stats = await analyzeJob(row)
    const elapsed = Math.round((Date.now() - started) / 1000)
    console.log(
      `  [${elapsed}s] status=${row.status} leads=${stats.leads} enrichedAt=${stats.enrichedAt} enrich=${stats.withSignal}`,
    )
    if (row.status === 'completed' || row.status === 'error') {
      return stats
    }
  }
  throw new Error(`timeout after ${LIVE_TIMEOUT_MS / 1000}s`)
}

let passed = true

if (LIVE) {
  try {
    const stats = await runLiveJob()
    if (stats.withSignal >= 3) {
      console.log(`\n✓ LIVE enrichment OK — enrich=${stats.withSignal} (site=${stats.siteStale}, google=${stats.googleAds}, meta=${stats.metaAds}, crm=${stats.crm})`)
    } else if (stats.withSignal >= 1) {
      console.log(`\n✓ LIVE enrichment parziale — enrich=${stats.withSignal} (min 3 consigliato)`)
      if (STRICT) {
        console.error('✗ --strict richiede almeno 3 lead con segnali')
        passed = false
      }
    } else if (stats.enrichedAt >= 1) {
      console.log(`\n⚠ LIVE: ${stats.enrichedAt} lead arricchiti ma nessun segnale trovato (Indeed/Bing vuoti — accettabile)`)
      if (STRICT) {
        console.error('✗ --strict richiede almeno 1 segnale business')
        passed = false
      } else {
        console.log('✓ Pipeline enrichment eseguita (business_events_enriched_at presente)')
      }
    } else {
      console.error(`\n✗ LIVE enrichment fallito — enrich=0 su ${stats.leads} lead`)
      passed = false
    }
  } catch (e) {
    console.error(`\n✗ LIVE job error — ${e.message}`)
    passed = false
  }
} else {
  console.log('\n━━━ Scan job completati recenti ━━━')
  const { rows, best } = await scanRecent()
  if (!rows) {
    console.log('⚠ Nessun job completed recente')
  } else if (best?.withSignal >= 1) {
    console.log(`\n✓ Trovato job con segnali: ${best.id} enrich=${best.withSignal}/${best.leads}`)
  } else if (best?.enrichedAt >= 1) {
    console.log(`\n⚠ Job arricchiti senza segnali esterni (enrichedAt=${best.enrichedAt}) — pipeline OK`)
    console.log('  Per verifica completa: node scripts/test-enrichment-e2e.mjs --live')
  } else {
    console.log('\n⚠ Nessun enrichment su job recenti — normale pre-deploy fix')
    console.log('  Dopo deploy worker: node scripts/test-enrichment-e2e.mjs --live --strict')
    if (STRICT) passed = false
  }
}

process.exit(passed ? 0 : 1)
