#!/usr/bin/env node
import { connectMiraxDb, loadMiraxDbPassword } from './lib/mirax-db.mjs'

if (!loadMiraxDbPassword()) process.exit(1)
const client = await connectMiraxDb()
try {
  const result = await client.query(`
    select
      c.id,
      c.vertical,
      c.case_number,
      c.review_status,
      c.candidate_snapshot->>'name' as candidate_name,
      c.candidate_snapshot->>'domain' as candidate_domain,
      c.candidate_snapshot->>'website' as candidate_website,
      c.provenance->>'source_event_type' as source_event_type,
      c.provenance->>'source_id' as source_id,
      c.provenance->>'source_url' as source_url,
      c.provenance->>'publisher' as publisher,
      c.provenance->>'selection_reason' as selection_reason,
      exists(select 1 from public.evaluation_judgments j where j.case_id=c.id) as has_judgment,
      exists(
        select 1
        from public.evaluation_source_events e
        where e.evaluation_run_id=c.source_run_id
          and e.event_type='candidate_rejected'
          and coalesce(e.candidate_ref,'')=coalesce(c.candidate_snapshot->>'name','')
          and e.candidate_ref !~ '^extraction-[0-9]+$'
      ) as backed_by_real_candidate
    from public.evaluation_cases c
    where c.dataset_version='mirax-gold-v5' and c.cohort='adversarial'
    order by c.vertical,c.case_number
  `)
  const rows = result.rows.map((row) => ({
    ...row,
    invalid_extraction_artifact:
      row.source_event_type === 'candidate_rejected' &&
      /^extraction-[0-9]+$/.test(String(row.candidate_name || '')) &&
      !row.backed_by_real_candidate,
  }))
  console.log(JSON.stringify({
    adversarial_cases: rows.length,
    invalid_extraction_artifacts: rows.filter((row) => row.invalid_extraction_artifact).length,
    human_reviewed: rows.filter((row) => row.has_judgment).length,
    rows,
  }, null, 2))
} finally {
  await client.end()
}
