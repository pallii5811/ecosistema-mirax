#!/usr/bin/env node
/**
 * Reopen hiring search for Workday CXS retry-only one-shot.
 * No discovery reset; preserves cost, 4 frozen employers, offset=170.
 */
import { connectMiraxDb, loadMiraxDbPassword } from '../../scripts/lib/mirax-db.mjs'
import { Buffer } from 'node:buffer'

const SEARCH_ID = '1d87b4da-b51e-43e3-a754-f5ca83fff321'
const TARGET = 5
const WORKDAY_RETRIES = [
  'https://solenis.wd1.myworkdayjobs.com/en-us/solenis/job/commerciale-junior-b2b--lombardia-_r0028690/apply/applymanually',
  'https://airliquidehr.wd3.myworkdayjobs.com/pl-pl/airliquideexternalcareer/job/commerciale---lombardia-nord_r10094218/apply/autofillwithresume',
  'https://solenis.wd1.myworkdayjobs.com/fr-fr/solenis/job/commerciale-junior-b2b--lombardia-_r0028690/apply/applymanually',
  'https://gsk.wd5.myworkdayjobs.com/en-us/gskcareers/job/area-manager-severe-asthma---nasal-polyps----lombardia_442246',
  'https://jj.wd5.myworkdayjobs.com/jj/job/milano-italy/informatore-scientifico-del-farmaco---immunologia---lombardia--piemonte--tempo-determinato----_r-086249',
  'https://ing.wd3.myworkdayjobs.com/it-it/icsgblcor/job/agente-in-attivit-finanziaria---percorso-beginner_req-10083295',
  'https://convatec.wd1.myworkdayjobs.com/de-de/convatec/job/territory-manager---lombardia_jr00018297',
  'https://moog.wd5.myworkdayjobs.com/fr-fr/moog_external_career_site/job/tecnico-commerciale-oleodinamica-industriale_r-25-15348',
  'https://jj.wd5.myworkdayjobs.com/en-us/jj/job/informatore-scientifico-del-farmaco---immunologia---lombardia--piemonte--tempo-determinato----_r-086249',
  'https://otis.wd5.myworkdayjobs.com/da-dk/rec_ext_gateway/job/tecnici-ascensoristi-manutentori--lombardia_20155906',
]
const PROCESSED_KEYS = [
  'domain:vitalaire.com',
  'domain:verisure.com',
  'domain:lyreco.it',
  'domain:teamsystem.com',
]

if (!loadMiraxDbPassword()) process.exit(1)
const client = await connectMiraxDb()
const current = await client.query('select status, progress, results from searches where id=$1', [SEARCH_ID])
if (!current.rows[0]) {
  console.error('search not found')
  process.exit(1)
}
const row = current.rows[0]
const progress = { ...(row.progress || {}) }
const shadow = { ...(progress.shadow_resume || {}) }
const results = Array.isArray(row.results) && row.results.length
  ? row.results
  : (shadow.qualified_lead_payloads || [])
const tel = Array.isArray(progress.adapter_telemetry) ? [...progress.adapter_telemetry] : []
const first = { ...(tel[0] || {}) }
const cursor = first.next_cursor || shadow.resume_cursors?.structured_hiring_v1 || ''
if (!String(cursor).startsWith('hiring:v2:')) {
  console.error('missing hiring cursor')
  process.exit(1)
}
const state = JSON.parse(Buffer.from(String(cursor).slice('hiring:v2:'.length), 'base64url').toString('utf8'))
state.url_offset = 170
state.discovery_url_offset = 170
state.retry_urls = WORKDAY_RETRIES
state.parser_epoch = Math.max(2, Number(state.parser_epoch || 0) || 2)
state.qualification_validator_epoch = Math.max(2, Number(state.qualification_validator_epoch || 0) || 2)
const encoded = `hiring:v2:${Buffer.from(JSON.stringify(state), 'utf8').toString('base64url')}`
first.next_cursor = encoded
first.exhausted = false
tel[0] = first
const nextShadow = {
  ...shadow,
  resumable: true,
  resume_cursors: { structured_hiring_v1: encoded },
  prior_cost_eur: Number(progress.cost_eur || shadow.prior_cost_eur || 0.05),
  cumulative_orchestrator_qualified: 4,
  unique_lifecycle_accepted_count: 4,
  processed_employer_keys: PROCESSED_KEYS,
  total_unique_employer_target: TARGET,
  qualified_lead_payloads: results,
  processed_domains: ['vitalaire.com', 'verisure.com', 'lyreco.it', 'teamsystem.com'],
  reopen_reason: 'WORKDAY_RETRY_QUEUE_PENDING',
  termination_reason: 'WORKDAY_RETRY_QUEUE_PENDING',
  provider_exhausted: false,
  acquisition: {
    ...(shadow.acquisition || {}),
    discovery_url_offset: 170,
    queue_only: true,
    workday_retry_only: true,
    urls_seen: 170,
  },
}
const nextProgress = {
  ...progress,
  stage: 'source_adapter_shadow_resumable',
  stop_reason: 'WORKDAY_RETRY_QUEUE_PENDING',
  reopen_reason: 'WORKDAY_RETRY_QUEUE_PENDING',
  target: TARGET,
  found: 4,
  unique_lifecycle_accepted_count: 4,
  processed_employer_keys: PROCESSED_KEYS,
  qualified: 4,
  lifecycle_qualified: 4,
  published: 0,
  cost_eur: Number(progress.cost_eur || 0.05),
  provider_exhausted: false,
  termination_reason: 'WORKDAY_RETRY_QUEUE_PENDING',
  selected_adapters: ['structured_hiring_v1'],
  adapter_telemetry: tel,
  shadow_resume: nextShadow,
  resume_cursor: encoded,
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
  reopen_reason: 'WORKDAY_RETRY_QUEUE_PENDING',
  offset: 170,
  retry_urls: WORKDAY_RETRIES.length,
  cost_eur: nextProgress.cost_eur,
  unique: 4,
}, null, 2))
await client.end()
