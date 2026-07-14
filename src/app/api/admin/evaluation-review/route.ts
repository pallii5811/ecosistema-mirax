import { NextRequest, NextResponse } from 'next/server'

import { requireEvaluationReviewer } from '@/lib/admin/require-evaluation-reviewer'
import { createServiceRoleClient } from '@/utils/supabase/server'

const LEGACY_DATASET = 'mirax-gold-v1'
const V5_DATASET = 'mirax-gold-v5'
const FINAL_TARGET = 200
const LEGACY_TARGET = 25
const LEGACY_CAP = 30
const V5_TARGET = 160
const ADVERSARIAL_TARGET = 15
const RELEASE = process.env.MIRAX_RELEASE_ID || '2026-07-14-atomic-review-gold-v5'

async function groundTruthRun(service: ReturnType<typeof createServiceRoleClient>, dataset: string, create: boolean) {
  const { data } = await service.from('evaluation_runs').select('id,status')
    .eq('dataset_version', dataset).eq('mode', 'offline')
    .eq('status', 'running')
    .contains('configuration', { purpose: 'human_ground_truth' })
    .order('started_at', { ascending: false }).limit(1).maybeSingle()
  if (data || !create) return data
  const { data: inserted, error } = await service.from('evaluation_runs').insert({
    dataset_version: dataset, release_id: RELEASE, mode: 'offline', status: 'running',
    configuration: {
      purpose: 'human_ground_truth', model_generated_labels_forbidden: true,
      cohort_policy: dataset === LEGACY_DATASET ? 'legacy_baseline_only' : 'v5_primary',
    },
  }).select('id,status').single()
  if (error) throw error
  return inserted
}

