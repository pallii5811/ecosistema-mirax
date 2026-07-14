#!/usr/bin/env node
import { connectMiraxDb, loadMiraxDbPassword } from './lib/mirax-db.mjs'

const [searchId, canaryId, mode] = process.argv.slice(2)
if (!/^[0-9a-f-]{36}$/i.test(searchId || '') || !/^[0-9a-f-]{36}$/i.test(canaryId || '')) {
  console.error('usage: node scripts/inspect-controlled-canary.mjs <search-id> <canary-id>')
  process.exit(1)
}
if (!loadMiraxDbPassword()) process.exit(1)

const client = await connectMiraxDb()
try {
  const result = await client.query(
    `select
       (select count(*)::int from public.searches
          where status in ('planning','pending','pending_user','processing','running')) active_jobs,
       (select count(*)::int from public.canary_runs where status in ('created','running')) active_canaries,
       (select count(*)::int from public.search_cost_ledger
          where status='reserved' and reservation_expires_at < now()) stale_reservations,
       (select status from public.searches where id=$1) search_status,
       (select status from public.canary_runs where id=$2) canary_status,
       (select coalesce(sum(coalesce(actual_cost_eur,estimated_cost_eur)),0)::float
          from public.search_cost_ledger where search_id=$1) total_cost_eur,
       (select count(*)::int from public.search_cost_ledger
          where search_id=$1 and operation_type='intent_compilation') compiler_calls,
       (select count(*)::int from public.search_cost_ledger
          where search_id=$1 and status='reserved') open_reservations,
       (select count(*)::int from public.search_candidates where search_id=$1) candidates,
       (select count(*)::int from public.search_publications where search_id=$1) publications,
       (select count(*)::int from public.search_credit_charges where search_id=$1) charges`,
    [searchId, canaryId],
  )
  console.log(JSON.stringify(result.rows[0], null, 2))
  if (mode === '--detail') {
    const search = await client.query(
      `select intent,progress from public.searches where id=$1`,
      [searchId],
    )
    const ledger = await client.query(
      `select operation_type,provider,model,status,estimated_cost_eur,actual_cost_eur,metadata
         from public.search_cost_ledger where search_id=$1 order by created_at asc`,
      [searchId],
    )
    const evidence = await client.query(
      `select source_class,count(*)::int evidence_count
         from public.search_evidence where search_id=$1 group by source_class order by source_class`,
      [searchId],
    )
    console.log(JSON.stringify({
      search: search.rows[0] || null,
      ledger: ledger.rows,
      evidence_by_source: evidence.rows,
    }, null, 2))
  }
} finally {
  await client.end()
}
