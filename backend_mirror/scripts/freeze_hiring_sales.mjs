#!/usr/bin/env node
import { connectMiraxDb, loadMiraxDbPassword } from '../../scripts/lib/mirax-db.mjs'

const SEARCH_ID = '1d87b4da-b51e-43e3-a754-f5ca83fff321'
const KEEP = {
  'vitalaire.com': 'VitalAire',
  'verisure.com': 'Verisure',
  'lyreco.it': 'Lyreco Italia',
  'teamsystem.com': 'TeamSystem',
}

function domainOf(item) {
  return String(item?.employer_official_domain || item?.sito || '')
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .split('/')[0]
    .toLowerCase()
}

if (!loadMiraxDbPassword()) process.exit(1)
const c = await connectMiraxDb()
const r = await c.query('select status, results, progress from searches where id=$1', [SEARCH_ID])
const row = r.rows[0]
const results = (row.results || []).filter((item) => KEEP[domainOf(item)])
const otisPresent = (row.results || []).some((item) => domainOf(item) === 'otis.com')
const keys = Object.keys(KEEP).map((d) => `domain:${d}`)
const progress = { ...(row.progress || {}) }
const shadow = { ...(progress.shadow_resume || {}) }
const freeze = {
  capability: 'hiring_sales',
  coverage: 'SUPPORTED_PARTIAL',
  termination_reason: 'partial_sources_exhausted',
  unique_lifecycle_accepted_count: 4,
  cost_eur: Number(progress.cost_eur || 0.05),
  frozen_at: new Date().toISOString(),
  frozen_sha: 'b52443409dfe4e5ced8f0bdcf444bb3fcb4580c8',
  leads: results.map((item) => ({
    azienda: item.azienda,
    official_domain: domainOf(item),
    vacancy_url: item.vacancy_url,
    citta: item.citta,
    why_now: item.why_now,
    related_opportunities: item.related_opportunities || [],
  })),
  rejection_codes: progress.rejection_codes || {},
  query: row.progress?.query || 'hiring_sales Lombardia',
  adapter_id: 'structured_hiring_v1',
}
shadow.qualified_lead_payloads = results
shadow.processed_employer_keys = keys
shadow.unique_lifecycle_accepted_count = 4
shadow.cumulative_orchestrator_qualified = 4
shadow.resumable = false
shadow.termination_reason = 'partial_sources_exhausted'
shadow.hiring_sales_freeze = freeze
progress.shadow_resume = shadow
progress.found = 4
progress.unique_lifecycle_accepted_count = 4
progress.qualified = 4
progress.lifecycle_qualified = 4
progress.processed_employer_keys = keys
progress.stop_reason = 'partial_sources_exhausted'
progress.termination_reason = 'partial_sources_exhausted'
progress.coverage_status = 'SUPPORTED_PARTIAL'
progress.hiring_sales_frozen = true
progress.hiring_sales_freeze = freeze
progress.stage = 'source_adapter_shadow_completed'
progress.updated_at = new Date().toISOString()
await c.query(
  `update searches set status='completed', results=$2::jsonb, progress=$3::jsonb,
          worker_id=null, heartbeat_at=null, lease_expires_at=null, updated_at=now()
    where id=$1`,
  [SEARCH_ID, JSON.stringify(results), JSON.stringify(progress)],
)
console.log(JSON.stringify({
  search_id: SEARCH_ID,
  status: 'completed',
  otis_rejected: !otisPresent && !results.some((item) => domainOf(item) === 'otis.com'),
  unique: results.length,
  domains: results.map(domainOf),
  coverage: 'SUPPORTED_PARTIAL',
  frozen: true,
}, null, 2))
await c.end()
