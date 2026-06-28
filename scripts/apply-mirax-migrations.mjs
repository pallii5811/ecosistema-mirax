#!/usr/bin/env node
/**
 * Applica solo le migration MIRAX Fase 1–4 (idempotenti).
 * Usage: npm run db:apply-mirax
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import pg from 'pg'

const { Client } = pg
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DEV_REF = 'ktspchugdwpqvxhmysap'
const ENV_PATH = path.join(ROOT, '.env.local')
const SECRETS_PATH = path.join(ROOT, '.env.ecosistema.secrets')

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
]

function parseEnv(text) {
  const out = {}
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const i = t.indexOf('=')
    if (i < 1) continue
    out[t.slice(0, i).trim()] = t.slice(i + 1).trim()
  }
  return out
}

function loadPassword() {
  for (const p of [ENV_PATH, SECRETS_PATH]) {
    if (!fs.existsSync(p)) continue
    const env = parseEnv(fs.readFileSync(p, 'utf8'))
    if (env.ECOSISTEMA_DB_PASSWORD) return env.ECOSISTEMA_DB_PASSWORD
  }
  return process.env.ECOSISTEMA_DB_PASSWORD
}

const password = loadPassword()
if (!password) {
  console.error('Manca ECOSISTEMA_DB_PASSWORD in .env.local o .env.ecosistema.secrets')
  process.exit(1)
}

const endpoints = [
  { host: `db.${DEV_REF}.supabase.co`, port: 5432, user: 'postgres' },
  { host: 'aws-0-eu-west-1.pooler.supabase.com', port: 5432, user: `postgres.${DEV_REF}` },
  { host: 'aws-0-eu-west-1.pooler.supabase.com', port: 6543, user: `postgres.${DEV_REF}` },
]

async function connectClient() {
  let lastErr
  for (const ep of endpoints) {
    const client = new Client({
      host: ep.host,
      port: ep.port,
      user: ep.user,
      password,
      database: 'postgres',
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 15000,
    })
    try {
      await client.connect()
      console.log(`Connected via ${ep.user}@${ep.host}:${ep.port}`)
      return client
    } catch (e) {
      lastErr = e
      console.warn(`Skip ${ep.host}:${ep.port} —`, e.message)
      try { await client.end() } catch { /* ignore */ }
    }
  }
  throw lastErr || new Error('Nessun endpoint DB raggiungibile')
}

async function applyFile(client, relPath) {
  const full = path.join(ROOT, relPath)
  if (!fs.existsSync(full)) throw new Error(`Missing ${relPath}`)
  console.log('Applying', relPath)
  await client.query(fs.readFileSync(full, 'utf8'))
}

try {
  const client = await connectClient()
  for (const f of files) await applyFile(client, f)
  console.log('\n✅ MIRAX migrations applied (Fase 1–7)')
  await client.end()
} catch (e) {
  console.error('Errore apply MIRAX migrations:', e.message)
  process.exit(1)
}
