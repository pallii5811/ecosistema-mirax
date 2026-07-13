#!/usr/bin/env node
/**
 * Test E2E worker intent enrichment.
 * Inserisce un job searches con intent, aspetta che il worker lo processi,
 * verifica che i lead abbiano i segnali business richiesti.
 */
import { connectMiraxDb } from './lib/mirax-db.mjs'

const TEST_USER_ID = '0bcfe1b8-a8fe-487f-83da-333ec4f7ef17'

const TEST_CASES = [
  {
    name: 'investing_marketing a Milano',
    category: 'Agenzie di marketing',
    location: 'Milano',
    intent: {
      query: 'agenzie a Milano che investono in marketing',
      signals: [{ type: 'investing_marketing' }],
      target_profile: { industries: ['marketing'], locations: ['Milano'] },
    },
    required_signal: 'investing_marketing',
  },
  {
    name: 'hiring camerieri a Milano',
    category: 'Ristoranti',
    location: 'Milano',
    intent: {
      query: 'ristoranti a Milano che assumono camerieri',
      signals: [{ type: 'hiring', params: { role: 'cameriere' } }],
      target_profile: { industries: ['ristorazione'], locations: ['Milano'] },
    },
    required_signal: 'hiring',
  },
  {
    name: 'tender_won imprese edili Roma',
    category: 'Imprese edili',
    location: 'Roma',
    intent: {
      query: 'imprese edili a Roma che hanno vinto una gara',
      signals: [{ type: 'tender_won' }],
      target_profile: { industries: ['edilizia'], locations: ['Roma'] },
    },
    required_signal: 'tender_won',
  },
  {
    name: 'crm_installed agenzie Milano',
    category: 'Agenzie immobiliari',
    location: 'Milano',
    intent: {
      query: 'agenzie immobiliari a Milano che usano un CRM',
      signals: [{ type: 'crm_installed' }],
      target_profile: { industries: ['immobiliare'], locations: ['Milano'] },
    },
    required_signal: 'crm_installed',
  },
]

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

async function waitForJob(client, jobId, timeoutMs = 360000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const { rows } = await client.query('SELECT status, results FROM public.searches WHERE id = $1', [jobId])
    const row = rows[0]
    if (!row) throw new Error('Job not found')
    if (row.status === 'completed' || row.status === 'error') {
      return { status: row.status, results: row.results || [] }
    }
    process.stdout.write('.')
    await sleep(5000)
  }
  throw new Error('Timeout waiting for job')
}

async function runCase(client, testCase) {
  console.log(`\n▶ Test: ${testCase.name}`)
  const insert = await client.query(
    `INSERT INTO public.searches (user_id, category, location, status, results, intent, zone, created_at)
     VALUES ($1, $2, $3, 'pending', '[]'::jsonb, $4, '8', NOW())
     RETURNING id`,
    [TEST_USER_ID, testCase.category, testCase.location, JSON.stringify(testCase.intent)],
  )
  const jobId = insert.rows[0].id
  console.log(`  Job creato: ${jobId}`)

  const { status, results } = await waitForJob(client, jobId)
  console.log(`\n  Status: ${status}, results: ${Array.isArray(results) ? results.length : 0}`)

  if (status !== 'completed') {
    console.log('  ❌ Job non completato')
    await client.query('DELETE FROM public.searches WHERE id = $1', [jobId])
    return false
  }

  const leads = Array.isArray(results) ? results : []
  const withSignal = leads.filter((l) =>
    (l.business_signals || []).some((s) => s?.type === testCase.required_signal),
  )
  console.log(`  Lead con segnale "${testCase.required_signal}": ${withSignal.length}/${leads.length}`)

  if (withSignal.length > 0) {
    const sample = withSignal[0]
    console.log('  Esempio:', {
      nome: sample.nome || sample.azienda,
      citta: sample.citta,
      signals: sample.business_signals?.map((s) => s.type),
    })
  }

  await client.query('DELETE FROM public.searches WHERE id = $1', [jobId])
  return withSignal.length > 0
}

async function main() {
  const client = await connectMiraxDb()
  console.log('Connected to Supabase dev DB')
  let ok = 0
  for (const tc of TEST_CASES) {
    try {
      const pass = await runCase(client, tc)
      if (pass) ok++
    } catch (e) {
      console.error(`  ❌ Errore: ${e.message}`)
    }
  }
  await client.end()
  console.log(`\n✅ Passati ${ok}/${TEST_CASES.length}`)
  process.exit(ok === TEST_CASES.length ? 0 : 1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
