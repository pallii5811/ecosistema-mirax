#!/usr/bin/env node
/**
 * Verifica tabelle Supabase dev richieste dai Blocchi 1–9.
 */
import fs from 'fs'
import { createClient } from '@supabase/supabase-js'

const env = Object.fromEntries(
  fs
    .readFileSync('.env.local', 'utf8')
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=')
      return [l.slice(0, i), l.slice(i + 1)]
    }),
)

const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

const tables = [
  'searches',
  'lead_pipeline',
  'outreach_log',
  'mirax_events',
  'lead_monitors',
  'lead_alerts',
  'knowledge_objects',
  'crm_integrations',
  'api_keys',
  'ai_audit_trail',
  'lead_business_signals',
  'compliance_checks',
  'inbound_reply_classifications',
  'gmail_connections',
  'competitors',
  'competitor_alerts',
]

const missing = []
const ok = []

for (const table of tables) {
  const { error } = await sb.from(table).select('*', { count: 'exact', head: true })
  if (error) {
    if (/does not exist|schema cache/i.test(error.message)) missing.push(table)
    else ok.push(`${table} (query ok)`)
  } else {
    ok.push(table)
  }
}

console.log('[test-ecosistema-db] OK:', ok.join(', '))
if (missing.length) {
  console.error('[test-ecosistema-db] MISSING — run npm run db:apply-dev:', missing.join(', '))
  process.exit(1)
}
console.log('[test-ecosistema-db] All required tables present')