export async function GET() {
  const reviewer = await requireEvaluationReviewer()
  if (!reviewer.ok) return NextResponse.json({ error: reviewer.error }, { status: reviewer.status })
  const service = createServiceRoleClient()
  const { data: cases, error } = await service.from('evaluation_cases')
    .select('id,dataset_version,cohort,vertical,case_number,seller_profile,query,candidate_snapshot,provenance,review_status')
    .in('dataset_version', [LEGACY_DATASET, V5_DATASET]).order('created_at').order('case_number')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  let reviewedIds = new Set<string>()
  const caseIds = (cases || []).map((row) => String(row.id))
  if (caseIds.length > 0) {
    const { data: judgments, error: judgmentError } = await service.from('evaluation_judgments')
      .select('case_id').in('case_id', caseIds).eq('judge_id', reviewer.user.id).eq('is_human', true)
    if (judgmentError) return NextResponse.json({ error: judgmentError.message }, { status: 500 })
    reviewedIds = new Set((judgments || []).map((row) => String(row.case_id)))
  }
  const all = cases || []
  const legacy = all.filter((row) => row.dataset_version === LEGACY_DATASET)
  const v5 = all.filter((row) => row.dataset_version === V5_DATASET && row.cohort === 'v5_output')
  const adversarial = all.filter((row) => row.dataset_version === V5_DATASET && row.cohort === 'adversarial')
  const legacyReviewed = legacy.filter((row) => reviewedIds.has(String(row.id))).length
  const v5Reviewed = v5.filter((row) => reviewedIds.has(String(row.id))).length
  const adversarialReviewed = adversarial.filter((row) => reviewedIds.has(String(row.id))).length
  const nextV5 = v5Reviewed < V5_TARGET
    ? v5.find((row) => row.review_status === 'candidate_ready' && !reviewedIds.has(String(row.id))) : null
  const nextAdversarial = adversarialReviewed < ADVERSARIAL_TARGET
    ? adversarial.find((row) => row.review_status === 'candidate_ready' && !reviewedIds.has(String(row.id))) : null
  const nextLegacy = legacyReviewed < LEGACY_TARGET
    ? legacy.find((row) => row.review_status === 'candidate_ready' && !reviewedIds.has(String(row.id))) : null
  const next = nextV5 || nextAdversarial || nextLegacy || null
  const countedReviewed = Math.min(LEGACY_TARGET, legacyReviewed) + Math.min(V5_TARGET, v5Reviewed) + Math.min(ADVERSARIAL_TARGET, adversarialReviewed)
  return NextResponse.json({
    evaluation_version: V5_DATASET,
    progress: {
      reviewed: countedReviewed, total: FINAL_TARGET, remaining: Math.max(0, FINAL_TARGET - countedReviewed),
      legacy_baseline: { reviewed: legacyReviewed, target: LEGACY_TARGET, target_min: 20, cap: LEGACY_CAP, available: legacy.length },
      v5_output: { reviewed: v5Reviewed, target: V5_TARGET, available: v5.length },
      adversarial: { reviewed: adversarialReviewed, target: ADVERSARIAL_TARGET, available: adversarial.length },
    },
    case: next,
  }, { headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(req: NextRequest) {
  const reviewer = await requireEvaluationReviewer()
  if (!reviewer.ok) return NextResponse.json({ error: reviewer.error }, { status: reviewer.status })
  const body = await req.json().catch(() => null) as Record<string, unknown> | null
  if (!body) return NextResponse.json({ error: 'JSON non valido' }, { status: 400 })
  const caseId = String(body.case_id || '')
  const label = String(body.label || '')
  const reason = String(body.reason || '').trim()
  const officialDomain = String(body.official_domain || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '')
  const companySize = String(body.company_size_class || '')
  const sourceUrl = String(body.source_url || '').trim()
  const signalDate = String(body.signal_date || '')
  const contactStatus = String(body.contact_extraction_status || '')
  const booleans = ['buyer_fit','official_domain_correct','entity_class_correct','evidence_supports_claim','signal_fresh','top_tier'] as const
  if (!/^[0-9a-f-]{36}$/i.test(caseId) || !['positive','negative'].includes(label)) {
    return NextResponse.json({ error: 'Caso o label non valido' }, { status: 400 })
  }
  if (reason.length < 20 || !officialDomain || !/^https:\/\//i.test(sourceUrl) || Number.isNaN(Date.parse(signalDate))) {
    return NextResponse.json({ error: 'Motivazione, dominio, URL fonte HTTPS e data sono obbligatori' }, { status: 400 })
  }
  if (!['micro','small','medium','large','not_operating','unknown'].includes(companySize) ||
      !['available_extracted','available_missed','not_public','not_checked'].includes(contactStatus) ||
      booleans.some((key) => typeof body[key] !== 'boolean') || body.human_certification !== true) {
    return NextResponse.json({ error: 'Tutti i controlli umani espliciti sono obbligatori' }, { status: 400 })
  }

  const service = createServiceRoleClient()
  const { data: reviewCase, error: caseError } = await service.from('evaluation_cases')
    .select('dataset_version,cohort,review_status,candidate_snapshot').eq('id', caseId)
    .in('dataset_version', [LEGACY_DATASET, V5_DATASET]).maybeSingle()
  if (caseError || !reviewCase) return NextResponse.json({ error: caseError?.message || 'Caso non disponibile' }, { status: 404 })
  if (!['candidate_ready','labeled'].includes(String(reviewCase.review_status)) || !reviewCase.candidate_snapshot) {
    return NextResponse.json({ error: 'Evidence packet non pronto per la review' }, { status: 409 })
  }
  const run = await groundTruthRun(service, String(reviewCase.dataset_version), true)
  if (!run?.id) return NextResponse.json({ error: 'Ground-truth run non disponibile' }, { status: 500 })
  const { error: judgmentError } = await service.rpc('submit_human_evaluation_judgment', {
    p_case_id: caseId, p_run_id: run.id, p_judge_id: reviewer.user.id, p_label: label,
    p_reason: reason, p_official_domain: officialDomain, p_company_size_class: companySize,
    p_signal_date: new Date(signalDate).toISOString(), p_source_url: sourceUrl,
    p_buyer_fit: body.buyer_fit, p_official_domain_correct: body.official_domain_correct,
    p_entity_class_correct: body.entity_class_correct, p_evidence_supports_claim: body.evidence_supports_claim,
    p_signal_fresh: body.signal_fresh, p_contact_extraction_status: contactStatus, p_top_tier: body.top_tier,
  })
  if (judgmentError) return NextResponse.json({ error: judgmentError.message }, { status: 500 })
  const { count } = await service.from('evaluation_judgments').select('id', { count: 'exact', head: true })
    .eq('run_id', run.id).eq('judge_id', reviewer.user.id).eq('is_human', true)
  return NextResponse.json({
    ok: true, dataset_version: reviewCase.dataset_version, cohort: reviewCase.cohort,
    reviewed_in_dataset: count || 0, final_target: FINAL_TARGET,
  })
}
