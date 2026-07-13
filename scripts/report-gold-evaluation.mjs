#!/usr/bin/env node
import { connectMiraxDb, loadMiraxDbPassword } from './lib/mirax-db.mjs'

function wilson(successes, total, z = 1.959963984540054) {
  if (!total) return null
  const p = successes / total
  const denominator = 1 + z * z / total
  const center = (p + z * z / (2 * total)) / denominator
  const margin = z * Math.sqrt((p * (1 - p) + z * z / (4 * total)) / total) / denominator
  return { numerator: successes, denominator: total, estimate: p, wilson_95: [Math.max(0, center - margin), Math.min(1, center + margin)] }
}

function cohortMetrics(rows, label) {
  const judged = rows.filter((row) => row.label)
  const metric = (predicate) => wilson(judged.filter(predicate).length, judged.length)
  const contacts = judged.filter((row) => ['available_extracted','available_missed'].includes(row.contact_extraction_status))
  return {
    label,
    cases_available: rows.length,
    human_judgments: judged.length,
    human_positive_rate: wilson(judged.filter((row) => row.label === 'positive').length, judged.length),
    buyer_fit: metric((row) => row.buyer_fit === true),
    official_domain: metric((row) => row.official_domain_correct === true),
    entity_class: metric((row) => row.entity_class_correct === true),
    signal_validity_and_evidence: metric((row) => row.evidence_supports_claim === true),
    freshness: metric((row) => row.signal_fresh === true),
    contact_validity: wilson(contacts.filter((row) => row.contact_extraction_status === 'available_extracted').length, contacts.length),
    top_tier: metric((row) => row.top_tier === true),
  }
}

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
      l.evidence_supports_claim,l.signal_fresh,l.contact_extraction_status,l.top_tier
    from public.evaluation_cases c
    left join latest l on l.case_id=c.id
    where c.dataset_version in ('mirax-gold-v1','mirax-gold-v5')
    order by c.dataset_version,c.cohort,c.vertical,c.case_number
  `)
  const rows = result.rows
  const legacyRows = rows.filter((row) => row.dataset_version === 'mirax-gold-v1')
  const v5Rows = rows.filter((row) => row.dataset_version === 'mirax-gold-v5' && row.cohort === 'v5_output')
  const adversarialRows = rows.filter((row) => row.dataset_version === 'mirax-gold-v5' && row.cohort === 'adversarial')
  const legacy = cohortMetrics(legacyRows, 'LEGACY BASELINE — calibration/regression only; not v5 precision')
  const v5 = cohortMetrics(v5Rows, 'V5 OUTPUT — primary certification cohort')
  const adversarial = cohortMetrics(adversarialRows, 'ADVERSARIAL/NEGATIVE — separate robustness cohort')
  const countedLegacy = Math.min(30, legacy.human_judgments)
  const finalJudgments = countedLegacy + v5.human_judgments + adversarial.human_judgments
  const report = {
    evaluation_version: 'mirax-gold-v5', generated_at: new Date().toISOString(),
    final_target: 200,
    composition_target: { v5_output: 160, legacy_baseline: 25, adversarial: 15 },
    legacy_baseline: legacy,
    v5_evaluation_dataset: v5,
    adversarial_dataset: adversarial,
    final_progress: { completed: finalJudgments, remaining: Math.max(0, 200 - finalJudgments) },
    v5_precision: v5.human_judgments ? v5 : null,
    final_acceptance_ready: finalJudgments === 200 && v5.human_judgments >= 150 && adversarial.human_judgments >= 10,
    warning: 'Never interpret legacy_baseline metrics as MIRAX v5 precision.',
  }
  console.log(JSON.stringify(report, null, 2))
  if (!report.final_acceptance_ready && !process.argv.includes('--allow-incomplete')) process.exitCode = 2
} finally { await client.end() }
