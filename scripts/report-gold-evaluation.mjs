#!/usr/bin/env node
import { connectMiraxDb, loadMiraxDbPassword } from './lib/mirax-db.mjs'
import { buildGoldEvaluationReport } from './lib/gold-evaluation-metrics.mjs'

if (!loadMiraxDbPassword()) process.exit(1)
const client = await connectMiraxDb()
try {
  const result = await client.query(`
    with latest as (
      select distinct on (j.case_id) j.*
      from public.evaluation_judgments j
      where j.is_human
      order by j.case_id,j.created_at desc
    )
    select c.dataset_version,c.cohort,c.vertical,c.id case_id,c.candidate_snapshot,c.provenance,
      l.label,l.buyer_fit,l.official_domain_correct,l.entity_class_correct,
      l.evidence_supports_claim,l.signal_fresh,l.contact_extraction_status,l.top_tier,
      x.expected_source_policy
    from public.evaluation_cases c
    left join latest l on l.case_id=c.id
    left join public.evaluation_expected_labels x on x.case_id=c.id
    where c.dataset_version in ('mirax-gold-v1','mirax-gold-v5')
    order by c.dataset_version,c.cohort,c.vertical,c.case_number
  `)
  const report = buildGoldEvaluationReport(result.rows)
  console.log(JSON.stringify(report, null, 2))
  if (!report.production_acceptance_ready && !process.argv.includes('--allow-incomplete')) process.exitCode = 2
} finally { await client.end() }
