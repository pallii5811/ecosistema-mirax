#!/usr/bin/env node
import { connectMiraxDb, loadMiraxDbPassword } from './lib/mirax-db.mjs'

if (!loadMiraxDbPassword()) process.exit(1)
const client = await connectMiraxDb()
try {
  const tables = [
    'search_candidates', 'search_evidence', 'search_cost_ledger', 'search_budget_state',
    'search_publications', 'search_credit_charges', 'evaluation_cases',
    'evaluation_judgments', 'evaluation_runs', 'canary_runs',
  ]
  const rls = await client.query(
    `select relname, relrowsecurity from pg_class
     where relnamespace='public'::regnamespace and relname=any($1::text[]) order by relname`,
    [tables],
  )
  const jobs = await client.query(
    `select status,count(*)::int count from public.searches group by status order by status`,
  )
  const active = await client.query(
    `select count(*)::int active_jobs,
      count(*) filter (where results is not null and results::text not in ('[]','{}','null'))::int active_with_payload
     from public.searches where status in ('planning','pending','pending_user','processing','running')`,
  )
  const staleCosts = await client.query(
    `select count(*)::int stale_reservations from public.search_cost_ledger
     where status='reserved' and reservation_expires_at < now()`,
  )
  const credit = await client.query(
    `select
      (select count(*)::int from public.profiles where credits < 0) negative_balances,
      (select count(*)::int from public.search_credit_charges where status='charged') charged_publications,
      (select count(*)::int from public.search_credit_charges where status='refunded') refunded_publications,
      (select count(*)::int from (
        select user_id,publication_id,count(*) from public.search_credit_charges
        group by user_id,publication_id having count(*)>1
      ) d) duplicate_charges`,
  )
  const evaluation = await client.query(
    `select
      (select count(*)::int from public.evaluation_cases where dataset_version='mirax-gold-v1') gold_slots,
      (select count(*)::int from public.evaluation_judgments where is_human) human_judgments,
      (select count(*)::int from public.canary_runs where status in ('created','running')) active_canaries`,
  )
  const acl = await client.query(
    `select
      has_function_privilege('anon','public.publish_search_candidate(uuid)','execute') anon_publish,
      has_function_privilege('authenticated','public.publish_search_candidate(uuid)','execute') auth_publish,
      has_function_privilege('service_role','public.publish_search_candidate(uuid)','execute') service_publish,
      has_function_privilege('anon','public.reserve_search_cost(uuid,text,text,numeric,text,text,text,uuid,numeric,jsonb,integer,uuid,boolean)','execute') anon_reserve,
      has_function_privilege('authenticated','public.reserve_search_cost(uuid,text,text,numeric,text,text,text,uuid,numeric,jsonb,integer,uuid,boolean)','execute') auth_reserve,
      has_function_privilege('service_role','public.reserve_search_cost(uuid,text,text,numeric,text,text,text,uuid,numeric,jsonb,integer,uuid,boolean)','execute') service_reserve`,
  )
  const report = {
    rls: Object.fromEntries(rls.rows.map((row) => [row.relname, row.relrowsecurity])),
    jobs: jobs.rows,
    active: active.rows[0],
    cost: staleCosts.rows[0],
    credit: credit.rows[0],
    evaluation: evaluation.rows[0],
    acl: acl.rows[0],
  }
  const missingRls = tables.filter((table) => report.rls[table] !== true)
  if (missingRls.length) throw new Error(`RLS missing: ${missingRls.join(',')}`)
  if (Number(report.active.active_jobs) !== 0 || Number(report.active.active_with_payload) !== 0) {
    throw new Error('active production jobs or intermediate payloads found')
  }
  if (Number(report.cost.stale_reservations) !== 0) throw new Error('stale cost reservations found')
  if (Number(report.credit.negative_balances) !== 0 || Number(report.credit.duplicate_charges) !== 0) {
    throw new Error('credit invariant failed')
  }
  if (Number(report.evaluation.gold_slots) !== 200 || Number(report.evaluation.active_canaries) !== 0) {
    throw new Error('evaluation/canary invariant failed')
  }
  if (
    report.acl.anon_publish || report.acl.auth_publish || !report.acl.service_publish ||
    report.acl.anon_reserve || report.acl.auth_reserve || !report.acl.service_reserve
  ) throw new Error('RPC ACL invariant failed')
  console.log(JSON.stringify(report, null, 2))
} finally {
  await client.end()
}
