#!/usr/bin/env node
import { connectMiraxDb, loadMiraxDbPassword } from './lib/mirax-db.mjs'

const [searchId, canaryId, runId] = process.argv.slice(2)
for (const [label, value] of [['search', searchId], ['canary', canaryId], ['run', runId]]) {
  if (!/^[0-9a-f-]{36}$/i.test(value || '')) {
    console.error(`invalid ${label} id`)
    process.exit(1)
  }
}
if (!loadMiraxDbPassword()) process.exit(1)

const client = await connectMiraxDb()
try {
  await client.query('begin')
  const state = await client.query(
    `select s.status search_status,s.intent,s.progress,
            c.status canary_status,c.search_id,c.evaluation_run_id,c.hard_budget_eur,c.customer_visible,
            e.status run_status
       from public.searches s
       join public.canary_runs c on c.id=$2 and c.search_id=s.id
       join public.evaluation_runs e on e.id=$3 and e.id=c.evaluation_run_id
      where s.id=$1 for update of s,c,e`,
    [searchId, canaryId, runId],
  )
  if (state.rowCount !== 1) throw new Error('controlled canary relation mismatch')
  const row = state.rows[0]
  const intent = row.intent || {}
  if (row.search_status !== 'planning' || row.canary_status !== 'running' || row.run_status !== 'running') {
    throw new Error(`invalid controlled state search=${row.search_status} canary=${row.canary_status} run=${row.run_status}`)
  }
  if (row.customer_visible !== false || intent.customer_visible !== false || intent.lifecycle_stage !== 'v5_shadow') {
    throw new Error('shadow/customer visibility invariant failed')
  }
  if (intent.prepare_only !== true || intent.execution_authorized !== false) {
    throw new Error('prepare authorization state invalid')
  }
  const runtime = String(intent.execution_runtime || '').trim()
  const legacyShadow = intent.source_adapter_shadow === true
  if (runtime !== 'source_adapter_orchestrator' && !legacyShadow) {
    throw new Error('source_adapter_orchestrator execution_runtime required for v5_shadow canary')
  }
  if (Number(row.hard_budget_eur) > 0.125 || Number(row.hard_budget_eur) <= 0) {
    throw new Error(`invalid hard budget ${row.hard_budget_eur}`)
  }

  const gates = await client.query(
    `select
       (select count(*)::int from public.searches
          where id<>$1 and status in ('planning','pending','pending_user','processing','running')) other_active_jobs,
       (select count(*)::int from public.canary_runs
          where id<>$2 and status in ('created','running')) other_active_canaries,
       (select count(*)::int from public.search_cost_ledger
          where status='reserved') open_reservations,
       (select count(*)::int from public.search_cost_ledger
          where search_id=$1 and operation_type='intent_compilation') compiler_calls,
       (select coalesce(sum(coalesce(actual_cost_eur,estimated_cost_eur)),0)::float
          from public.search_cost_ledger where search_id=$1) total_cost_eur,
       (select count(*)::int from public.search_candidates where search_id=$1) candidates,
       (select count(*)::int from public.search_publications where search_id=$1) publications,
       (select count(*)::int from public.search_credit_charges where search_id=$1) charges`,
    [searchId, canaryId],
  )
  const gate = gates.rows[0]
  const replayedPlan = intent.plan_replay === true && /^[0-9a-f-]{36}$/i.test(String(intent.plan_replay_source_search_id || ''))
  const compilerGatePassed = replayedPlan ? gate.compiler_calls === 0 : gate.compiler_calls === 1
  if (gate.other_active_jobs || gate.other_active_canaries || gate.open_reservations ||
      !compilerGatePassed || Number(gate.total_cost_eur) > 0.05 ||
      gate.candidates || gate.publications || gate.charges) {
    throw new Error(`authorization ledger/state gate failed: ${JSON.stringify(gate)}`)
  }

  await client.query(
    `update public.searches
        set status='pending',
            intent=jsonb_set(
              jsonb_set(
                jsonb_set(
                  jsonb_set(intent,'{prepare_only}','false'::jsonb,true),
                  '{execution_authorized}','true'::jsonb,true
                ),
                '{execution_runtime}','"source_adapter_orchestrator"'::jsonb,true
              ),
              '{source_adapter_shadow}','true'::jsonb,true
            ),
            progress=coalesce(progress,'{}'::jsonb) || jsonb_build_object(
              'prepare_complete',true,
              'execution_authorized',true,
              'execution_authorized_at',now(),
              'requested_execution_runtime','source_adapter_orchestrator'
            ),
            updated_at=now()
      where id=$1`,
    [searchId],
  )
  await client.query(
    `update public.evaluation_runs
        set metrics=coalesce(metrics,'{}'::jsonb) || jsonb_build_object(
          'execution_authorized',true,
          'execution_authorized_at',now()
        )
      where id=$1`,
    [runId],
  )
  await client.query('commit')
  console.log(`authorized controlled one-shot search=${searchId} canary=${canaryId} run=${runId}`)
} catch (error) {
  await client.query('rollback').catch(() => undefined)
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
} finally {
  await client.end()
}
