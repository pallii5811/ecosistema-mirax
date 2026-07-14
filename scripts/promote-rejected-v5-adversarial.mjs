#!/usr/bin/env node
import { connectMiraxDb, loadMiraxDbPassword } from './lib/mirax-db.mjs'

const apply = process.argv.includes('--apply')
if (!loadMiraxDbPassword()) process.exit(1)
const client = await connectMiraxDb()
try {
  await client.query('begin')
  const before = await client.query(`
    select
      count(*) filter (where cohort='adversarial')::int adversarial,
      (select count(*)::int from public.evaluation_judgments j join public.evaluation_cases c on c.id=j.case_id
       where c.dataset_version='mirax-gold-v5') judgments
    from public.evaluation_cases where dataset_version='mirax-gold-v5'
  `)
  const rejected = await client.query(`
    select distinct on (e.source_url,coalesce(e.candidate_ref,''))
      e.evaluation_run_id,e.search_id,e.vertical,e.source_id,e.source_url,e.publisher,
      e.candidate_ref,e.signal_type,e.observation_date,e.extraction_method,e.cost_eur,
      e.selection_reason,e.metadata,r.release_id
    from public.evaluation_source_events e
    join public.evaluation_runs r on r.id=e.evaluation_run_id
    where e.event_type='candidate_rejected' and e.source_url ~ '^https://'
      and coalesce(e.publisher,'')<>'' and r.dataset_version='mirax-gold-v5'
    order by e.source_url,coalesce(e.candidate_ref,''),e.created_at desc
    limit 15
  `)
  const perVertical = new Map()
  const rows = rejected.rows.map((row) => {
    const n = (perVertical.get(row.vertical) || 0) + 1
    perVertical.set(row.vertical, n)
    return {
      dataset_version: 'mirax-gold-v5', cohort: 'adversarial', origin_release_id: row.release_id,
      source_run_id: row.evaluation_run_id, vertical: row.vertical, case_number: 9000 + n,
      seller_profile: { vertical: row.vertical, adversarial_negative_control: true },
      query: `Adversarial replay: verify rejected ${row.vertical} candidate`,
      candidate_snapshot: {
        name: row.candidate_ref || row.publisher,
        website: row.source_url,
        domain: row.publisher,
        source_class: row.source_id,
        signal_type: row.signal_type,
        rejection_reason: row.selection_reason,
      },
      provenance: {
        engine: 'MIRAX_v5', source_event_type: 'candidate_rejected', source_id: row.source_id,
        source_url: row.source_url, publisher: row.publisher, observation_date: row.observation_date,
        extraction_method: row.extraction_method, cost_eur: Number(row.cost_eur || 0),
        selection_reason: row.selection_reason, search_id: row.search_id,
        evaluation_run_id: row.evaluation_run_id, source_event_metadata: row.metadata,
        human_ground_truth_required: true, selection_is_not_ground_truth: true,
        model_generated_labels_forbidden: true,
      },
      review_status: 'candidate_ready',
    }
  })
  if (rows.length) {
    await client.query(`
      insert into public.evaluation_cases(
        dataset_version,cohort,origin_release_id,source_run_id,vertical,case_number,
        seller_profile,query,candidate_snapshot,provenance,review_status
      ) select x.dataset_version,x.cohort,x.origin_release_id,x.source_run_id,x.vertical,x.case_number,
        x.seller_profile,x.query,x.candidate_snapshot,x.provenance,x.review_status
      from jsonb_to_recordset($1::jsonb) as x(
        dataset_version text,cohort text,origin_release_id text,source_run_id uuid,vertical text,
        case_number integer,seller_profile jsonb,query text,candidate_snapshot jsonb,provenance jsonb,review_status text
      ) on conflict(dataset_version,vertical,case_number) do nothing
    `, [JSON.stringify(rows)])
  }
  const after = await client.query(`
    select
      count(*) filter (where cohort='adversarial')::int adversarial,
      count(*) filter (where cohort='adversarial' and review_status='candidate_ready')::int ready,
      count(*) filter (where cohort='adversarial' and provenance->>'selection_is_not_ground_truth'='true')::int no_label_leakage,
      (select count(*)::int from public.evaluation_judgments j join public.evaluation_cases c on c.id=j.case_id
       where c.dataset_version='mirax-gold-v5') judgments
    from public.evaluation_cases where dataset_version='mirax-gold-v5'
  `)
  if (after.rows[0].judgments !== before.rows[0].judgments) throw new Error('adversarial promotion created a judgment')
  if (after.rows[0].ready !== after.rows[0].adversarial || after.rows[0].no_label_leakage !== after.rows[0].adversarial) {
    throw new Error(`adversarial provenance validation failed: ${JSON.stringify(after.rows[0])}`)
  }
  if (apply) {
    await client.query('commit')
  } else {
    await client.query('rollback')
  }
  console.log(JSON.stringify({ applied: apply, source_rejections_available: rows.length, before: before.rows[0], after: after.rows[0], human_labels_created: 0 }, null, 2))
} catch (error) {
  await client.query('rollback').catch(() => undefined)
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
} finally {
  await client.end()
}
