import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { config } from 'dotenv'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import type { CommercialSearchPlan } from '../src/lib/contracts/commercial-search-plan'
import {
  validateCommercialPlanSemantics,
  type PlanValidationIssue,
} from '../src/lib/intent-compiler/compile-commercial-search-plan'
import { PersistentResearchCostGovernor } from '../src/lib/research/persistent-cost-governor'
import { MIRAX_RELEASE_ID } from '../src/app/api/ops/release/route'
import { SOURCE_BY_ID, sourceSupportsSignal } from '../src/lib/source-intelligence/registry'
import { buildMiraxQueryPlan } from '../src/lib/uqe/mirax-query-planner'
import type { MiraxQueryPlan } from '../src/types/uqe'

config({ path: '.env.local' })
config({ path: '.env' })
config({ path: '.env.ecosistema.secrets' })

const ORPHAN_SEARCH_ID = '6ecc8d72-db71-4b06-a215-9cc0fb92f303'
const FALLBACK_HIRING = process.argv.includes('--fallback-hiring')
const REUSE_LAST_PLAN = process.argv.includes('--reuse-last-plan')
if (REUSE_LAST_PLAN && !FALLBACK_HIRING) throw new Error('--reuse-last-plan requires --fallback-hiring')
const VERTICAL = FALLBACK_HIRING ? 'workplace_safety_hiring' : 'workplace_safety'
const DATASET_VERSION = 'mirax-gold-v5'
const MAX_LEADS = 5
const HARD_BUDGET_EUR = 0.125
const COMPILER_CAP_EUR = 0.05
const PREFLIGHT_ONLY = process.argv.includes('--preflight-only')
const REQUIRED_SIGNALS: readonly string[] = FALLBACK_HIRING
  ? ['hiring_operational']
  : ['contract_awarded', 'hiring_operational', 'production_expansion']
