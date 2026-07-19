import fs from 'node:fs'
import { config } from 'dotenv'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import { buildMiraxQueryPlan } from '../src/lib/uqe/mirax-query-planner'
import { PersistentResearchCostGovernor } from '../src/lib/research/persistent-cost-governor'
import { MIRAX_RELEASE_ID } from '../src/app/api/ops/release/route'
import { SOURCE_BY_ID, sourceSupportsSignal } from '../src/lib/source-intelligence/registry'
import {
  buildQueriedSourceEvents,
  canonicalDomain,
  leadEvidenceUrl,
  sourceMetadataFromLead,
  type CostLedgerRow,
  type QueryYieldStats,
} from '../src/lib/evaluation/v5-source-telemetry'

config({ path: '.env.local' })
config({ path: '.env' })

const args = new Map(process.argv.slice(2).map((arg) => {
  const [key, ...rest] = arg.replace(/^--/, '').split('=')
  return [key, rest.join('=') || 'true']
}))
const action = args.get('action') || 'status'
const vertical = args.get('vertical') || ''
const queryOverride = String(args.get('query') || '').trim()
const expectedSignalsOverride = String(args.get('expected-signals') || '')
  .split(',').map((value) => value.trim()).filter(Boolean)
const manifest = JSON.parse(fs.readFileSync('evaluation/canary-v1/manifest.json', 'utf8')) as {
  canaries: Array<{ vertical: string; query: string; expected_signal_any: string[] }>
}
const selectedSpec = queryOverride
  ? { vertical, query: queryOverride, expected_signal_any: expectedSignalsOverride }
  : manifest.canaries.find((row) => row.vertical === vertical)
if (!selectedSpec) throw new Error(`unknown vertical: ${vertical}`)
const spec: { vertical: string; query: string; expected_signal_any: string[] } = selectedSpec

const requestedMaxLeads = Number(args.get('max-leads') || 5)
if (!Number.isInteger(requestedMaxLeads) || requestedMaxLeads < 1 || requestedMaxLeads > 5) {
  throw new Error('--max-leads must be an integer between 1 and 5')
}
if (queryOverride && !vertical) throw new Error('--vertical required with --query')
if (queryOverride && expectedSignalsOverride.length === 0) {
  throw new Error('--expected-signals required with --query')
}
const maxLeads = requestedMaxLeads
const hardBudgetEur = 0.125
const datasetVersion = 'mirax-gold-v5'

