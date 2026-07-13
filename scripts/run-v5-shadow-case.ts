import fs from 'node:fs'
import { config } from 'dotenv'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import { buildMiraxQueryPlan } from '../src/lib/uqe/mirax-query-planner'
import { PersistentResearchCostGovernor } from '../src/lib/research/persistent-cost-governor'
import { MIRAX_RELEASE_ID } from '../src/app/api/ops/release/route'
import { SOURCE_BY_ID, sourceSupportsSignal } from '../src/lib/source-intelligence/registry'

config({ path: '.env.local' })
config({ path: '.env' })

const args = new Map(process.argv.slice(2).map((arg) => {
  const [key, ...rest] = arg.replace(/^--/, '').split('=')
  return [key, rest.join('=') || 'true']
}))
const action = args.get('action') || 'status'
const vertical = args.get('vertical') || ''
const manifest = JSON.parse(fs.readFileSync('evaluation/canary-v1/manifest.json', 'utf8')) as {
  canaries: Array<{ vertical: string; query: string; expected_signal_any: string[] }>
}
const selectedSpec = manifest.canaries.find((row) => row.vertical === vertical)
if (!selectedSpec) throw new Error(`unknown vertical: ${vertical}`)
const spec: { vertical: string; query: string; expected_signal_any: string[] } = selectedSpec

const maxLeads = 5
const hardBudgetEur = 0.125
const datasetVersion = 'mirax-gold-v5'

