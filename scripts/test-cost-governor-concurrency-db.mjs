#!/usr/bin/env node
import { connectMiraxDb, loadMiraxDbPassword } from './lib/mirax-db.mjs'

if (!loadMiraxDbPassword()) process.exit(1)
const setup = await connectMiraxDb()
const workerA = await connectMiraxDb()
const workerB = await connectMiraxDb()
let searchId
try {
  const created = await setup.query(
    `insert into public.searches(category,location,status,results,zone,intent)
     values('cost-concurrency-validation','Italia','planning','[]','10','{"requested_leads":10}') returning id`,
  )
  searchId = created.rows[0].id
  await setup.query('select public.initialize_search_budget($1,.21,.25)', [searchId])

  const reserve = (client, key) =>
    client.query(
      `select (public.reserve_search_cost($1,$2,'concurrent_paid_operation',.15,'validation')).*`,
      [searchId, key],
    )
  const results = await Promise.allSettled([reserve(workerA, 'worker-a'), reserve(workerB, 'worker-b')])
  const fulfilled = results.filter((result) => result.status === 'fulfilled').length
  const rejected = results.filter(
    (result) => result.status === 'rejected' && String(result.reason?.message || '').includes('RESEARCH_HARD_BUDGET_EXCEEDED'),
  ).length
  if (fulfilled !== 1 || rejected !== 1) {
    throw new Error(`atomic overspend test failed fulfilled=${fulfilled} rejected=${rejected}`)
  }
  const state = await setup.query(
    'select committed_cost_eur,hard_cost_eur,status from public.search_budget_state where search_id=$1',
    [searchId],
  )
  if (Number(state.rows[0].committed_cost_eur) > Number(state.rows[0].hard_cost_eur)) {
    throw new Error('committed cost exceeded hard budget')
  }
  console.log('Atomic concurrent workers: 1 reservation accepted, 1 blocked, overspend=0')
} finally {
  if (searchId) await setup.query('delete from public.searches where id=$1', [searchId]).catch(() => undefined)
  await Promise.all([setup.end(), workerA.end(), workerB.end()])
}
