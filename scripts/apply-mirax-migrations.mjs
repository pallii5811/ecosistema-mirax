#!/usr/bin/env node
/**
 * Applica migration MIRAX (idempotente — salta "already exists").
 * Usage: npm run db:apply-mirax
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { connectMiraxDb, isBenignMigrationError, loadMiraxDbPassword } from './lib/mirax-db.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const files = [
  'db/migrations/2026_07_01_lead_business_signals.sql',
  'db/migrations/2026_07_01_compliance_checks.sql',
  'db/migrations/2026_09_01_inbound_reply_classifications.sql',
  'db/migrations/2026_10_01_gmail_connections.sql',
  'db/migrations/2026_11_01_signal_intent_expand.sql',
  'db/migrations/2026_11_02_list_leads_foreign_keys.sql',
  'db/migrations/2026_12_01_signal_quality.sql',
  'db/migrations/2026_12_02_research_cache.sql',
  'db/migrations/2026_12_03_signal_relationships.sql',
  'db/migrations/2026_12_04_realtime_business_signals.sql',
  'db/migrations/2026_12_05_outbound_queue.sql',
  'db/migrations/2026_12_06_competitors.sql',
  'db/migrations/2026_12_07_crm_auto_sync.sql',
  'db/migrations/2026_07_02_universe_entities.sql',
  'db/migrations/2026_07_03_universe_realtime_analytics.sql',
  'db/migrations/2026_07_04_universe_scale.sql',
  'db/migrations/2026_07_05_universe_webhooks_ranking.sql',
  'db/migrations/2026_07_06_universe_idempotency.sql',
  'db/migrations/2026_07_07_universe_event_idempotency.sql',
  'db/migrations/2026_07_08_search_job_leases.sql',
  'db/migrations/2026_07_09_investing_marketing_signal.sql',
  'db/migrations/2026_12_08_universe_rls_hardening.sql',
  'db/migrations/2026_12_09_universe_relationship_dedup.sql',
  'db/migrations/2026_12_10_universe_website_snapshots.sql',
  'db/migrations/2026_12_11_searches_realtime.sql',
  'db/migrations/2026_12_20_kg_relations_expansion.sql',
  'db/migrations/2026_12_21_user_feedback.sql',
  'db/migrations/2026_12_22_pii_access_log.sql',
  'db/migrations/2026_12_23_observation_text_search.sql',
  'db/migrations/2026_12_24_searches_intent.sql',
  'db/migrations/2026_12_25_crm_installed_signal.sql',
  'db/migrations/2026_07_10_normalization.sql',
  'db/migrations/2026_07_11_commercial_research_lifecycle.sql',
  'db/migrations/2026_07_12_atomic_cost_governor.sql',
  'db/migrations/2026_07_12_evidence_entity_contract.sql',
  'db/migrations/2026_07_12_publication_credit_ledger.sql',
  'db/migrations/2026_07_12_evaluation_canary_framework.sql',
  'db/migrations/2026_07_13_v5_evaluation_dataset.sql',
  'db/migrations/2026_07_13_shadow_candidate_isolation.sql',
  'db/migrations/2026_07_14_atomic_publication_credit.sql',
]

const onlyArg = process.argv.find((value) => value.startsWith('--only='))
const requestedOnly = onlyArg ? onlyArg.slice('--only='.length).trim() : ''
const selectedFiles = requestedOnly
  ? files.filter((file) => file === requestedOnly || path.basename(file) === requestedOnly)
  : files
if (requestedOnly && selectedFiles.length !== 1) {
  throw new Error(`Unknown or ambiguous migration requested with --only=${requestedOnly}`)
}

if (!loadMiraxDbPassword()) {
  console.error('Manca ECOSISTEMA_DB_PASSWORD in .env.local o .env.ecosistema.secrets')
  process.exit(1)
}

async function applyFile(client, relPath) {
  const full = path.join(ROOT, relPath)
  if (!fs.existsSync(full)) throw new Error(`Missing ${relPath}`)
  console.log('Applying', relPath)
  try {
    await client.query(fs.readFileSync(full, 'utf8'))
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (isBenignMigrationError(msg)) {
      console.warn(`  ⚠ già applicato — skip (${msg.split('\n')[0]})`)
      return
    }
    throw e
  }
}

try {
  const client = await connectMiraxDb()
  console.log('Connected to Supabase dev DB')
  for (const f of selectedFiles) await applyFile(client, f)
  console.log('\n✅ MIRAX migrations applied (idempotente)')
  await client.end()
} catch (e) {
  console.error('Errore apply MIRAX migrations:', e.message)
  process.exit(1)
}
