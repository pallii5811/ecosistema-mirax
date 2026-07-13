#!/usr/bin/env node
import { connectMiraxDb, loadMiraxDbPassword } from './lib/mirax-db.mjs'

if (!loadMiraxDbPassword()) process.exit(1)
const client = await connectMiraxDb()
try {
  const runs = await client.query(`
    select er.id,er.status,er.started_at,er.completed_at,er.configuration,er.metrics,
      cr.id canary_id,cr.search_id,cr.stop_reason,
      coalesce((select sum(coalesce(l.actual_cost_eur,l.estimated_cost_eur,0))
        from public.search_cost_ledger l where l.search_id=cr.search_id),0)::numeric ledger_cost_eur
    from public.evaluation_runs er
    left join lateral (
      select id,search_id,stop_reason from public.canary_runs
      where evaluation_run_id=er.id order by started_at desc limit 1
    ) cr on true
    where er.dataset_version='mirax-gold-v5' and er.mode in ('shadow_research','shadow_audit')
    order by er.started_at desc
  `)
  if (runs.rows.length === 0) {
    console.log(JSON.stringify({
      evaluation_version: 'mirax-gold-v5',
      status: 'not_executed_intent_gate_failed',
      verticals: [],
      totals: { selected: 0, queried: 0, candidates: 0, confirmed: 0, rejected: 0, publishable_shadow: 0, cost_eur: 0 },
    }, null, 2))
    process.exit(0)
  }
  const runIds = runs.rows.map((row) => row.id)
  const events = await client.query(`
    select evaluation_run_id,vertical,source_id,event_type,count(*)::int events,
      count(distinct candidate_ref)::int candidates,coalesce(sum(cost_eur),0)::numeric cost_eur,
      jsonb_agg(distinct jsonb_build_object(
        'url',source_url,'publisher',publisher,'method',extraction_method,
        'signal',signal_type,'selection_reason',selection_reason
      )) filter (where source_url is not null) examples
    from public.evaluation_source_events
    where evaluation_run_id=any($1::uuid[])
    group by evaluation_run_id,vertical,source_id,event_type
    order by vertical,source_id,event_type
  `, [runIds])
  const cases = await client.query(`
    select source_run_id,vertical,cohort,count(*)::int cases
    from public.evaluation_cases
    where dataset_version='mirax-gold-v5'
    group by source_run_id,vertical,cohort
  `)
  const totals = { selected: 0, queried: 0, candidates: 0, confirmed: 0, rejected: 0, publishable_shadow: 0, cost_eur: 0 }
  for (const row of events.rows) {
    const n = Number(row.events || 0)
    if (row.event_type === 'selected') totals.selected += n
    if (row.event_type === 'queried') totals.queried += n
    if (row.event_type === 'candidate_produced') totals.candidates += Number(row.candidates || n)
    if (row.event_type === 'signal_confirmed') totals.confirmed += Number(row.candidates || n)
    if (row.event_type === 'candidate_rejected') totals.rejected += Number(row.candidates || n)
    if (row.event_type === 'candidate_publishable') totals.publishable_shadow += Number(row.candidates || n)
    totals.cost_eur += Number(row.cost_eur || 0)
  }
  const report = {
    evaluation_version: 'mirax-gold-v5', status: 'shadow_data_available',
    runs: runs.rows, source_events: events.rows, dataset_cases: cases.rows, totals: {
      ...totals,
      cost_per_candidate_eur: totals.candidates ? totals.cost_eur / totals.candidates : null,
      cost_per_publishable_lead_eur: totals.publishable_shadow ? totals.cost_eur / totals.publishable_shadow : null,
    },
  }
  console.log(JSON.stringify(report, null, 2))
} finally { await client.end() }