function required(name: string) {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} required`)
  return value
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function db(): SupabaseClient {
  return createClient(required('NEXT_PUBLIC_SUPABASE_URL'), required('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false },
  })
}

function leadName(row: Record<string, unknown>) {
  return String(row.azienda || row.nome || row.name || '').trim()
}

function leadWebsite(row: Record<string, unknown>) {
  return String(row.sito || row.website || row.url || '').trim()
}

function leadSourceUrl(row: Record<string, unknown>) {
  return leadEvidenceUrl(row)
}

function leadSignals(row: Record<string, unknown>): string[] {
  const direct = Array.isArray(row.matched_signals) ? row.matched_signals.map(String) : []
  const business = Array.isArray(row.business_signals) ? row.business_signals : []
  return [...new Set([...direct, ...business.map((item) =>
    item && typeof item === 'object' ? String((item as Record<string, unknown>).type || '') : '',
  )].filter(Boolean))]
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
  const intentChecks = asRecord(asRecord(intentGate?.metrics).checks)
  if (!intentGate?.id || Object.keys(intentChecks).length === 0 || !Object.values(intentChecks).every(Boolean)) {
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
  const searchIntent = asRecord(search?.intent)
  const agenticStats = asRecord(searchIntent.agentic_stats)
  const queryYield = asRecord(agenticStats.query_yield)
  const sourcePolicy = asRecord(asRecord(asRecord(searchIntent.uqe_plan).canonical_plan).source_policy)
  const allowedSources = Array.isArray(sourcePolicy.allowed_source_classes)
    ? sourcePolicy.allowed_source_classes.map(String)
    : ['official_company_website']
  const fallbackSource = allowedSources[0] || 'official_company_website'
  const sourceTelemetry = buildQueriedSourceEvents({
    runId, canaryId, searchId, vertical, fallbackSource,
    queryYield: queryYield as Record<string, QueryYieldStats>,
    ledger: (ledger || []) as CostLedgerRow[],
  })
  const queriedEvents = sourceTelemetry.events
  const actualCost = sourceTelemetry.actualCostEur
  const attributionMatchesLedger = Math.abs(sourceTelemetry.attributedCostEur - actualCost) <= 0.0000001
  const hasOpenReservation = (ledger || []).some((row) => row.status === 'reserved')
  const candidateEvents = candidates.map((row, index) => {
    const url = leadSourceUrl(row)
    const signals = leadSignals(row)
    const source = sourceMetadataFromLead(row, url, fallbackSource)
    return {
      evaluation_run_id: runId, canary_run_id: canaryId, search_id: searchId, vertical,
      source_id: source.sourceId, source_url: url || null,
      publisher: source.publisher, event_type: 'candidate_produced',
      candidate_ref: canonicalDomain(leadWebsite(row)) || `result-${index + 1}`,
      signal_type: signals[0] || null, observation_date: source.observationDate,
      extraction_method: source.extractionMethod, cost_eur: 0,
      selection_reason: 'Produced by isolated v5 shadow worker from executed source query',
      metadata: { query: source.query || spec.query, company: leadName(row), signals, source_types: row.source_types || [] },
    }
  })
  const rejectedEvents = lifecycleRows.filter((row) => row.stage === 'rejected').map((row) => {
    const payload = row.payload && typeof row.payload === 'object' ? row.payload as Record<string, unknown> : {}
    const sourceUrl = leadSourceUrl(payload)
    const source = sourceMetadataFromLead(payload, sourceUrl, fallbackSource)
    return {
      evaluation_run_id: runId, canary_run_id: canaryId, search_id: searchId, vertical,
      source_id: source.sourceId, source_url: sourceUrl || null,
      publisher: source.publisher, event_type: 'candidate_rejected',
      candidate_ref: row.canonical_domain || canonicalDomain(leadWebsite(payload)) || row.id,
      observation_date: source.observationDate,
      extraction_method: 'commercial_lifecycle_gate', cost_eur: 0,
      selection_reason: String(row.rejection_detail || row.rejection_code || 'quality_gate_failed').slice(0, 1000),
      metadata: {
        query: source.query || spec.query, company: row.entity_name || leadName(payload),
        candidate_website: leadWebsite(payload) || null,
        canonical_domain: row.canonical_domain || canonicalDomain(leadWebsite(payload)) || null,
        rejection_code: row.rejection_code, rejection_detail: row.rejection_detail,
        source_types: payload.source_types || [], source_lane: payload.source_lane || null,
      },
    }
  })
  const confirmedEvents = validated.map((row) => {
    const sourceUrl = leadSourceUrl(row)
    const source = sourceMetadataFromLead(row, sourceUrl, fallbackSource)
    return {
      evaluation_run_id: runId, canary_run_id: canaryId, search_id: searchId, vertical,
      source_id: source.sourceId, source_url: sourceUrl,
      publisher: source.publisher, event_type: 'signal_confirmed',
      candidate_ref: canonicalDomain(leadWebsite(row)), signal_type: leadSignals(row)[0],
      observation_date: source.observationDate,
      extraction_method: source.extractionMethod, cost_eur: 0,
      selection_reason: 'Machine validation retained official domain, source URL and requested signal',
      metadata: { query: source.query || spec.query, company: leadName(row), signals: leadSignals(row), source_types: row.source_types || [] },
    }
  })
  const eventRows = [...queriedEvents, ...candidateEvents, ...rejectedEvents, ...confirmedEvents]
  const { error: cleanupError } = await service.from('evaluation_source_events').delete()
    .eq('evaluation_run_id', runId).neq('event_type', 'selected')
  if (cleanupError) throw cleanupError
  if (eventRows.length) {
    const { error } = await service.from('evaluation_source_events').insert(eventRows)
    if (error) throw error
  }
  const [{ data: existingRunCases, error: existingRunError }, existing] = await Promise.all([
    service.from('evaluation_cases').select('id,review_status').eq('dataset_version', datasetVersion).eq('source_run_id', runId),
    service.from('evaluation_cases').select('case_number').eq('dataset_version', datasetVersion).eq('vertical', vertical).order('case_number', { ascending: false }).limit(1).maybeSingle(),
  ])
  if (existingRunError || existing.error) throw existingRunError || existing.error
  let number = Number(existing.data?.case_number || 0)
  const caseRows = (existingRunCases || []).length ? [] : validated.map((row) => {
    const sourceUrl = leadSourceUrl(row)
    const source = sourceMetadataFromLead(row, sourceUrl, fallbackSource)
    return {
      dataset_version: datasetVersion, cohort: 'v5_output', origin_release_id: MIRAX_RELEASE_ID,
      source_run_id: runId, vertical, case_number: ++number,
      seller_profile: { vertical, query: spec.query }, query: spec.query,
      candidate_snapshot: row,
      provenance: {
        engine: 'MIRAX_v5', shadow_only: true, customer_visible: false, search_id: searchId,
        evaluation_run_id: runId, source_id: source.sourceId, source_url: sourceUrl,
        publisher: source.publisher, observation_date: source.observationDate,
        extraction_method: source.extractionMethod, source_query: source.query,
        cost_eur_total_run: actualCost, selection_reason: 'Passed machine validation; human ground truth still required',
        human_ground_truth_required: true, selection_is_not_ground_truth: true,
      },
      review_status: 'candidate_ready',
    }
  })
  if (caseRows.length) {
    const { error } = await service.from('evaluation_cases').insert(caseRows)
    if (error) throw error
  }
  const passed = validated.length >= maxLeads && validated.length <= maxLeads && actualCost <= hardBudgetEur &&
    (publicationCount || 0) === 0 && search?.status === 'completed' && attributionMatchesLedger && !hasOpenReservation
  const metrics = {
    vertical, status: search?.status, candidates_produced: candidates.length,
    candidates_validated: validated.length, lifecycle_qualified: qualifiedLifecycle.length,
    candidates_rejected: rejectedEvents.length,
    sources_selected: allowedSources, sources_queried: Object.keys(queryYield),
    cost_eur: actualCost, cost_per_candidate_eur: candidates.length ? actualCost / candidates.length : null,
    cost_per_validated_lead_eur: validated.length ? actualCost / validated.length : null,
    source_cost_attributed_eur: sourceTelemetry.attributedCostEur,
    source_cost_matches_ledger: attributionMatchesLedger,
    open_cost_reservations: hasOpenReservation ? 1 : 0,
    customer_publications: publicationCount || 0, agentic_stats: agenticStats,
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
