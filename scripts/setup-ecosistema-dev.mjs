#!/usr/bin/env node
/**
 * Setup Blocco 0 — merge secrets, patch .env.local, apply DB, verify.
 * Uso: node scripts/setup-ecosistema-dev.mjs
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { execSync } from 'child_process'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DEV_REF = 'ktspchugdwpqvxhmysap'
const DEV_URL = `https://${DEV_REF}.supabase.co`
const SECRETS_PATH = path.join(ROOT, '.env.ecosistema.secrets')
const ENV_PATH = path.join(ROOT, '.env.local')

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

function upsertEnvLine(lines, key, value) {
  const idx = lines.findIndex((l) => l.startsWith(`${key}=`))
  const row = `${key}=${value}`
  if (idx >= 0) lines[idx] = row
  else lines.push(row)
}

if (!fs.existsSync(SECRETS_PATH)) {
  console.error('Crea .env.ecosistema.secrets da .env.ecosistema.secrets.example')
  console.error('Dashboard API:', `https://supabase.com/dashboard/project/${DEV_REF}/settings/api`)
  process.exit(1)
}

const secrets = parseEnv(fs.readFileSync(SECRETS_PATH, 'utf8'))
const required = ['NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY']
for (const k of required) {
  if (!secrets[k]) {
    console.error(`Manca ${k} in .env.ecosistema.secrets`)
    process.exit(1)
  }
}

let lines = fs.existsSync(ENV_PATH)
  ? fs.readFileSync(ENV_PATH, 'utf8').split(/\r?\n/)
  : fs.readFileSync(path.join(ROOT, '.env.staging.example'), 'utf8').split(/\r?\n/)

upsertEnvLine(lines, 'NEXT_PUBLIC_SUPABASE_URL', DEV_URL)
upsertEnvLine(lines, 'NEXT_PUBLIC_SUPABASE_ANON_KEY', secrets.NEXT_PUBLIC_SUPABASE_ANON_KEY)
upsertEnvLine(lines, 'SUPABASE_SERVICE_ROLE_KEY', secrets.SUPABASE_SERVICE_ROLE_KEY)
upsertEnvLine(lines, 'BACKEND_URL', 'http://116.203.137.39:8002')
upsertEnvLine(lines, 'NEXT_PUBLIC_SITE_URL', 'http://localhost:3000')

if (secrets.ECOSISTEMA_DB_PASSWORD) {
  upsertEnvLine(lines, 'ECOSISTEMA_DB_PASSWORD', secrets.ECOSISTEMA_DB_PASSWORD)
}

fs.writeFileSync(ENV_PATH, lines.filter((l, i, a) => l !== '' || i < a.length - 1).join('\n') + '\n')
console.log('✅ .env.local aggiornato per ecosistema dev')

if (secrets.ECOSISTEMA_DB_PASSWORD) {
  console.log('\nApplico schema database…')
  execSync('node scripts/apply-dev-database.mjs', { cwd: ROOT, stdio: 'inherit' })
} else {
  console.warn('\n⚠️  ECOSISTEMA_DB_PASSWORD mancante — salto apply DB')
  console.warn('   Oppure incolla db/bootstrap/*.sql nel SQL Editor Supabase')
}

console.log('\nVerifica env…')
try {
  execSync('node scripts/check-staging-env.mjs', { cwd: ROOT, stdio: 'inherit' })
} catch {
  process.exit(1)
}

console.log(`
Prossimi passi manuali:
1. Supabase Auth → crea utente test
2. npm run dev
3. Sul server 116, aggiorna /home/worker/app/backend-staging/.env con le stesse chiavi dev
4. systemctl enable --now mirax-worker-staging
`)
