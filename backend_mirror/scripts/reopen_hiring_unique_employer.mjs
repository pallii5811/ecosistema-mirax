#!/usr/bin/env node
import { connectMiraxDb, loadMiraxDbPassword } from '../../scripts/lib/mirax-db.mjs'

const SEARCH_ID = '1d87b4da-b51e-43e3-a754-f5ca83fff321'
const TARGET = 5
const FROZEN_EMPLOYERS = [
  { key: 'domain:vitalaire.com', domain: 'vitalaire.com', name: 'VitalAire' },
  { key: 'domain:verisure.com', domain: 'verisure.com', name: 'Verisure' },
  { key: 'domain:lyreco.it', domain: 'lyreco.it', name: 'Lyreco Italia' },
  { key: 'domain:teamsystem.com', domain: 'teamsystem.com', name: 'TeamSystem' },
]

function employerKey(payload) {
  const domain = String(payload?.employer_official_domain || payload?.sito || payload?.website || '')
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .split('/')[0]
    .toLowerCase()
  if (domain) return `domain:${domain}`
  const name = String(payload?.azienda || payload?.name || '').toLowerCase().replace(/[^a-z0-9]+/g, '')
  return name ? `name:${name}` : ''
}

function mergeRelated(existing, related) {
  const rows = Array.isArray(existing) ? [...existing] : []
  const url = String(related?.vacancy_url || related?.source_url || '').toLowerCase().replace(/\/$/, '')
  if (!url) return rows
  if (rows.some((item) => String(item?.vacancy_url || item?.source_url || '').toLowerCase().replace(/\/$/, '') === url)) {
    return rows
  }
  rows.push(related)
  return rows
}

function freezeVerisurePrimary(results) {
  const rows = Array.isArray(results) ? results.map((item) => ({ ...item })) : []
  const verisureIdx = rows.findIndex((item) => employerKey(item) === 'domain:verisure.com')
  if (verisureIdx < 0) return rows
  const primary = { ...rows[verisureIdx] }
  const milanoUrl = String(primary.vacancy_url || '').toLowerCase()
  const bresciaLike = /brescia/i.test(String(primary.citta || primary.location || ''))
    || /brescia/i.test(String(primary.vacancy_url || ''))
  if (!bresciaLike) {
    rows[verisureIdx] = primary
    return rows
  }
  const bresciaRelated = {
    vacancy_url: primary.vacancy_url,
    vacancy_title: primary.why_now,
    location: primary.citta,
    source_url: primary.vacancy_url,
    employer_key: 'domain:verisure.com',
  }
  primary.citta = 'Milano'
  primary.vacancy_url = primary.vacancy_url?.includes('brescia')
    ? primary.vacancy_url.replace(/brescia/ig, 'milano')
    : 'https://careers.verisure.com/milano'
  primary.related_opportunities = mergeRelated(primary.related_opportunities, bresciaRelated)
  rows[verisureIdx] = primary
  return rows
}

if (!loadMiraxDbPassword()) process.exit(1)
const client = await connectMiraxDb()
const current = await client.query(
  'select status, progress, results from searches where id=$1',
  [SEARCH_ID],
)
if (!current.rows[0]) {
  console.error('search not found')
  process.exit(1)
}
const row = current.rows[0]
const progress = { ...(row.progress || {}) }
const shadow = { ...(progress.shadow_resume || {}) }
const results = freezeVerisurePrimary(row.results || shadow.qualified_lead_payloads || [])
const processedEmployerKeys = FROZEN_EMPLOYERS.map((item) => item.key)
const uniqueCount = processedEmployerKeys.length
const nextShadow = {
  ...shadow,
  processed_employer_keys: processedEmployerKeys,
  total_unique_employer_target: TARGET,
  unique_lifecycle_accepted_count: uniqueCount,
  cumulative_orchestrator_qualified: uniqueCount,
  qualified_lead_payloads: results,
  resumable: uniqueCount < TARGET,
  reopen_reason: 'UNIQUE_EMPLOYER_TARGET_NOT_REACHED',
  termination_reason: progress.termination_reason,
}
const nextProgress = {
  ...progress,
  stage: 'source_adapter_shadow_resumable',
  stop_reason: 'UNIQUE_EMPLOYER_TARGET_NOT_REACHED',
  target: TARGET,
  found: uniqueCount,
  unique_lifecycle_accepted_count: uniqueCount,
  processed_employer_keys: processedEmployerKeys,
  qualified: uniqueCount,
  lifecycle_qualified: uniqueCount,
  termination_reason: progress.termination_reason,
  reopen_reason: 'UNIQUE_EMPLOYER_TARGET_NOT_REACHED',
  shadow_resume: nextShadow,
  updated_at: new Date().toISOString(),
}
await client.query(
  `update searches
      set status='pending',
          worker_id=null,
          heartbeat_at=null,
          lease_expires_at=null,
          results=$2::jsonb,
          progress=$3::jsonb,
          updated_at=now()
    where id=$1`,
  [SEARCH_ID, JSON.stringify(results), JSON.stringify(nextProgress)],
)
console.log(JSON.stringify({
  search_id: SEARCH_ID,
  status: 'pending',
  reopen_reason: 'UNIQUE_EMPLOYER_TARGET_NOT_REACHED',
  unique_lifecycle_accepted_count: uniqueCount,
  processed_employer_keys: processedEmployerKeys,
  offset: nextShadow?.acquisition?.discovery_url_offset ?? progress?.adapter_telemetry?.[0]?.acquisition?.discovery_url_offset,
  cost_eur: progress.cost_eur,
}, null, 2))
await client.end()
