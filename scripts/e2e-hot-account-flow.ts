import fs from 'fs'
import { createClient } from '@supabase/supabase-js'
import { buildMiraxQueryPlan } from '../src/lib/uqe/mirax-query-planner'

function loadEnv(): Record<string, string> {
  const env: Record<string, string> = {}
  for (const file of ['.env.local', '.env.ecosistema.secrets']) {
    if (!fs.existsSync(file)) continue
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const index = line.indexOf('=')
      if (index <= 0 || line.trim().startsWith('#')) continue
      env[line.slice(0, index).trim()] = line.slice(index + 1).trim()
    }
  }
  return env
}

const env = loadEnv()
for (const [key, value] of Object.entries(env)) process.env[key] ??= value
const url = env.NEXT_PUBLIC_SUPABASE_URL || env.SUPABASE_URL
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !serviceKey) throw new Error('Supabase env missing')

const timedFetch: typeof fetch = (input, init) =>
  fetch(input, {
    ...init,
    signal: init?.signal ?? AbortSignal.timeout(20_000),
  })
const supabase = createClient(url, serviceKey, { global: { fetch: timedFetch } })
const query =
  'Trovami 5 PMI italiane a cui vendere il mio software di lead generation e Sales Intelligence. Voglio lead estremamente caldi con segnali di acquisto concreti.'
const target = 5
const timeoutMs = 12 * 60_000
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function testUserId(): Promise<string> {
  const email = 'e2e-hot-account@mirax.test'
  const { data: listed, error: listError } = await supabase.auth.admin.listUsers()
  if (listError) throw listError
  const existing = listed.users.find((user) => user.email === email)
  if (existing) return existing.id
  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password: 'E2E-Hot-Account-99!',
    email_confirm: true,
  })
  if (error || !data.user) throw error || new Error('test user missing')
  return data.user.id
}

function domainOf(lead: Record<string, unknown>): string {
  return String(lead.sito || lead.website || '')
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .split('/')[0]
}

function hasContactChannel(lead: Record<string, unknown>): boolean {
  const email = String(lead.email || '').trim()
  const phone = String(lead.telefono || lead.phone || '').replace(/\D+/g, '')
  const social = ['linkedin', 'instagram', 'facebook'].some((key) => String(lead[key] || '').startsWith('http'))
  return /.+@.+\..+/.test(email) || phone.length >= 8 || social
}

async function main() {
  const plan = await buildMiraxQueryPlan(query)
  const userId = await testUserId()
  const intent = {
    query,
    original_query: query,
    search_mode: 'agentic_only',
    search_strategy: 'organic_web_search',
    required_signals: plan.required_signals,
    hiring_roles: plan.commercial_hypothesis?.hiring_roles || [],
    commercial_hypothesis: plan.commercial_hypothesis,
    ranking_policy: plan.ranking_policy,
    intent_summary: plan.intent_summary,
    uqe_plan: plan,
  }
  const { data, error } = await supabase
    .from('searches')
    .insert({
      user_id: userId,
      category: plan.sector,
      location: plan.location,
      zone: String(target),
      status: 'pending',
      results: [],
      intent,
    })
    .select('id')
    .single()
  if (error) throw error
  const jobId = data.id as string
  console.log(`hot-account job=${jobId} release target=${target}`)

  try {
    const started = Date.now()
    let lastStatus = ''
    let results: Record<string, unknown>[] = []
    while (Date.now() - started < timeoutMs) {
      const { data: row, error: pollError } = await supabase
        .from('searches')
        .select('status,results,progress')
        .eq('id', jobId)
        .single()
      if (pollError) throw pollError
      const status = String(row.status || '')
      results = Array.isArray(row.results) ? (row.results as Record<string, unknown>[]) : []
      if (status !== lastStatus) {
        console.log(`status=${status} results=${results.length} progress=${JSON.stringify(row.progress || {})}`)
        lastStatus = status
      }
      if (status === 'error') throw new Error('worker returned error')
      if (status === 'completed') break
      await sleep(5_000)
    }

    if (lastStatus !== 'completed') throw new Error(`timeout status=${lastStatus}`)
    if (results.length !== target) throw new Error(`expected ${target} results, got ${results.length}`)
    const domains = results.map(domainOf)
    if (domains.some((domain) => !domain) || new Set(domains).size !== target) {
      throw new Error(`invalid/duplicate domains: ${domains.join(', ')}`)
    }
    for (const lead of results) {
      const matched = Array.isArray(lead.matched_signals) ? lead.matched_signals.map(String) : []
      if (!matched.includes('hiring')) throw new Error(`missing hiring evidence: ${lead.azienda}`)
      if (!lead.agentic_evidence || !lead.agentic_source_url) throw new Error(`missing evidence URL: ${lead.azienda}`)
      if (Number(lead.hotness_score || 0) < 65) throw new Error(`cold lead published: ${lead.azienda}`)
      if (!hasContactChannel(lead)) throw new Error(`missing contact/social channel: ${lead.azienda}`)
    }
    console.log(
      JSON.stringify(
        results.map((lead) => ({
          azienda: lead.azienda,
          sito: lead.sito,
          hotness_score: lead.hotness_score,
          evidence: lead.agentic_evidence,
          source_url: lead.agentic_source_url,
          email: lead.email,
          telefono: lead.telefono,
          linkedin: lead.linkedin,
          instagram: lead.instagram,
          facebook: lead.facebook,
        })),
        null,
        2,
      ),
    )
    console.log('E2E HOT ACCOUNT OK')
    await sleep(45_000)
  } finally {
    try {
      await supabase.from('searches').delete().eq('id', jobId)
    } catch (cleanupError) {
      console.warn('cleanup deferred:', cleanupError)
    }
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
