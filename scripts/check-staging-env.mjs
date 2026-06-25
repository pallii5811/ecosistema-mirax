#!/usr/bin/env node
/**
 * Verifica che .env.local staging non punti a produzione.
 * Uso: node scripts/check-staging-env.mjs
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ENV_PATH = path.join(ROOT, '.env.local')
const PROD_SUPABASE_HOST = 'rtjmnjromqpsfqsgyfvp.supabase.co'
const STAGING_BACKEND = '116.203.137.39:8002'

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

if (!fs.existsSync(ENV_PATH)) {
  console.error('Manca .env.local — copia da .env.staging.example e compila le chiavi DEV.')
  process.exit(1)
}

const env = parseEnv(fs.readFileSync(ENV_PATH, 'utf8'))
let ok = true

const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL || env.SUPABASE_URL || ''
if (!supabaseUrl || supabaseUrl.includes('YOUR_DEV')) {
  console.error('❌ NEXT_PUBLIC_SUPABASE_URL non configurato')
  ok = false
} else if (supabaseUrl.includes(PROD_SUPABASE_HOST)) {
  console.error('❌ PERICOLO: .env.local punta ancora a Supabase PRODUZIONE')
  ok = false
} else {
  console.log('✅ Supabase URL dev:', supabaseUrl.replace(/https?:\/\//, '').split('.')[0] + '.…')
}

const backend = env.BACKEND_URL || ''
if (!backend.includes('116.203.137.39') || !backend.includes('8002')) {
  console.warn('⚠️  BACKEND_URL dovrebbe essere http://116.203.137.39:8002 — attuale:', backend || '(default codice)')
} else {
  console.log('✅ BACKEND_URL staging:', backend)
}

for (const key of ['NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY']) {
  if (!env[key] || env[key].includes('your_dev')) {
    console.error(`❌ ${key} mancante`)
    ok = false
  }
}

if (ok) {
  console.log('\nOK — puoi avviare npm run dev dalla cartella Dev.')
} else {
  console.log('\nCorreggi .env.local prima di sviluppare.')
  process.exit(1)
}
