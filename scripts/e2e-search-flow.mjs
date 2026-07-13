#!/usr/bin/env node
/**
 * E2E — Flusso ricerca lead come lo vedrebbe un utente.
 *
 * 1. Crea un utente test (o riusa quello esistente).
 * 2. Inserisce un job searches pending.
 * 3. Aspetta che il worker Hetzner lo processi (status completed/error).
 * 4. Verifica che i risultati siano popolati e che i crediti non vengano toccati.
 * 5. Pulisce i dati di test.
 */

import { createClient } from '@supabase/supabase-js'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

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

function loadEnv() {
  for (const p of [path.join(ROOT, '.env.local'), path.join(ROOT, '.env.ecosistema.secrets')]) {
    if (!fs.existsSync(p)) continue
    const env = parseEnv(fs.readFileSync(p, 'utf8'))
    if (env.NEXT_PUBLIC_SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY) return env
  }
  throw new Error('Mancano NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY in .env.local')
}

const env = loadEnv()
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

const TEST_EMAIL = 'e2e-search-flow@mirax.test'
const TEST_PASSWORD = 'E2E-Test-Password-99!'
const TEST_CATEGORY = 'ristoranti'
const TEST_LOCATION = 'Milano'
const TEST_MAX_LEADS = 5
const JOB_TIMEOUT_MS = 360_000 // 6 minuti

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function checkWorkerHealth() {
  try {
    const res = await fetch('http://116.203.137.39:8002/health', { signal: AbortSignal.timeout(8000) })
    const text = await res.text().catch(() => '')
    console.log(`Worker health: ${res.status} ${text.slice(0, 120)}`)
    return res.ok
  } catch (e) {
    console.warn('Worker health unreachable:', e.message)
    return false
  }
}

async function getOrCreateTestUser() {
  const { data: list } = await supabase.auth.admin.listUsers()
  const existing = (list?.users || []).find((u) => u.email === TEST_EMAIL)
  if (existing) return existing
  const { data, error } = await supabase.auth.admin.createUser({
    email: TEST_EMAIL,
    password: TEST_PASSWORD,
    email_confirm: true,
  })
  if (error) throw error
  return data.user
}

async function signInAsTestUser() {
  const { data, error } = await supabase.auth.signInWithPassword({
    email: TEST_EMAIL,
    password: TEST_PASSWORD,
  })
  if (error) throw error
  return data.session.user.id
}

async function ensureProfile(userId) {
  const { data, error } = await supabase.from('profiles').select('id').eq('id', userId).maybeSingle()
  if (error) throw error
  if (!data) {
    const { error: insertErr } = await supabase.from('profiles').insert({ id: userId, credits: 100 })
    if (insertErr) throw insertErr
  }
}

async function getProfileCredits(userId) {
  const { data, error } = await supabase.from('profiles').select('credits').eq('id', userId).single()
  if (error) throw error
  return typeof data.credits === 'number' ? data.credits : 0
}

async function waitForJob(jobId, timeoutMs = JOB_TIMEOUT_MS) {
  const start = Date.now()
  let lastStatus = ''
  while (Date.now() - start < timeoutMs) {
    const { data, error } = await supabase
      .from('searches')
      .select('status, results')
      .eq('id', jobId)
      .single()
    if (error) throw error
    const status = String(data.status).toLowerCase()
    if (status !== lastStatus) {
      console.log(`  job status: ${status} (elapsed ${Math.round((Date.now() - start) / 1000)}s)`)
      lastStatus = status
    }
    if (status === 'completed' || status === 'error') {
      return { status, results: data.results || [] }
    }
    await sleep(5000)
  }
  return { status: 'timeout', results: [] }
}

async function main() {
  console.log('=== E2E Search Flow ===')
  await checkWorkerHealth()

  const user = await getOrCreateTestUser()
  const userId = user.id
  console.log(`User: ${TEST_EMAIL} (${userId})`)

  await ensureProfile(userId)

  const creditsBefore = await getProfileCredits(userId)
  console.log(`Crediti prima: ${creditsBefore}`)

  const { data: insertedRows, error: insertErr } = await supabase
    .from('searches')
    .insert({
      user_id: userId,
      category: TEST_CATEGORY,
      location: TEST_LOCATION,
      status: 'pending',
      results: [],
      zone: String(TEST_MAX_LEADS),
    })
    .select('id')
  if (insertErr) throw insertErr
  if (!insertedRows || insertedRows.length === 0) throw new Error('Insert did not return id')

  const jobId = insertedRows[0].id
  console.log(`Job creato: ${jobId} — ${TEST_CATEGORY} @ ${TEST_LOCATION} (max ${TEST_MAX_LEADS} leads)`)

  let status = 'timeout'
  let results = []
  try {
    ;({ status, results } = await waitForJob(jobId))
    console.log(`Job finito con status: ${status} — risultati raw: ${results.length}`)

    const creditsAfter = await getProfileCredits(userId)
    console.log(`Crediti dopo: ${creditsAfter}`)

    if (status === 'error') {
      console.error('❌ Job terminato in errore.')
      process.exit(1)
    }
    if (status === 'timeout') {
      console.error(`❌ Timeout: il worker non ha processato il job entro ${JOB_TIMEOUT_MS / 1000}s.`)
      process.exit(1)
    }
    if (results.length === 0) {
      console.error('❌ Nessun risultato restituito.')
      process.exit(1)
    }
    if (creditsAfter !== creditsBefore) {
      console.error(`❌ Crediti cambiati inaspettatamente: ${creditsBefore} -> ${creditsAfter}`)
      process.exit(1)
    }

    console.log(`✅ Flusso OK: ${results.length} lead trovati, crediti invariati.`)
  } finally {
    await supabase.from('searches').delete().eq('id', jobId)
    console.log('Job di test eliminato.')
  }
}

main().catch((e) => {
  console.error('E2E failed:', e.message)
  console.error(e)
  process.exit(1)
})
