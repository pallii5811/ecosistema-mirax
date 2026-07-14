#!/usr/bin/env node
import { connectMiraxDb, loadMiraxDbPassword } from './lib/mirax-db.mjs'

const apply = process.argv.includes('--apply')
if (!loadMiraxDbPassword()) process.exit(1)
const client = await connectMiraxDb()
try {
  await client.query('begin')
  const invalid = await client.query(`
    select c.id,c.vertical,c.case_number,c.candidate_snapshot->>'name' as candidate_name
    from public.evaluation_cases c
    where c.dataset_version='mirax-gold-v5'
      and c.cohort='adversarial'
      and c.review_status='candidate_ready'
      and c.provenance->>'source_event_type'='candidate_rejected'
      and coalesce(c.candidate_snapshot->>'name','') ~ '^extraction-[0-9]+$'
      and not exists(select 1 from public.evaluation_judgments j where j.case_id=c.id)
      and not exists(
        select 1
        from public.evaluation_source_events e
        where e.evaluation_run_id=c.source_run_id
          and e.event_type='candidate_rejected'
          and coalesce(e.candidate_ref,'')=coalesce(c.candidate_snapshot->>'name','')
          and e.candidate_ref !~ '^extraction-[0-9]+$'
      )
    order by c.vertical,c.case_number
    for update
  `)
  if (invalid.rowCount > 20) throw new Error(`refusing unexpectedly broad cleanup: ${invalid.rowCount}`)
  const invalidEvents = await client.query(`
    select e.id,e.vertical,e.candidate_ref,e.source_url
    from public.evaluation_source_events e
    join public.evaluation_runs r on r.id=e.evaluation_run_id
    where r.dataset_version='mirax-gold-v5'
      and e.event_type='candidate_rejected'
      and coalesce(e.candidate_ref,'') ~ '^extraction-[0-9]+$'
      and e.metadata->>'operation_type'='llm_extract'
      and coalesce(e.metadata->>'company','')=''
    order by e.created_at
    for update of e
  `)
  if (invalidEvents.rowCount > 20) throw new Error(`refusing unexpectedly broad event cleanup: ${invalidEvents.rowCount}`)
  if (invalid.rowCount) {
    await client.query('delete from public.evaluation_cases where id=any($1::uuid[])', [invalid.rows.map((row) => row.id)])
  }
  if (invalidEvents.rowCount) {
    await client.query('delete from public.evaluation_source_events where id=any($1::uuid[])', [invalidEvents.rows.map((row) => row.id)])
  }
  const remaining = await client.query(`
    select
      count(*) filter(where cohort='adversarial')::int adversarial,
      count(*) filter(where cohort='v5_output')::int v5_output,
      count(*) filter(where cohort='legacy_baseline')::int legacy,
      (select count(*)::int from public.evaluation_judgments j join public.evaluation_cases c on c.id=j.case_id
       where c.dataset_version='mirax-gold-v5') judgments
    from public.evaluation_cases where dataset_version='mirax-gold-v5'
  `)
  if (apply) await client.query('commit')
  else await client.query('rollback')
  console.log(JSON.stringify({
    applied: apply,
    invalid_artifacts_found: invalid.rowCount,
    removed: apply ? invalid.rowCount : 0,
    invalid_source_events_found: invalidEvents.rowCount,
    source_events_removed: apply ? invalidEvents.rowCount : 0,
    cases: invalid.rows.map(({ vertical, case_number, candidate_name }) => ({ vertical, case_number, candidate_name })),
    remaining: remaining.rows[0],
    human_judgments_deleted: 0,
  }, null, 2))
} catch (error) {
  await client.query('rollback').catch(() => undefined)
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
} finally {
  await client.end()
}
