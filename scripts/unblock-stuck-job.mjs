#!/usr/bin/env node
/** Sblocca job processing e avvia enrichment parallelo. */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { createClient } from '@supabase/supabase-js'

const JOB_ID = process.argv[2] || 'b3593264-d378-4ec9-8f46-ca468b32b65d'
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
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

const env = loadEnv()
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
const BACKEND = (env.BACKEND_URL || 'http://116.203.137.39:8002').replace(/\/+$/, '')

const { data: row } = await sb.from('searches').select('*').eq('id', JOB_ID).single()
if (!row) {
  console.error('Job not found')
  process.exit(1)
}

const results = Array.isArray(row.results) ? row.results : []
const intent = {
  ...(row.intent && typeof row.intent === 'object' ? row.intent : {}),
  query: 'agenzie marketing a Milano che stanno assumendo commerciali',
  original_query: 'agenzie marketing a Milano che stanno assumendo commerciali',
  hiring_roles: ['commerciale'],
  target_profile: {
    ...(row.intent?.target_profile || {}),
    roles: ['commerciale'],
    industries: ['Agenzie Di Marketing'],
    locations: ['Milano'],
  },
  signals: [{ type: 'hiring', params: { role: 'commerciale', roles: ['commerciale'] } }],
}

console.log('Job', JOB_ID, 'status', row.status, 'leads', results.length)

await sb
  .from('searches')
  .update({ status: 'completed', intent, results })
  .eq('id', JOB_ID)

console.log('→ marked completed, intent fixed with role commerciale')

const pending = results.filter((l) => !l?.business_events_external_at)
console.log('Pending external enrich:', pending.length)

try {
  const res = await fetch(`${BACKEND}/enrich-hiring-batch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      leads: pending.slice(0, 120),
      location: row.location || 'Milano',
      intent,
    }),
    signal: AbortSignal.timeout(600_000),
  })
  const body = await res.json().catch(() => ({}))
  console.log('enrich-hiring-batch:', res.status, body)

  if (body?.leads && Array.isArray(body.leads)) {
    const merged = results.map((l) => {
      const hit = body.leads.find((x) => x?.azienda === l?.azienda && x?.telefono === l?.telefono)
      return hit || l
    })
    await sb.from('searches').update({ results: merged }).eq('id', JOB_ID)
    console.log('→ results updated from batch enrich')
  }
} catch (e) {
  console.error('Batch enrich error (worker will continue in bg):', e.message)
}

console.log('Done — refresh dashboard')