const GENERIC_TEXT = /(?:necessit[aà]\s+(?:commerciale\s+)?implicita|bisogno\s+da\s+(?:confermare|verificare)|coerenza\s+(?:da\s+validare|con\s+l[' ]?obiettivo)|richiesta\s+dell[' ]?utente|da\s+verificare|placeholder)/i

const manifest = JSON.parse(fs.readFileSync('evaluation/canary-v1/manifest.json', 'utf8')) as {
  canaries: Array<{ vertical: string; query: string; expected_signal_any: string[] }>
}
const selectedSpec = FALLBACK_HIRING
  ? {
      vertical: VERTICAL,
      query: 'Sono un consulente sicurezza sul lavoro: trovami PMI italiane che stanno assumendo personale operativo tramite careers o posizioni aperte verificabili',
      expected_signal_any: ['hiring_operational'],
    }
  : manifest.canaries.find((row) => row.vertical === VERTICAL)
if (!selectedSpec) throw new Error(`manifest missing ${VERTICAL}`)
const spec: { vertical: string; query: string; expected_signal_any: string[] } = selectedSpec

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

type GateResult = { id: string; passed: boolean; detail?: string }

function evaluateGates(plan: MiraxQueryPlan, diagnostics: Array<{ stage: string }>): {
  gates: GateResult[]
  failed: GateResult[]
  lanes: Array<Record<string, unknown>>
} {
  const canonical = plan.canonical_plan
  const gates: GateResult[] = []
  const push = (id: string, passed: boolean, detail?: string) => gates.push({ id, passed, detail })

  push('seller_explicit', Boolean(
    canonical?.seller.offer_category?.trim() &&
    canonical.seller.products_or_services.length > 0 &&
    canonical.seller.problems_solved.length > 0 &&
    canonical.seller.preferred_buyer_roles.length > 0 &&
    /sicurezza|hse|sul lavoro/i.test(
      [canonical.seller.offer_category, canonical.seller.offer_description, ...canonical.seller.products_or_services].join(' '),
    ),
  ), 'seller offer must remain explicit for workplace safety')
  push('offer_preserved', Boolean(canonical &&
    /consulente|sicurezza|hse|sul lavoro/i.test([
      canonical.seller.offer_category,
      canonical.seller.offer_description,
      ...canonical.seller.products_or_services,
    ].join(' '))), 'canonical plan must preserve the seller offer')
  push('buyer_coherent', Boolean(
    canonical &&
    canonical.target.entity_types.some((entity) => /company|pmi|impresa|azienda|societ/i.test(entity)) &&
    canonical.target.company_sizes.some((size) => /micro|small|medium|pmi|piccol|medi/i.test(size)),
  ), 'buyer must be PMI company profile')
  push('required_signals_exact', REQUIRED_SIGNALS.every((signal) => plan.required_signals.includes(signal)) &&
    plan.required_signals.length === REQUIRED_SIGNALS.length, plan.required_signals.join(', '))
  push('parse_source_llm', plan.parse_source === 'llm')
  push('no_repair_call', !diagnostics.some((event) => event.stage === 'repair'), diagnostics.map((event) => event.stage).join(', '))

  const semanticIssues = canonical ? validateCommercialPlanSemantics(canonical) : [{ code: 'NO_CANONICAL_PLAN', path: 'canonical_plan', message: 'missing' }]
  push('semantic_validation', semanticIssues.length === 0, semanticIssues.map((issue) => issue.code).join(', '))

  const sourcePlan = plan.source_plan || []
  push('source_plan_present', sourcePlan.length > 0)
  push('templates_non_empty', sourcePlan.every((lane) =>
    lane.query_templates.length > 0 &&
    lane.query_templates.every((template) => template.trim().length > 12),
  ))
  push('lane_per_required_signal', REQUIRED_SIGNALS.every((signal) =>
    sourcePlan.some((lane) =>
      lane.expected_evidence.includes(signal) &&
      lane.source_types.some((source) => sourceSupportsSignal(source, signal)),
    ),
  ))
  push('dedicated_single_signal_lane', REQUIRED_SIGNALS.every((signal) =>
    sourcePlan.some((lane) =>
      lane.expected_evidence.length === 1 &&
      lane.expected_evidence[0] === signal &&
      lane.source_types.some((source) => sourceSupportsSignal(source, signal)),
    ),
  ))
  push('no_lane_signal_contamination', sourcePlan.every((lane) =>
    lane.expected_evidence.length === 0 ||
    (lane.expected_evidence.length === 1 && REQUIRED_SIGNALS.includes(lane.expected_evidence[0])),
  ))
  push('source_registry_valid', sourcePlan.every((lane) =>
    lane.source_types.every((source) => SOURCE_BY_ID.has(source)),
  ))
  push('freshness_per_signal', REQUIRED_SIGNALS.every((signal) =>
    Boolean(canonical?.signal_policy.maximum_age_days_by_signal[signal]),
  ), JSON.stringify(canonical?.signal_policy.maximum_age_days_by_signal || {}))
  push('research_questions_coherent', (plan.research_questions || []).length > 0 &&
    (plan.research_questions || []).every((question) => question.trim().length > 20 && !GENERIC_TEXT.test(question)))
  push('why_now_causal', Boolean(
    canonical &&
    canonical.commercial_hypotheses.length > 0 &&
    canonical.commercial_hypotheses.every((hypothesis) =>
      hypothesis.triggering_events.length > 0 &&
      hypothesis.buyer_problem.trim().length > 20 &&
      hypothesis.relevance_to_offer.trim().length > 20 &&
      !GENERIC_TEXT.test(hypothesis.buyer_problem) &&
      !GENERIC_TEXT.test(hypothesis.relevance_to_offer),
    ),
  ))
  push('budget_valid', Boolean(
    canonical &&
    canonical.budget_policy.hard_cost_eur > 0 &&
    canonical.budget_policy.hard_cost_eur <= HARD_BUDGET_EUR &&
    canonical.budget_policy.target_cost_eur > 0,
  ), canonical ? `${canonical.budget_policy.target_cost_eur}/${canonical.budget_policy.hard_cost_eur}` : 'missing')
  push('not_maps', plan.search_strategy !== 'maps')
  push('compiler_diagnostics_clean', diagnostics.length <= 1)

  const lanes = sourcePlan.map((lane) => ({
    signal: lane.expected_evidence.join(', '),
    lane: lane.lane,
    source_class: lane.source_types.join(', '),
    query_templates: lane.query_templates,
    freshness_days: lane.expected_evidence.map((signal) =>
      canonical?.signal_policy.maximum_age_days_by_signal[signal] ?? null,
    ),
    evidence_requirement: lane.expected_evidence,
  }))

  const failed = gates.filter((gate) => !gate.passed)
  return { gates, failed, lanes }
}

function sanitizeFixture(payload: Record<string, unknown>) {
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  const searchId = String(payload.search_id || 'unknown').replace(/[^0-9a-z-]/gi, '')
  const file = path.join('evaluation', 'fixtures', `workplace-safety-controlled-prepare-${stamp}-${searchId}.json`)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
  return file
}

async function activeGuards(service: SupabaseClient) {
  const [canaries, jobs, reservations] = await Promise.all([
    service.from('canary_runs').select('id', { count: 'exact', head: true }).in('status', ['created', 'running']),
    service.from('searches').select('id', { count: 'exact', head: true }).in('status', ['planning', 'pending', 'pending_user', 'processing', 'running']),
    service.from('search_cost_ledger').select('id', { count: 'exact', head: true }).eq('status', 'reserved').lt('reservation_expires_at', new Date().toISOString()),
  ])
  const failures = [
    ['active canaries', canaries.error],
    ['active jobs', jobs.error],
    ['stale reservations', reservations.error],
  ].filter((entry): entry is [string, NonNullable<typeof canaries.error>] => Boolean(entry[1]))
  if (failures.length > 0) {
    const detail = failures.map(([label, error]) =>
      `${label}: ${error.message} (${error.code || 'no_code'})`,
    ).join('; ')
    throw new Error(`preflight database guard failed: ${detail}`)
  }
  const activeCanaries = canaries.count
  const activeJobs = jobs.count
  const stale = reservations.count
  if ((activeCanaries || 0) || (activeJobs || 0) || (stale || 0)) {
    throw new Error(`unsafe active state canaries=${activeCanaries} jobs=${activeJobs} stale=${stale}`)
  }
}

async function snapshot(service: SupabaseClient, searchId: string) {
  const [search, ledger, candidates, publications, charges, reserved] = await Promise.all([
    service.from('searches').select('id,status,intent,progress').eq('id', searchId).maybeSingle(),
    service.from('search_cost_ledger').select('operation_type,provider,model,estimated_cost_eur,actual_cost_eur,status,metadata').eq('search_id', searchId),
    service.from('search_candidates').select('id', { count: 'exact', head: true }).eq('search_id', searchId),
    service.from('search_publications').select('id', { count: 'exact', head: true }).eq('search_id', searchId),
    service.from('search_credit_charges').select('id', { count: 'exact', head: true }).eq('search_id', searchId),
    service.from('search_cost_ledger').select('id', { count: 'exact', head: true }).eq('search_id', searchId).eq('status', 'reserved'),
  ])
  const compilerRows = (ledger.data || []).filter((row) => row.operation_type === 'intent_compilation')
  const compilerCost = compilerRows.reduce((sum, row) => sum + Number(row.actual_cost_eur ?? row.estimated_cost_eur ?? 0), 0)
  return {
    search: search.data,
    ledger: ledger.data || [],
    compilerRows,
    compilerCost,
    compilerCalls: compilerRows.length,
    repairCalls: compilerRows.filter((row) => String((row.metadata as Record<string, unknown> | null)?.call_kind || '') === 'repair').length,
    candidates: candidates.count || 0,
    publications: publications.count || 0,
    charges: charges.count || 0,
    reserved: reserved.count || 0,
    jobs: 0,
  }
}

async function quarantine(
  service: SupabaseClient,
  searchId: string,
  canaryId: string,
  runId: string,
  reason: string,
  metrics: Record<string, unknown>,
) {
  const { error: metricsError } = await service.from('evaluation_runs').update({ metrics }).eq('id', runId)
  if (metricsError) throw metricsError
  execFileSync(process.execPath, [
    path.resolve('scripts/quarantine-canary-run.mjs'),
    canaryId,
    runId,
    reason,
  ], { cwd: process.cwd(), stdio: 'pipe', env: process.env })
  const [search, canary, run] = await Promise.all([
    service.from('searches').select('status').eq('id', searchId).single(),
    service.from('canary_runs').select('status').eq('id', canaryId).single(),
    service.from('evaluation_runs').select('status').eq('id', runId).single(),
  ])
  if (search.error || canary.error || run.error || search.data?.status !== 'cancelled' ||
    canary.data?.status !== 'quarantined' || run.data?.status !== 'failed') {
    throw new Error('transactional quarantine verification failed')
  }
}

async function main() {
  const service = db()
  await activeGuards(service)
  if (PREFLIGHT_ONLY) {
    console.log(JSON.stringify({
      ok: true,
      mode: 'preflight_only',
      active_canaries: 0,
      active_jobs: 0,
      stale_reservations: 0,
      paid_calls: 0,
    }, null, 2))
    return
  }
  if (!REUSE_LAST_PLAN) required('ANTHROPIC_API_KEY')

  let replayTemplate: MiraxQueryPlan | null = null
  let replaySourceSearchId = ''
  if (REUSE_LAST_PLAN) {
    const { data: priorSearches, error: priorError } = await service.from('searches')
      .select('id,intent').order('created_at', { ascending: false }).limit(60)
    if (priorError) throw priorError
    const prior = (priorSearches || []).find((row) => {
      const intent = row.intent as Record<string, unknown> | null
      const candidate = intent?.uqe_plan as MiraxQueryPlan | undefined
      return intent?.customer_visible === false && candidate?.canonical_plan &&
        candidate.required_signals.length === 1 && candidate.required_signals[0] === 'hiring_operational'
    })
    if (!prior?.id) throw new Error('validated hiring replay plan unavailable')
    replayTemplate = structuredClone((prior.intent as Record<string, unknown>).uqe_plan as MiraxQueryPlan)
    replaySourceSearchId = String(prior.id)
  }

  const { data: intentGate } = await service.from('evaluation_runs').select('id,status,metrics')
    .eq('dataset_version', DATASET_VERSION).eq('mode', 'intent_canary').eq('status', 'completed')
    .order('started_at', { ascending: false }).limit(1).maybeSingle()
  if (!intentGate?.id) throw new Error('valid intent gate required')

  const { data: search, error: searchError } = await service.from('searches').insert({
    category: `Evaluation shadow ${VERTICAL}`,
    location: 'Italia',
    zone: String(MAX_LEADS),
    status: 'planning',
    results: [],
    intent: {
      original_query: spec.query,
      query: spec.query,
      requested_leads: MAX_LEADS,
      max_leads: MAX_LEADS,
      lead_target: MAX_LEADS,
      customer_visible: false,
      lifecycle_stage: 'v5_shadow',
    },
  }).select('id').single()
  if (searchError || !search?.id) throw new Error(searchError?.message || 'search insert failed')
  const searchId = String(search.id)
  if (searchId === ORPHAN_SEARCH_ID) throw new Error('refusing to reuse quarantined search id')

  const { data: run, error: runError } = await service.from('evaluation_runs').insert({
    dataset_version: DATASET_VERSION,
    release_id: MIRAX_RELEASE_ID,
    mode: 'shadow_research',
    status: 'running',
    configuration: {
      vertical: VERTICAL,
      query: spec.query,
      max_leads: MAX_LEADS,
      hard_budget_eur: HARD_BUDGET_EUR,
      compiler_cap_eur: COMPILER_CAP_EUR,
      customer_visible: false,
      source_planner: 'canonical_v5',
      prepare_only: true,
      plan_source: REUSE_LAST_PLAN ? 'validated_shadow_replay' : 'llm_compiler',
      replay_source_search_id: replaySourceSearchId || null,
    },
  }).select('id').single()
  if (runError || !run?.id) throw new Error(runError?.message || 'run insert failed')
  const runId = String(run.id)

  const { data: canary, error: canaryError } = await service.from('canary_runs').insert({
    evaluation_run_id: runId,
    search_id: searchId,
    canary_type: `shadow_${VERTICAL}`,
    exact_query: spec.query,
    max_leads: MAX_LEADS,
    hard_budget_eur: HARD_BUDGET_EUR,
    shadow_mode: true,
    customer_visible: false,
    worker_limit: 1,
    status: 'running',
  }).select('id').single()
  if (canaryError || !canary?.id) throw new Error(canaryError?.message || 'canary insert failed')
  const canaryId = String(canary.id)

  const compilerDiagnostics: Array<{ stage: 'initial' | 'repair'; issues: PlanValidationIssue[] }> = []
  let plan: MiraxQueryPlan | null = null
  let gateReport: ReturnType<typeof evaluateGates> | null = null
  let failureReason = ''

  try {
    const meter = new PersistentResearchCostGovernor(service)
    await meter.initialize(searchId, MAX_LEADS)
    if (REUSE_LAST_PLAN && replayTemplate) {
      plan = structuredClone(replayTemplate)
      plan.original_query = spec.query
      if (plan.canonical_plan) {
        plan.canonical_plan.raw_query = spec.query
        plan.canonical_plan.search_id = searchId
        plan.canonical_plan.planner_metadata = {
          ...plan.canonical_plan.planner_metadata,
          generated_at: new Date().toISOString(),
        }
      }
    } else {
      plan = await buildMiraxQueryPlan(spec.query, {
        requestedLeadCount: MAX_LEADS,
        searchId,
        costMeter: meter,
        allowRepair: false,
        onDiagnostic: (event) => compilerDiagnostics.push(event),
      })
    }
    if (!plan) throw new Error('PLAN_BUILD_FAILED')
    gateReport = evaluateGates(plan, compilerDiagnostics)
    if (gateReport.failed.length > 0) {
      failureReason = `PREPARE_GATE_FAILED:${gateReport.failed.map((gate) => gate.id).join(',')}`
      throw new Error(failureReason)
    }

    const compilerSnapshot = await snapshot(service, searchId)
    const expectedCompilerCalls = REUSE_LAST_PLAN ? 0 : 1
    if (compilerSnapshot.compilerCalls !== expectedCompilerCalls || compilerSnapshot.repairCalls !== 0 ||
      compilerSnapshot.compilerCost > COMPILER_CAP_EUR || compilerSnapshot.reserved !== 0 ||
      compilerSnapshot.candidates !== 0 || compilerSnapshot.publications !== 0 || compilerSnapshot.charges !== 0) {
      failureReason = 'PREPARE_LEDGER_GATE_FAILED'
      throw new Error(failureReason)
    }

    const canonical = plan.canonical_plan as CommercialSearchPlan
    const intent = {
      original_query: spec.query,
      query: spec.query,
      requested_leads: MAX_LEADS,
      max_leads: MAX_LEADS,
      lead_target: MAX_LEADS,
      customer_visible: false,
      lifecycle_stage: 'v5_shadow',
      required_signals: plan.required_signals,
      signals: plan.required_signals.map((type) => ({ type, params: {} })),
      source_plan: plan.source_plan,
      search_strategy: plan.search_strategy,
      uqe_plan: plan,
      prepare_only: true,
      execution_authorized: false,
      plan_replay: REUSE_LAST_PLAN,
      plan_replay_source_search_id: replaySourceSearchId || null,
    }
    const { error: readyError } = await service.from('searches').update({
      category: plan.sector || `Evaluation shadow ${VERTICAL}`,
      location: plan.location || 'Italia',
      intent,
      status: 'planning',
      results: [],
      progress: { prepare_complete: true, execution_authorized: false },
    }).eq('id', searchId)
    if (readyError) throw readyError

    const selectedSignals = [...plan.required_signals]
    const selected = (canonical.source_policy.allowed_source_classes || []).map((sourceId) => ({
      evaluation_run_id: runId,
      canary_run_id: canaryId,
      search_id: searchId,
      vertical: VERTICAL,
      source_id: sourceId,
      event_type: 'selected',
      extraction_method: SOURCE_BY_ID.get(sourceId)?.extraction_method || 'unknown',
      cost_eur: 0,
      selection_reason: `Controlled prepare selected source for signals: ${selectedSignals.join(', ')}`,
      metadata: { query: spec.query, required_signals: selectedSignals, prepare_only: true },
    }))
    if (selected.length) {
      const { error } = await service.from('evaluation_source_events').insert(selected)
      if (error) throw error
    }

    await service.from('evaluation_runs').update({
      metrics: {
        prepare_status: 'ready_not_executed',
        required_signals: plan.required_signals,
        gates: gateReport.gates,
      },
    }).eq('id', runId)
  } catch (error) {
    failureReason = failureReason || (error instanceof Error ? error.message : String(error))
    const snap = await snapshot(service, searchId)
    const fixturePath = sanitizeFixture({
      search_id: searchId,
      canary_id: canaryId,
      evaluation_run_id: runId,
      query: spec.query,
      failure_reason: failureReason,
      compiler_diagnostics: compilerDiagnostics,
      gates: gateReport?.gates || [],
      plan: plan ? {
        required_signals: plan.required_signals,
        parse_source: plan.parse_source,
        source_plan: plan.source_plan,
        canonical_plan: plan.canonical_plan,
      } : null,
      ledger: snap.ledger,
    })
    await quarantine(service, searchId, canaryId, runId, failureReason, {
      failure_reason: failureReason,
      compiler_diagnostics: compilerDiagnostics,
      gates: gateReport?.gates || [],
      fixture_path: fixturePath,
      compiler_cost_eur: snap.compilerCost,
      compiler_calls: snap.compilerCalls,
      repair_calls: snap.repairCalls,
    })
    const finalSnap = await snapshot(service, searchId)
    console.log(JSON.stringify({
      ok: false,
      search_id: searchId,
      canary_id: canaryId,
      evaluation_run_id: runId,
      failure_reason: failureReason,
      fixture_path: fixturePath,
      compiler_cost_eur: finalSnap.compilerCost,
      compiler_calls: finalSnap.compilerCalls,
      repair_calls: finalSnap.repairCalls,
      gates_passed: (gateReport?.gates || []).filter((gate) => gate.passed).map((gate) => gate.id),
      gates_failed: (gateReport?.gates || []).filter((gate) => !gate.passed),
      jobs: finalSnap.jobs,
      reservations_open: finalSnap.reserved,
      candidates: finalSnap.candidates,
      publications: finalSnap.publications,
      charges: finalSnap.charges,
    }, null, 2))
    process.exitCode = 2
    return
  }

  const snap = await snapshot(service, searchId)
  const canonical = plan.canonical_plan as CommercialSearchPlan
  console.log(JSON.stringify({
    ok: true,
    search_id: searchId,
    canary_id: canaryId,
    evaluation_run_id: runId,
    compiler_cost_eur: snap.compilerCost,
    compiler_calls: snap.compilerCalls,
    repair_calls: snap.repairCalls,
    llm_calls: snap.compilerCalls,
    seller: {
      offer_category: canonical.seller.offer_category,
      offer_description: canonical.seller.offer_description,
      products_or_services: canonical.seller.products_or_services,
      problems_solved: canonical.seller.problems_solved,
      preferred_buyer_roles: canonical.seller.preferred_buyer_roles,
    },
    offer: canonical.seller.offer_description,
    buyer: {
      entity_types: canonical.target.entity_types,
      industries: canonical.target.industries,
      company_sizes: canonical.target.company_sizes,
      geographies: canonical.target.geographies,
      required_attributes: canonical.target.required_attributes,
    },
    required_signals: plan.required_signals,
    lanes: gateReport?.lanes || [],
    gates_passed: gateReport?.gates.filter((gate) => gate.passed).map((gate) => gate.id) || [],
    gates_failed: gateReport?.gates.filter((gate) => !gate.passed) || [],
    jobs: snap.jobs,
    reservations_open: snap.reserved,
    candidates: snap.candidates,
    publications: snap.publications,
    charges: snap.charges,
    search_status: snap.search?.status,
    canary_status: 'running',
    execution_authorized: false,
    plan_replay: REUSE_LAST_PLAN,
    plan_replay_source_search_id: replaySourceSearchId || null,
    hard_budget_eur_reserved_for_execution: HARD_BUDGET_EUR,
    compiler_cap_eur: COMPILER_CAP_EUR,
  }, null, 2))
}

main().catch((error) => {
  if (error instanceof Error) {
    console.error(error.stack || error.message)
  } else {
    try {
      console.error(JSON.stringify(error, null, 2))
    } catch {
      console.error(String(error))
    }
  }
  process.exitCode = 1
})
