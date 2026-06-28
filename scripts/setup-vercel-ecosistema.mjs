#!/usr/bin/env node
/**
 * Setup progetto Vercel SEPARATO da Mirax produzione.
 * Crea/collega "ecosistema-mirax", sincronizza env da .env.local, deploy.
 *
 * Uso: node scripts/setup-vercel-ecosistema.mjs [--deploy] [--dry-run]
 *
 * NON tocca il progetto Vercel di miraxgroup.it / produzione.
 */
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { execSync, spawnSync } from 'child_process'
import { fileURLToPath } from 'url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ENV_PATH = path.join(ROOT, '.env.local')
const PROJECT_NAME = 'ecosistema-mirax'
const PROD_SUPABASE_HOST = 'rtjmnjromqpsfqsgyfvp.supabase.co'
const args = new Set(process.argv.slice(2))
const dryRun = args.has('--dry-run')
const doDeploy = args.has('--deploy') || !args.has('--no-deploy')

const SKIP_KEYS = new Set([
  'ECOSISTEMA_DB_PASSWORD',
  'NODE_TLS_REJECT_UNAUTHORIZED',
])

const REQUIRED_KEYS = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'BACKEND_URL',
  'OPENAI_API_KEY',
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

function upsertEnvLine(lines, key, value) {
  const idx = lines.findIndex((l) => l.startsWith(`${key}=`))
  const row = `${key}=${value}`
  if (idx >= 0) lines[idx] = row
  else lines.push(row)
}

function run(cmd, opts = {}) {
  console.log(`\n$ ${cmd}`)
  if (dryRun) return ''
  return execSync(cmd, { cwd: ROOT, stdio: opts.inherit ? 'inherit' : 'pipe', encoding: 'utf8', ...opts })
}

if (!fs.existsSync(ENV_PATH)) {
  console.error('Manca .env.local — esegui prima npm run setup:ecosistema')
  process.exit(1)
}

let envLines = fs.readFileSync(ENV_PATH, 'utf8').split(/\r?\n/)
let env = parseEnv(envLines.join('\n'))

const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL || ''
if (supabaseUrl.includes(PROD_SUPABASE_HOST)) {
  console.error('❌ BLOCCATO: .env.local punta a Supabase PRODUZIONE. Usa solo chiavi dev.')
  process.exit(1)
}

for (const k of REQUIRED_KEYS) {
  if (!env[k]) {
    console.error(`❌ Manca ${k} in .env.local`)
    process.exit(1)
  }
}

if (!env.BACKEND_URL?.includes('8002')) {
  console.warn('⚠️  BACKEND_URL dovrebbe essere staging :8002')
}

if (!env.CRON_SECRET) {
  env.CRON_SECRET = 'mx_cron_' + crypto.randomBytes(24).toString('hex')
  upsertEnvLine(envLines, 'CRON_SECRET', env.CRON_SECRET)
  fs.writeFileSync(ENV_PATH, envLines.filter((l, i, a) => l !== '' || i < a.length - 1).join('\n') + '\n')
  console.log('✅ Generato CRON_SECRET in .env.local')
}

console.log(`\n═══ Vercel progetto: ${PROJECT_NAME} (ecosistema dev, NON mirax prod) ═══`)

try {
  run(`vercel project ls`, { inherit: true })
} catch {
  console.warn('vercel project ls fallito — verifica login: vercel whoami')
}

try {
  run(`vercel project add ${PROJECT_NAME}`, { inherit: true })
} catch {
  console.log(`(progetto ${PROJECT_NAME} potrebbe esistere già)`)
}

run(`vercel link --yes --project ${PROJECT_NAME}`, { inherit: true })

const pushKeys = Object.keys(env).filter((k) => !SKIP_KEYS.has(k) && env[k])
const environments = ['production', 'preview', 'development']

function addEnv(key, target, value) {
  if (dryRun) {
    console.log(`[dry-run] env ${key} -> ${target}`)
    return true
  }
  try {
    execSync(`vercel env rm ${key} ${target} --yes`, { cwd: ROOT, stdio: 'pipe' })
  } catch {
    // not set
  }
  const res = spawnSync('vercel', ['env', 'add', key, target], {
    cwd: ROOT,
    input: value,
    encoding: 'utf8',
    shell: process.platform === 'win32',
  })
  if (res.status !== 0) {
    console.error(`❌ env ${key} (${target}):`, (res.stderr || res.stdout || '').slice(0, 200))
    return false
  }
  console.log(`✅ env ${key} (${target})`)
  return true
}

for (const key of pushKeys) {
  const value = env[key]
  for (const target of environments) {
    addEnv(key, target, value)
  }
}

if (doDeploy && !dryRun) {
  console.log('\n═══ Deploy produzione Vercel (ecosistema-mirax) ═══')
  const out = run('vercel deploy --prod --yes', { inherit: true })
  console.log(out || '')
  console.log('\nDopo il deploy: aggiorna NEXT_PUBLIC_SITE_URL con l\'URL Vercel assegnato.')
  console.log('Stripe webhook: crea endpoint TEST su nuovo dominio Vercel (non miraxgroup.it).')
  console.log('Supabase Auth → URL Configuration → aggiungi Site URL e redirect:', 'https://ecosistema-mirax.vercel.app')
} else if (!dryRun) {
  console.log('\nSalto deploy (usa --deploy per forzare).')
}

console.log('\n✅ Setup Vercel ecosistema completato.')
console.log('Dashboard:', `https://vercel.com/simonedrop21-8016s-projects/${PROJECT_NAME}`)
