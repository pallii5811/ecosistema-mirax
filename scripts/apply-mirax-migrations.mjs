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
]

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
  for (const f of files) await applyFile(client, f)
  console.log('\n✅ MIRAX migrations applied (idempotente)')
  await client.end()
} catch (e) {
  console.error('Errore apply MIRAX migrations:', e.message)
  process.exit(1)
}