function required(name: string) {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} required`)
  return value
}

function db(): SupabaseClient {
  return createClient(required('NEXT_PUBLIC_SUPABASE_URL'), required('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false },
  })
}

function canonicalDomain(value: unknown): string {
  try { return new URL(String(value || '')).hostname.toLowerCase().replace(/^www\./, '') } catch { return '' }
}

function leadName(row: Record<string, unknown>) {
  return String(row.azienda || row.nome || row.name || '').trim()
}

function leadWebsite(row: Record<string, unknown>) {
  return String(row.sito || row.website || row.url || '').trim()
}

function leadSourceUrl(row: Record<string, unknown>) {
  const direct = String(row.source_url || row.evidence_url || '').trim()
  if (direct.startsWith('https://') || direct.startsWith('http://')) return direct
  const jobs = Array.isArray(row.business_hiring_jobs) ? row.business_hiring_jobs : []
  const job = jobs.find((item) => item && typeof item === 'object' && String((item as Record<string, unknown>).url || '').startsWith('http'))
  return job ? String((job as Record<string, unknown>).url) : ''
}

function leadSignals(row: Record<string, unknown>): string[] {
  const direct = Array.isArray(row.matched_signals) ? row.matched_signals.map(String) : []
  const business = Array.isArray(row.business_signals) ? row.business_signals : []
  return [...new Set([...direct, ...business.map((item) =>
    item && typeof item === 'object' ? String((item as Record<string, unknown>).type || '') : '',
  )].filter(Boolean))]
}

function sourceFromQuery(query: string, fallback: string): string {
  if (/indeed|infojobs|linkedin\.com\/jobs|career|lavora con noi/i.test(query)) return 'job_board'
  if (/anac|ted\.europa|appalt|gara|procurement/i.test(query)) return 'public_procurement_portal'
  if (/registro imprese|camera di commercio|bilanc|societar/i.test(query)) return 'official_registry'
  if (/news|notizie|comunicato|stampa/i.test(query)) return 'recognized_local_news'
  if (/meta ads|facebook ads|google ads|ad library/i.test(query)) return 'ad_transparency_library'
  if (/linkedin|instagram|facebook/i.test(query)) return 'official_social_profile'
  return fallback
}

async function activeGuards(service: SupabaseClient) {
  const [{ count: activeCanaries, error: canaryError }, { count: activeJobs, error: jobError }, { count: stale, error: staleError }] = await Promise.all([
    service.from('canary_runs').select('id', { count: 'exact', head: true }).in('status', ['created', 'running']),
    service.from('searches').select('id', { count: 'exact', head: true }).in('status', ['planning', 'pending', 'pending_user', 'processing', 'running']),
    service.from('search_cost_ledger').select('id', { count: 'exact', head: true }).eq('status', 'reserved').lt('reservation_expires_at', new Date().toISOString()),
  ])
  if (canaryError || jobError || staleError) throw canaryError || jobError || staleError
  if ((activeCanaries || 0) || (activeJobs || 0) || (stale || 0)) {
    throw new Error(`unsafe active state canaries=${activeCanaries} jobs=${activeJobs} stale=${stale}`)
  }
}

async function prepare() {
  required('ANTHROPIC_API_KEY')
  const service = db()
  await activeGuards(service)
  const { data: intentGate } = await service.from('evaluation_runs').select('id,status,metrics')
    .eq('dataset_version', datasetVersion).eq('mode', 'intent_canary').eq('status', 'completed')
    .order('started_at', { ascending: false }).limit(1).maybeSingle()
  if (!intentGate?.id || !Object.values((intentGate.metrics as any)?.checks || {}).every(Boolean)) {
    throw new Error('valid intent gate required')
  }
  const { data: search, error: searchError } = await service.from('searches').insert({
    category: `Evaluation shadow ${vertical}`, location: 'Italia', zone: String(maxLeads),
    status: 'planning', results: [],
    intent: { original_query: spec.query, query: spec.query, requested_leads: maxLeads, max_leads: maxLeads, lead_target: maxLeads, customer_visible: false, lifecycle_stage: 'v5_shadow' },
  }).select('id').single()
  if (searchError || !search?.id) throw new Error(searchError?.message || 'search insert failed')
  const searchId = String(search.id)
  const { data: run, error: runError } = await service.from('evaluation_runs').insert({
    dataset_version: datasetVersion, release_id: MIRAX_RELEASE_ID, mode: 'shadow_research', status: 'running',
    configuration: { vertical, query: spec.query, max_leads: maxLeads, hard_budget_eur: hardBudgetEur, customer_visible: false, source_planner: 'canonical_v5' },
  }).select('id').single()
  if (runError || !run?.id) throw new Error(runError?.message || 'run insert failed')
  const runId = String(run.id)
  const { data: canary, error: canaryError } = await service.from('canary_runs').insert({
    evaluation_run_id: runId, search_id: searchId, canary_type: `shadow_${vertical}`,
    exact_query: spec.query, max_leads: maxLeads, hard_budget_eur: hardBudgetEur,
    shadow_mode: true, customer_visible: false, worker_limit: 1, status: 'running',
  }).select('id').single()
  if (canaryError || !canary?.id) throw new Error(canaryError?.message || 'canary insert failed')
  const canaryId = String(canary.id)
  const compilerDiagnostics: Array<{ stage: string; issues: Array<{ code: string; path: string; message: string }> }> = []
  let sourcePlanDiagnostics: Record<string, unknown> = {}
  try {
    const meter = new PersistentResearchCostGovernor(service)
    await meter.initialize(searchId, maxLeads)
    const plan = await buildMiraxQueryPlan(spec.query, {
      requestedLeadCount: maxLeads, searchId, costMeter: meter, allowRepair: false,
      onDiagnostic: (event) => compilerDiagnostics.push(event),
    })
    const canonical = plan.canonical_plan
    const requiredSignals = canonical?.signal_policy.required_signals || []
    const allowedSources = canonical?.source_policy.allowed_source_classes || []
    const executableSourcePlan = plan.source_plan || []
    const checks = {
      canonical_present: Boolean(canonical),
      required_signals_present: requiredSignals.length > 0,
      expected_signal_matched: requiredSignals.some((signal) => spec.expected_signal_any.includes(signal)),
      no_unexpected_signals: requiredSignals.every((signal) => spec.expected_signal_any.includes(signal)),
      not_maps: plan.search_strategy !== 'maps',
      compatible_source_per_signal: requiredSignals.every((signal) =>
        allowedSources.some((source) => sourceSupportsSignal(source, signal))),
      source_plan_present: executableSourcePlan.length > 0,
      source_templates_present: executableSourcePlan.length > 0 && executableSourcePlan.every(
        (lane) => Array.isArray(lane.query_templates) && lane.query_templates.some((template) => String(template).trim()),
      ),
      source_lane_signal_compatible: executableSourcePlan.length > 0 && executableSourcePlan.every((lane) =>
        lane.expected_evidence.length > 0 &&
        lane.expected_evidence.every((signal) => requiredSignals.includes(signal)) &&
        lane.expected_evidence.every((signal) => lane.source_types.some((source) => sourceSupportsSignal(source, signal))),
      ),
      source_plan_covers_all_signals: requiredSignals.every((signal) => executableSourcePlan.some((lane) =>
        lane.expected_evidence.includes(signal) &&
        lane.source_types.some((source) => sourceSupportsSignal(source, signal)))),
      llm_plan: plan.parse_source === 'llm',
    }
    sourcePlanDiagnostics = {
      checks,
      required_signals: requiredSignals,
      expected_signal_any: spec.expected_signal_any,
      unexpected_signals: requiredSignals.filter((signal) => !spec.expected_signal_any.includes(signal)),
      allowed_sources: allowedSources,
      search_strategy: plan.search_strategy,
      parse_source: plan.parse_source,
    }
    const sourcePlanReady = Object.values(checks).every(Boolean)
    if (!sourcePlanReady || plan.parse_source !== 'llm') {
      const codes = compilerDiagnostics.flatMap((event) => event.issues.map((issue) => issue.code))
      throw new Error(`SHADOW_SOURCE_PLAN_INVALID${codes.length ? `:${[...new Set(codes)].join(',')}` : ''}`)
    }
    const intent = {
      original_query: spec.query, query: spec.query, requested_leads: maxLeads, max_leads: maxLeads,
      lead_target: maxLeads, customer_visible: false, lifecycle_stage: 'v5_shadow',
      required_signals: plan.required_signals, signals: plan.required_signals.map((type) => ({ type, params: {} })),
      source_plan: plan.source_plan, search_strategy: plan.search_strategy, uqe_plan: plan,
    }
    const { error: readyError } = await service.from('searches').update({
      category: plan.sector || `Evaluation shadow ${vertical}`, location: plan.location || 'Italia',
      intent, status: 'pending', results: [],
    }).eq('id', searchId)
    if (readyError) throw readyError
    const selected = allowedSources.map((sourceId) => {
      const source = SOURCE_BY_ID.get(sourceId)
      return {
        evaluation_run_id: runId, canary_run_id: canaryId, search_id: searchId, vertical,
        source_id: sourceId, event_type: 'selected', extraction_method: source?.extraction_method || 'unknown',
        cost_eur: 0, selection_reason: `Canonical source planner selected for signals: ${requiredSignals.join(', ')}`,
        metadata: { query: spec.query, required_signals: requiredSignals, preferred: canonical?.source_policy.preferred_source_classes.includes(sourceId) || false },
      }
    })
    if (selected.length) {
      const { error } = await service.from('evaluation_source_events').insert(selected)
      if (error) throw error
    }
    console.log(JSON.stringify({ ok: true, action: 'prepared', vertical, run_id: runId, canary_id: canaryId, search_id: searchId, plan }, null, 2))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await service.from('evaluation_runs').update({
      status: 'failed',
      metrics: { error: message, compiler_diagnostics: compilerDiagnostics, source_plan_diagnostics: sourcePlanDiagnostics },
      completed_at: new Date().toISOString(),
    }).eq('id', runId)
    await service.from('canary_runs').update({ status: 'quarantined', stop_reason: message, completed_at: new Date().toISOString() }).eq('id', canaryId)
    await service.from('searches').update({ status: 'cancelled', progress: { error: message }, results: [] }).eq('id', searchId)
    console.error(JSON.stringify({
      ok: false, action: 'prepare', vertical, run_id: runId, canary_id: canaryId,
      search_id: searchId, error: message, compiler_diagnostics: compilerDiagnostics,
      source_plan_diagnostics: sourcePlanDiagnostics,
    }, null, 2))
    throw error
  }
}

async function finalize() {
  const service = db()
  const { data: run, error: runError } = await service.from('evaluation_runs').select('id,configuration')
    .eq('dataset_version', datasetVersion).eq('mode', 'shadow_research').contains('configuration', { vertical })
    .order('started_at', { ascending: false }).limit(1).maybeSingle()
  if (runError || !run?.id) throw new Error(runError?.message || 'shadow run missing')
  const runId = String(run.id)
  const { data: canary, error: canaryError } = await service.from('canary_runs').select('id,search_id,hard_budget_eur')
    .eq('evaluation_run_id', runId).limit(1).maybeSingle()
  if (canaryError || !canary?.id || !canary.search_id) throw new Error(canaryError?.message || 'shadow canary missing')
  const canaryId = String(canary.id)
  const searchId = String(canary.search_id)
  const [{ data: search, error: searchError }, { data: ledger, error: ledgerError }, { data: lifecycle, error: lifecycleError }, { count: publicationCount, error: publicationError }] = await Promise.all([
    service.from('searches').select('status,results,intent,progress').eq('id', searchId).single(),
    service.from('search_cost_ledger').select('operation_type,source_class,provider,model,actual_cost_eur,estimated_cost_eur,status,metadata').eq('search_id', searchId),
    service.from('search_candidates').select('id,stage,canonical_domain,entity_name,payload,rejection_code,rejection_detail,signal_verified,evidence_policy_passed,official_domain_verified,target_fit_verified,audit_completed,entity_resolution_confidence,operating_company_probability,official_domain_confidence,is_operating_buyer,is_global_brand,is_media,is_directory,is_university,is_public_body,is_source_publisher').eq('search_id', searchId),
    service.from('search_publications').select('id', { count: 'exact', head: true }).eq('search_id', searchId),
  ])
  if (searchError || ledgerError || lifecycleError || publicationError) throw searchError || ledgerError || lifecycleError || publicationError
  const rawResults = Array.isArray(search?.results) ? search.results.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === 'object') : []
  const lifecycleRows = lifecycle || []
  const candidates = rawResults.slice(0, maxLeads)
  // Raw worker rows are telemetry, not gold data. Shadow output becomes
  // eligible only after the exact server-side publication gate qualifies it.
  const qualifiedLifecycle = lifecycleRows.filter((row) =>
    row.stage === 'qualified' &&
    !row.rejection_code &&
    row.official_domain_verified === true &&
    row.target_fit_verified === true &&
    row.signal_verified === true &&
    row.evidence_policy_passed === true &&
    row.audit_completed === true &&
    Number(row.entity_resolution_confidence || 0) >= 0.7 &&
    Number(row.operating_company_probability || 0) >= 0.75 &&
    Number(row.official_domain_confidence || 0) >= 0.7 &&
    row.is_operating_buyer === true &&
    row.is_global_brand === false && row.is_media === false && row.is_directory === false &&
    row.is_university === false && row.is_public_body === false && row.is_source_publisher === false,
  )
  const validated = qualifiedLifecycle
    .map((row) => row.payload)
    .filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === 'object')
    .filter((row) => leadName(row) && canonicalDomain(leadWebsite(row)) && leadSourceUrl(row) && leadSignals(row).length > 0)
  const actualCost = (ledger || []).reduce((sum, row) => sum + Number(row.actual_cost_eur ?? row.estimated_cost_eur ?? 0), 0)
  const extractionCost = (ledger || []).filter((row) => row.operation_type === 'llm_extract')
    .reduce((sum, row) => sum + Number(row.actual_cost_eur ?? row.estimated_cost_eur ?? 0), 0)
  const queryAttributableCost = Math.max(0, actualCost - extractionCost)
  const queryYield = (search?.intent as any)?.agentic_stats?.query_yield || {}
  const allowedSources = ((search?.intent as any)?.uqe_plan?.canonical_plan?.source_policy?.allowed_source_classes || ['official_company_website']) as string[]
  const fallbackSource = allowedSources[0] || 'official_company_website'
  const queryEntries = Object.entries(queryYield) as Array<[string, { pages?: number; leads?: number }]>
  const queriedEvents = queryEntries.map(([query, stats]) => ({
    evaluation_run_id: runId, canary_run_id: canaryId, search_id: searchId, vertical,
    source_id: sourceFromQuery(query, fallbackSource), event_type: 'queried',
    extraction_method: SOURCE_BY_ID.get(sourceFromQuery(query, fallbackSource))?.extraction_method || 'search_and_http',
    cost_eur: queryEntries.length ? queryAttributableCost / queryEntries.length : 0,
    selection_reason: 'Executed query emitted by canonical source planner',
    metadata: { query, pages: Number(stats?.pages || 0), candidates_produced: Number(stats?.leads || 0) },
  }))
  const candidateEvents = candidates.map((row, index) => {
    const url = leadSourceUrl(row)
    const signals = leadSignals(row)
    return {
      evaluation_run_id: runId, canary_run_id: canaryId, search_id: searchId, vertical,
      source_id: sourceFromQuery(url, fallbackSource), source_url: url || null,
      publisher: canonicalDomain(url), event_type: 'candidate_produced',
      candidate_ref: canonicalDomain(leadWebsite(row)) || `result-${index + 1}`,
      signal_type: signals[0] || null, observation_date: String(row.evidence_date || row.observed_at || new Date().toISOString()),
      extraction_method: String(row.source_lane || 'worker_evidence_pipeline'), cost_eur: 0,
      selection_reason: 'Produced by isolated v5 shadow worker from executed source query',
      metadata: { query: spec.query, company: leadName(row), signals },
    }
  })
  const rejectedEvents = lifecycleRows.filter((row) => row.stage === 'rejected').map((row) => ({
    evaluation_run_id: runId, canary_run_id: canaryId, search_id: searchId, vertical,
    source_id: fallbackSource, event_type: 'candidate_rejected', candidate_ref: row.canonical_domain || row.id,
    extraction_method: 'commercial_lifecycle_gate', cost_eur: 0,
    selection_reason: String(row.rejection_detail || row.rejection_code || 'quality_gate_failed').slice(0, 1000),
    metadata: { company: row.entity_name, rejection_code: row.rejection_code, rejection_detail: row.rejection_detail },
  }))
  const extractionRejectedEvents = (ledger || []).filter((row) =>
    row.operation_type === 'llm_extract' && String((row.metadata as Record<string, unknown> | null)?.source_url || '').startsWith('http'),
  ).map((row, index) => {
    const sourceUrl = String((row.metadata as Record<string, unknown>).source_url)
    return {
      evaluation_run_id: runId, canary_run_id: canaryId, search_id: searchId, vertical,
      source_id: sourceFromQuery(sourceUrl, fallbackSource), source_url: sourceUrl,
      publisher: canonicalDomain(sourceUrl), event_type: 'candidate_rejected',
      candidate_ref: `extraction-${index + 1}`, extraction_method: 'llm_extract_then_quality_gate',
      cost_eur: Number(row.actual_cost_eur ?? row.estimated_cost_eur ?? 0),
      selection_reason: 'Raw extraction did not pass requested-signal/entity/SME validation and was not retained',
      metadata: { operation_type: row.operation_type, outcome: (row.metadata as Record<string, unknown>).outcome || null },
    }
  })
  const confirmedEvents = validated.map((row) => ({
    evaluation_run_id: runId, canary_run_id: canaryId, search_id: searchId, vertical,
    source_id: sourceFromQuery(leadSourceUrl(row), fallbackSource), source_url: leadSourceUrl(row),
    publisher: canonicalDomain(leadSourceUrl(row)), event_type: 'signal_confirmed',
    candidate_ref: canonicalDomain(leadWebsite(row)), signal_type: leadSignals(row)[0],
    observation_date: String(row.evidence_date || row.observed_at || new Date().toISOString()),
    extraction_method: String(row.source_lane || 'worker_evidence_pipeline'), cost_eur: 0,
    selection_reason: 'Machine validation retained official domain, source URL and requested signal',
    metadata: { query: spec.query, company: leadName(row), signals: leadSignals(row) },
  }))
  const eventRows = [...queriedEvents, ...candidateEvents, ...rejectedEvents, ...extractionRejectedEvents, ...confirmedEvents]
  if (eventRows.length) {
    const { error } = await service.from('evaluation_source_events').insert(eventRows)
    if (error) throw error
  }
  const existing = await service.from('evaluation_cases').select('case_number').eq('dataset_version', datasetVersion).eq('vertical', vertical).order('case_number', { ascending: false }).limit(1).maybeSingle()
  let number = Number(existing.data?.case_number || 0)
  const caseRows = validated.map((row) => ({
    dataset_version: datasetVersion, cohort: 'v5_output', origin_release_id: MIRAX_RELEASE_ID,
    source_run_id: runId, vertical, case_number: ++number,
    seller_profile: { vertical, query: spec.query }, query: spec.query,
    candidate_snapshot: row,
    provenance: {
      engine: 'MIRAX_v5', shadow_only: true, customer_visible: false, search_id: searchId,
      evaluation_run_id: runId, source_url: leadSourceUrl(row), publisher: canonicalDomain(leadSourceUrl(row)),
      observation_date: row.evidence_date || row.observed_at || null,
      extraction_method: row.source_lane || 'worker_evidence_pipeline',
      cost_eur_total_run: actualCost, selection_reason: 'Passed machine validation; human ground truth still required',
      human_ground_truth_required: true, selection_is_not_ground_truth: true,
    },
    review_status: 'candidate_ready',
  }))
  if (caseRows.length) {
    const { error } = await service.from('evaluation_cases').insert(caseRows)
    if (error) throw error
  }
  const passed = validated.length >= 3 && validated.length <= 5 && actualCost <= hardBudgetEur && (publicationCount || 0) === 0 && search?.status === 'completed'
  const metrics = {
    vertical, status: search?.status, candidates_produced: candidates.length,
    candidates_validated: validated.length, lifecycle_qualified: qualifiedLifecycle.length,
    candidates_rejected: rejectedEvents.length + extractionRejectedEvents.length,
    sources_selected: allowedSources, sources_queried: queryEntries.map(([query]) => query),
    cost_eur: actualCost, cost_per_candidate_eur: candidates.length ? actualCost / candidates.length : null,
    cost_per_validated_lead_eur: validated.length ? actualCost / validated.length : null,
    customer_publications: publicationCount || 0, agentic_stats: (search?.intent as any)?.agentic_stats || {},
  }
  await service.from('evaluation_runs').update({ status: passed ? 'completed' : 'failed', metrics, completed_at: new Date().toISOString() }).eq('id', runId)
  await service.from('canary_runs').update({ status: passed ? 'completed' : 'quarantined', stop_reason: passed ? 'shadow_case_complete' : 'shadow_acceptance_failed', completed_at: new Date().toISOString() }).eq('id', canaryId)
  if (!passed) {
    await service.from('searches').update({
      status: 'cancelled', progress: { ...(search?.progress as Record<string, unknown> || {}), stop_reason: 'shadow_acceptance_failed' },
    }).eq('id', searchId)
  }
  console.log(JSON.stringify({ ok: passed, action: 'finalized', run_id: runId, canary_id: canaryId, search_id: searchId, metrics }, null, 2))
  if (!passed) process.exitCode = 2
}

async function main() {
  if (action === 'prepare') await prepare()
  else if (action === 'finalize') await finalize()
  else throw new Error('action must be prepare or finalize')
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
