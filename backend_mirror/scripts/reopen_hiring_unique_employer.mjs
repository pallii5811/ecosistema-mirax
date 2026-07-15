#!/usr/bin/env node
/**
 * Restore + reopen hiring search after accidental shadow-disabled wipe.
 * Preserves cost/offset/seen URLs and freezes Verisure Milano as primary.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Buffer } from 'node:buffer'
import { connectMiraxDb, loadMiraxDbPassword } from '../../scripts/lib/mirax-db.mjs'

const SEARCH_ID = '1d87b4da-b51e-43e3-a754-f5ca83fff321'
const TARGET = 5
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const CURSOR_PATH = path.join(ROOT, 'backend_mirror/fixtures/hiring_search_1d87b4da_cursor.json')
const MILANO_URL = 'https://careers.verisure.com/it/it/job/r2022100220/consulente-commerciale-milano'
const BRESCIA_URL = 'https://careers.verisure.com/it/it/job/r2021120311/commerciale-con-benefit-auto-brescia'

function employerKey(payload) {
  const domain = String(payload?.employer_official_domain || payload?.sito || payload?.website || '')
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .split('/')[0]
    .toLowerCase()
  return domain ? `domain:${domain}` : ''
}

function encodeCursor(state) {
  const json = Buffer.from(JSON.stringify(state), 'utf8').toString('base64url')
  return `hiring:v2:${json}`
}

if (!loadMiraxDbPassword()) process.exit(1)
const client = await connectMiraxDb()

const cursorState = JSON.parse(fs.readFileSync(CURSOR_PATH, 'utf8'))
cursorState.url_offset = 106
cursorState.discovery_url_offset = 106
cursorState.parser_epoch = Math.max(2, Number(cursorState.parser_epoch || 0) || 2)
cursorState.qualification_validator_epoch = Math.max(2, Number(cursorState.qualification_validator_epoch || 0) || 2)
const resumeCursor = encodeCursor(cursorState)

const candidates = await client.query(
  `select payload from search_candidates where search_id=$1 order by created_at nulls last`,
  [SEARCH_ID],
)
if (candidates.rows.length < 4) {
  console.error('expected >=4 candidates, got', candidates.rows.length)
  process.exit(1)
}

const byDomain = new Map()
for (const row of candidates.rows) {
  const payload = { ...(row.payload || {}) }
  const key = employerKey(payload)
  if (!key) continue
  byDomain.set(key, payload)
}

const verisure = byDomain.get('domain:verisure.com')
if (verisure) {
  const bresciaRelated = {
    vacancy_url: BRESCIA_URL,
    vacancy_title: 'Commerciale con benefit auto Brescia',
    location: 'Brescia, Italy',
    source_url: BRESCIA_URL,
    employer_key: 'domain:verisure.com',
  }
  verisure.citta = 'Milano'
  verisure.vacancy_url = MILANO_URL
  verisure.why_now = verisure.why_now?.includes('Brescia')
    ? 'Vacancy attiva per CONSULENTE COMMERCIALE - MILANO'
    : (verisure.why_now || 'Vacancy attiva Verisure Milano')
  const related = Array.isArray(verisure.related_opportunities) ? [...verisure.related_opportunities] : []
  if (!related.some((item) => String(item?.vacancy_url || '').includes('brescia'))) {
    related.push(bresciaRelated)
  }
  verisure.related_opportunities = related
  byDomain.set('domain:verisure.com', verisure)
}

const orderedKeys = [
  'domain:vitalaire.com',
  'domain:verisure.com',
  'domain:lyreco.it',
  'domain:teamsystem.com',
]
const results = orderedKeys.map((key) => byDomain.get(key)).filter(Boolean)
if (results.length !== 4) {
  console.error('missing employers', results.map((item) => employerKey(item)))
  process.exit(1)
}

const processedEmployerKeys = orderedKeys
const shadowResume = {
  resumable: true,
  resume_cursors: { structured_hiring_v1: resumeCursor },
  prior_cost_eur: 0.05,
  cumulative_orchestrator_qualified: 4,
  unique_lifecycle_accepted_count: 4,
  processed_employer_keys: processedEmployerKeys,
  total_unique_employer_target: TARGET,
  qualified_lead_payloads: results,
  processed_domains: ['vitalaire.com', 'verisure.com', 'lyreco.it', 'teamsystem.com'],
  acquisition: {
    discovery_url_offset: 106,
    queue_only: true,
    urls_seen: 170,
  },
  reopen_reason: 'UNIQUE_EMPLOYER_TARGET_NOT_REACHED',
  termination_reason: 'UNIQUE_EMPLOYER_TARGET_NOT_REACHED',
  provider_exhausted: false,
}

const progress = {
  stage: 'source_adapter_shadow_resumable',
  stop_reason: 'UNIQUE_EMPLOYER_TARGET_NOT_REACHED',
  reopen_reason: 'UNIQUE_EMPLOYER_TARGET_NOT_REACHED',
  target: TARGET,
  found: 4,
  unique_lifecycle_accepted_count: 4,
  processed_employer_keys: processedEmployerKeys,
  qualified: 4,
  lifecycle_qualified: 4,
  published: 0,
  cost_eur: 0.05,
  provider_exhausted: false,
  termination_reason: 'UNIQUE_EMPLOYER_TARGET_NOT_REACHED',
  selected_adapters: ['structured_hiring_v1'],
  adapter_telemetry: [{
    adapter_id: 'structured_hiring_v1',
    exhausted: false,
    next_cursor: resumeCursor,
    acquisition: shadowResume.acquisition,
  }],
  shadow_resume: shadowResume,
  resume_cursor: resumeCursor,
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
  [SEARCH_ID, JSON.stringify(results), JSON.stringify(progress)],
)

console.log(JSON.stringify({
  search_id: SEARCH_ID,
  status: 'pending',
  reopen_reason: 'UNIQUE_EMPLOYER_TARGET_NOT_REACHED',
  unique_lifecycle_accepted_count: 4,
  processed_employer_keys: processedEmployerKeys,
  offset: 106,
  cost_eur: 0.05,
  verisure_primary: results.find((item) => employerKey(item) === 'domain:verisure.com')?.vacancy_url,
  related: results.find((item) => employerKey(item) === 'domain:verisure.com')?.related_opportunities,
}, null, 2))
await client.end()
