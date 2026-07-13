#!/usr/bin/env node
import fs from 'node:fs'
import { connectMiraxDb, loadMiraxDbPassword } from './lib/mirax-db.mjs'

const apply = process.argv.includes('--apply')
const migration = fs.readFileSync('db/migrations/2026_07_12_atomic_cost_governor.sql', 'utf8')

if (!loadMiraxDbPassword()) {
  console.error('Missing database credential')
  process.exit(1)
}

const client = await connectMiraxDb()
try {
  await client.query('begin')
  await client.query(migration)

  const created = await client.query(`
    insert into public.searches(category, location, status, results, zone, intent)
    values ('cost-governor-validation', 'Italia', 'planning', '[]'::jsonb, '10',
      '{"requested_leads":10,"max_leads":10}'::jsonb)
    returning id
  `)
  const searchId = created.rows[0].id
  const init = await client.query(
    'select (public.initialize_search_budget($1, $2, $3)).*',
    [searchId, 0.21, 0.25],
  )
  if (Number(init.rows[0].hard_cost_eur) !== 0.25) throw new Error('budget initialization mismatch')

  const first = await client.query(
    `select (public.reserve_search_cost($1, 'same-key', 'web_search', 0.02, 'test')).*`,
    [searchId],
  )
  const duplicate = await client.query(
    `select (public.reserve_search_cost($1, 'same-key', 'web_search', 0.02, 'test')).*`,
    [searchId],
  )
  if (first.rows[0].id !== duplicate.rows[0].id) throw new Error('idempotency failed')

  await client.query('savepoint expected_budget_failure')
  let hardStop = false
  try {
    await client.query(
      `select public.reserve_search_cost($1, 'over-budget', 'llm_extraction', 0.24, 'test')`,
      [searchId],
    )
  } catch (error) {
    hardStop = String(error?.message || '').includes('RESEARCH_HARD_BUDGET_EXCEEDED')
    await client.query('rollback to savepoint expected_budget_failure')
  }
  if (!hardStop) throw new Error('hard budget did not stop projected overspend')

  await client.query(`select public.settle_search_cost($1, 'same-key', 0.015)`, [searchId])
  const state = await client.query(
    'select committed_cost_eur, status from public.search_budget_state where search_id = $1',
    [searchId],
  )
  if (Number(state.rows[0].committed_cost_eur) !== 0.015 || state.rows[0].status !== 'active') {
    throw new Error('settlement accounting mismatch')
  }

  await client.query(
    `select public.reserve_search_cost($1,'stale-key','browser_audit',0.01,'validation')`,
    [searchId],
  )
  await client.query(
    `update public.search_cost_ledger set reservation_expires_at=now()-interval '1 second'
     where search_id=$1 and idempotency_key='stale-key'`,
    [searchId],
  )
  const recovered = await client.query('select public.release_stale_search_costs($1) count', [searchId])
  const stale = await client.query(
    `select status,actual_cost_eur,error_code from public.search_cost_ledger
     where search_id=$1 and idempotency_key='stale-key'`,
    [searchId],
  )
  if (
    Number(recovered.rows[0].count) !== 1 || stale.rows[0].status !== 'failed' ||
    Number(stale.rows[0].actual_cost_eur) !== 0.01 ||
    stale.rows[0].error_code !== 'STALE_RESERVATION_CONSERVATIVE_SETTLEMENT'
  ) throw new Error('interrupted reservation recovery mismatch')

  if (apply) {
    // Validation fixtures are removed while the schema/functions remain committed.
    await client.query('delete from public.searches where id = $1', [searchId])
    await client.query('commit')
    console.log('Atomic cost governor DB: validated and applied')
  } else {
    await client.query('rollback')
    console.log('Atomic cost governor DB: transaction validation passed; rolled back')
  }
} catch (error) {
  await client.query('rollback').catch(() => undefined)
  console.error(`Atomic cost governor DB validation failed: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
} finally {
  await client.end()
}
