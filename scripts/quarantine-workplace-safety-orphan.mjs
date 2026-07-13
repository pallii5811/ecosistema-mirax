#!/usr/bin/env node
/**
 * Idempotent transactional quarantine for the interrupted workplace_safety shadow run.
 * Read-verify → mutate → read-verify. No deletes, no refunds, no new runs.
 *
 * Safety: mutations require explicit confirmation via env var matching SEARCH_ID.
 * Read-only verification: node scripts/quarantine-workplace-safety-orphan.mjs --verify-only
 */
import { connectMiraxDb, loadMiraxDbPassword } from './lib/mirax-db.mjs'

const SEARCH_ID = '6ecc8d72-db71-4b06-a215-9cc0fb92f303'
const CANARY_ID = '8e0297c9-8724-45c0-8a9f-5de17ff48be8'
const RUN_ID = '0dd16cf5-f1a9-4e0f-a0f7-49f4a0240285'
const REASON = 'incomplete_required_signal_coverage_before_source_execution'
const VERIFY_ONLY = process.argv.includes('--verify-only')
const CONFIRMED = process.env.CONFIRM_WORKPLACE_SAFETY_QUARANTINE === SEARCH_ID

if (!loadMiraxDbPassword()) process.exit(1)
const client = await connectMiraxDb()

async function snapshot(label) {
  const search = await client.query('select id,status,results from public.searches where id=$1', [SEARCH_ID])
  const canary = await client.query('select id,status,stop_reason,search_id from public.canary_runs where id=$1', [CANARY_ID])
  const run = await client.query('select id,status,metrics from public.evaluation_runs where id=$1', [RUN_ID])
  const budget = await client.query('select * from public.search_budget_state where search_id=$1', [SEARCH_ID])
  const ledger = await client.query('select status,operation_type,estimated_cost_eur,actual_cost_eur from public.search_cost_ledger where search_id=$1 order by created_at', [SEARCH_ID])
  const candidates = await client.query('select count(*)::int n from public.search_candidates where search_id=$1', [SEARCH_ID])
  const pubs = await client.query('select count(*)::int n from public.search_publications where search_id=$1', [SEARCH_ID])
  const charges = await client.query('select count(*)::int n from public.search_credit_charges where search_id=$1', [SEARCH_ID])
  const reserved = await client.query(`select count(*)::int n from public.search_cost_ledger where search_id=$1 and status='reserved'`, [SEARCH_ID])
  const snap = {
    search: search.rows[0] || null,
    canary: canary.rows[0] || null,
    run: run.rows[0] || null,
    budget: budget.rows[0] || null,
    ledger: ledger.rows,
    candidates: candidates.rows[0]?.n ?? 0,
    publications: pubs.rows[0]?.n ?? 0,
    charges: charges.rows[0]?.n ?? 0,
    reserved_open: reserved.rows[0]?.n ?? 0,
  }
  console.log(`\n=== ${label} ===`)
  console.log(JSON.stringify(snap, null, 2))
  return snap
}

function assertQuarantinedState(snap) {
  if (!snap.search || snap.search.status !== 'cancelled') throw new Error('search not cancelled')
  if (!snap.canary || snap.canary.status !== 'quarantined') throw new Error('canary not quarantined')
  if (!snap.run || snap.run.status !== 'failed') throw new Error('evaluation run not failed')
  if (snap.candidates !== 0 || snap.publications !== 0 || snap.charges !== 0) {
    throw new Error('unexpected candidates/publications/charges')
  }
  if (snap.reserved_open !== 0) throw new Error('unexpected open reservations')
}

try {
  const before = await snapshot('BEFORE')
  if (!before.search) throw new Error(`search ${SEARCH_ID} not found`)
  if (!before.canary) throw new Error(`canary ${CANARY_ID} not found`)
  if (!before.run) throw new Error(`evaluation run ${RUN_ID} not found`)

  if (VERIFY_ONLY) {
    assertQuarantinedState(before)
    console.log('\nverify-only: workplace_safety orphan is quarantined')
    process.exit(0)
  }

  if (!CONFIRMED) {
    console.error(
      `Refusing mutation: set CONFIRM_WORKPLACE_SAFETY_QUARANTINE=${SEARCH_ID} or use --verify-only`,
    )
    process.exit(1)
  }

  if (before.candidates !== 0) throw new Error('unexpected candidates on workplace_safety search')
  if (before.publications !== 0) throw new Error('unexpected publications on workplace_safety search')
  if (before.charges !== 0) throw new Error('unexpected credit charges on workplace_safety search')

  await client.query('begin')

  const canary = await client.query(
    `update public.canary_runs
       set status='quarantined',
           stop_reason=$2::text,
           completed_at=coalesce(completed_at, now())
     where id=$1
       and status in ('created','running')
     returning id,status`,
    [CANARY_ID, REASON],
  )
  if (canary.rowCount === 0) {
    const existing = await client.query('select status,stop_reason from public.canary_runs where id=$1', [CANARY_ID])
    if (existing.rows[0]?.status !== 'quarantined') throw new Error('canary not quarantinable')
  }

  const run = await client.query(
    `update public.evaluation_runs
       set status='failed',
           metrics=coalesce(metrics,'{}'::jsonb) || jsonb_build_object('quarantine_reason',$2::text),
           completed_at=coalesce(completed_at, now())
     where id=$1
       and status in ('running','created')
     returning id,status`,
    [RUN_ID, REASON],
  )
  if (run.rowCount === 0) {
    const existing = await client.query('select status from public.evaluation_runs where id=$1', [RUN_ID])
    if (!['failed', 'aborted'].includes(existing.rows[0]?.status)) throw new Error('evaluation run not closable')
  }

  const search = await client.query(
    `update public.searches
       set status='cancelled',
           results='[]'::jsonb,
           progress=coalesce(progress,'{}'::jsonb) || jsonb_build_object(
             'stop_reason',$2::text,
             'quarantined_at',now(),
             'quarantine_reason',$2::text
           )
     where id=$1
       and status in ('planning','pending','pending_user','processing','running')
     returning id,status`,
    [SEARCH_ID, REASON],
  )
  if (search.rowCount === 0) {
    const existing = await client.query('select status from public.searches where id=$1', [SEARCH_ID])
    if (!['cancelled', 'error', 'completed'].includes(existing.rows[0]?.status)) {
      throw new Error('search not closable under quarantine contract')
    }
  }

  await client.query(
    `update public.search_cost_ledger
       set status='released',
           settled_at=coalesce(settled_at, now()),
           error_code=coalesce(error_code, 'quarantine_release')
     where search_id=$1 and status='reserved'`,
    [SEARCH_ID],
  )

  await client.query(
    `update public.search_budget_state
       set status='halted',
           halt_reason=$2::text,
           updated_at=now()
     where search_id=$1 and status='active'`,
    [SEARCH_ID, REASON],
  )

  await client.query('commit')
  console.log(`\nquarantined workplace_safety orphan: search=${SEARCH_ID} canary=${CANARY_ID} run=${RUN_ID}`)
} catch (error) {
  await client.query('rollback').catch(() => undefined)
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
} finally {
  if (!process.exitCode) await snapshot('AFTER')
  await client.end()
}
