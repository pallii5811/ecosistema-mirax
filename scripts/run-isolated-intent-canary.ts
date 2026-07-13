import { config } from 'dotenv'
import { createClient } from '@supabase/supabase-js'
import { execFileSync } from 'node:child_process'

import { buildMiraxQueryPlan } from '../src/lib/uqe/mirax-query-planner'
import { validateCommercialPlanSemantics } from '../src/lib/intent-compiler/compile-commercial-search-plan'
import { PersistentResearchCostGovernor } from '../src/lib/research/persistent-cost-governor'
import { MIRAX_RELEASE_ID } from '../src/app/api/ops/release/route'
import { parseSignalIntentHeuristic } from '../src/lib/signal-intent/parse-heuristic'
import { getSignalDefinition } from '../src/lib/signal-ontology/ontology'
import { sourceSupportsSignal } from '../src/lib/source-intelligence/registry'

config({ path: '.env.local' })
config({ path: '.env' })

const execute = process.argv.includes('--execute')
const query = process.env.MIRAX_CANARY_QUERY?.trim() ||
  'Trova PMI italiane che stanno assumendo un responsabile commerciale B2B, escludi grandi gruppi e brand famosi'
const maxLeads = 5
const hardBudgetEur = 0.125
const datasetVersion = 'mirax-gold-v5'
const appUrl = process.env.MIRAX_CANARY_APP_URL || 'https://ecosistema-mirax-two.vercel.app'

function required(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} required`)
  return value
}

async function assertBrake() {
  let lastError: unknown
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(`${appUrl}/api/ops/release`, {
        headers: { 'cache-control': 'no-cache' },
        signal: AbortSignal.timeout(15_000),
      })
      if (!response.ok) throw new Error(`release marker HTTP ${response.status}`)
      const marker = await response.json() as { release_id?: string; production_search_disabled?: boolean }
      if (marker.release_id !== MIRAX_RELEASE_ID || marker.production_search_disabled !== true) {
        throw new Error(`unsafe runtime marker: ${JSON.stringify(marker)}`)
      }
      return
    } catch (error) {
      lastError = error
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 750))
    }
  }
  try {
    const curl = process.platform === 'win32' ? 'curl.exe' : 'curl'
    const curlArgs = ['-fsS', '--max-time', '15']
    if (process.platform === 'win32') curlArgs.push('--ssl-no-revoke')
    curlArgs.push(`${appUrl}/api/ops/release`)
    const payload = execFileSync(curl, curlArgs, {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    })
    const marker = JSON.parse(payload) as { release_id?: string; production_search_disabled?: boolean }
    if (marker.release_id === MIRAX_RELEASE_ID && marker.production_search_disabled === true) return
    throw new Error(`unsafe runtime marker: ${JSON.stringify(marker)}`)
  } catch (curlError) {
    const fetchMessage = lastError instanceof Error ? lastError.message : String(lastError || '')
    const curlMessage = curlError instanceof Error ? curlError.message : String(curlError)
    throw new Error(`release marker unavailable (fetch=${fetchMessage}; curl=${curlMessage})`)
  }
}

async function main() {
  await assertBrake()
  if (!execute) {
    console.log(JSON.stringify({
      mode: 'dry_run',
      release_id: MIRAX_RELEASE_ID,
      query,
      max_leads: maxLeads,
      hard_budget_eur: hardBudgetEur,
      worker_limit: 0,
      customer_visible: false,
      command: 'npx tsx scripts/run-isolated-intent-canary.ts --execute',
    }, null, 2))
    return
  }

  required('ANTHROPIC_API_KEY')
  const url = required('NEXT_PUBLIC_SUPABASE_URL')
  const serviceKey = required('SUPABASE_SERVICE_ROLE_KEY')
  const supabase = createClient(url, serviceKey, { auth: { persistSession: false } })

  const { count: activeCount, error: activeError } = await supabase
    .from('canary_runs')
    .select('id', { count: 'exact', head: true })
    .in('status', ['created', 'running'])
  if (activeError) throw activeError
  if ((activeCount || 0) > 0) throw new Error('ACTIVE_CANARY_EXISTS')
  const { count: activeJobs, error: activeJobsError } = await supabase.from('searches')
    .select('id', { count: 'exact', head: true })
    .in('status', ['planning', 'pending', 'pending_user', 'processing', 'running'])
  if (activeJobsError) throw activeJobsError
  if ((activeJobs || 0) > 0) throw new Error('ACTIVE_SEARCH_JOB_EXISTS')
  const { count: staleReservations, error: staleError } = await supabase.from('search_cost_ledger')
    .select('id', { count: 'exact', head: true }).eq('status', 'reserved')
    .lt('reservation_expires_at', new Date().toISOString())
  if (staleError) throw staleError
  if ((staleReservations || 0) > 0) throw new Error('STALE_COST_RESERVATION_EXISTS')

  const { data: search, error: searchError } = await supabase.from('searches').insert({
    category: 'Evaluation intent canary',
    location: 'Italia',
    zone: String(maxLeads),
    status: 'planning',
    results: [],
    intent: {
      original_query: query,
      query,
      requested_leads: maxLeads,
      max_leads: maxLeads,
      lead_target: maxLeads,
      lifecycle_stage: 'evaluation_intent_canary',
      customer_visible: false,
    },
  }).select('id').single()
  if (searchError || !search?.id) throw new Error(searchError?.message || 'canary search insert failed')
  const searchId = String(search.id)

  const { data: run, error: runError } = await supabase.from('evaluation_runs').insert({
    dataset_version: datasetVersion,
    release_id: MIRAX_RELEASE_ID,
    mode: 'intent_canary',
    status: 'running',
    configuration: {
      purpose: 'v5_intent_gate', query, max_leads: maxLeads,
      hard_budget_eur: hardBudgetEur, maximum_llm_calls: 1, allow_paid_repair: false,
      customer_visible: false, worker_limit: 0,
    },
  }).select('id').single()
  if (runError || !run?.id) throw new Error(runError?.message || 'evaluation run insert failed')
  const runId = String(run.id)

  const { data: canary, error: canaryError } = await supabase.from('canary_runs').insert({
    evaluation_run_id: runId,
    search_id: searchId,
    canary_type: 'intent_only',
    exact_query: query,
    max_leads: maxLeads,
    hard_budget_eur: hardBudgetEur,
    shadow_mode: true,
    customer_visible: false,
    worker_limit: 1,
    status: 'running',
  }).select('id').single()
  if (canaryError || !canary?.id) throw new Error(canaryError?.message || 'canary run insert failed')
  const canaryId = String(canary.id)

  try {
    const meter = new PersistentResearchCostGovernor(supabase)
    await meter.initialize(searchId, maxLeads)
    const started = Date.now()
    const diagnostics: Array<{ stage: string; issues: Array<{ code: string; path: string; message: string }> }> = []
    const plan = await buildMiraxQueryPlan(query, {
      requestedLeadCount: maxLeads,
      searchId,
      costMeter: meter,
      allowRepair: false,
      onDiagnostic: (event) => diagnostics.push(event),
    })
    const { data: ledger, error: ledgerError } = await supabase
      .from('search_cost_ledger')
      .select('operation_type,estimated_cost_eur,actual_cost_eur,status,provider,model,idempotency_key,metadata')
      .eq('search_id', searchId)
    if (ledgerError) throw ledgerError
    const actualCostEur = (ledger || []).reduce(
      (sum, row) => sum + Number(row.actual_cost_eur ?? row.estimated_cost_eur ?? 0), 0,
    )
    const canonical = plan.canonical_plan
    const explicitSignals = [...new Set(
      (parseSignalIntentHeuristic(query).required_signals || [])
        .map((signal) => getSignalDefinition(signal)?.id)
        .filter((signal): signal is string => Boolean(signal)),
    )]
    const semanticIssues = canonical ? validateCommercialPlanSemantics(canonical) : []
    const requiredSignals = canonical?.signal_policy.required_signals || []
    const allowedSources = canonical?.source_policy.allowed_source_classes || []
    const preferredSources = canonical?.source_policy.preferred_source_classes || []
    const compilationRows = (ledger || []).filter((row) => row.operation_type === 'intent_compilation')
    const { data: budgetState, error: budgetError } = await supabase.from('search_budget_state')
      .select('target_cost_eur,hard_cost_eur,committed_cost_eur,status').eq('search_id', searchId).single()
    if (budgetError) throw budgetError
    const { count: publicationCount, error: publicationError } = await supabase.from('search_publications')
      .select('id', { count: 'exact', head: true }).eq('search_id', searchId)
    if (publicationError) throw publicationError
    const targetConstraintsValid = canonical ?
      canonical.target.company_sizes.some((value) => /micro|small|medium|pmi/i.test(value)) &&
      canonical.target.geographies.some((value) => /italia/i.test(value)) &&
      canonical.target.excluded_attributes.some((value) => /grand/i.test(value)) &&
      canonical.target.excluded_attributes.some((value) => /brand|famos/i.test(value)) : false
    const policyCoherent = canonical ? requiredSignals.every((signal) =>
      Number(canonical.signal_policy.maximum_age_days_by_signal[signal]) > 0) &&
      canonical.evidence_policy.require_official_domain && canonical.evidence_policy.require_source_url &&
      canonical.evidence_policy.require_observed_at &&
      canonical.budget_policy.target_cost_eur <= canonical.budget_policy.hard_cost_eur &&
      canonical.budget_policy.hard_cost_eur <= hardBudgetEur &&
      Number(budgetState?.hard_cost_eur) === hardBudgetEur : false
    const checks = {
      schema_canonical_valid: Boolean(canonical),
      seller_buyer_not_inverted: Boolean(canonical) && !semanticIssues.some((issue) => issue.code === 'SELLER_BUYER_INVERSION'),
      explicit_signals_preserved: explicitSignals.every((signal) => requiredSignals.includes(signal)),
      hiring_required_when_requested: !explicitSignals.some((signal) => /^hiring(?:_|$)/.test(signal)) ||
        requiredSignals.some((signal) => /^hiring(?:_|$)/.test(signal)),
      signal_led_not_maps_primary: plan.search_strategy !== 'maps' && !preferredSources.includes('google_business_maps'),
      sources_semantically_compatible: requiredSignals.length > 0 && requiredSignals.every((signal) =>
        allowedSources.some((source) => sourceSupportsSignal(source, signal))),
      pmi_geography_exclusions_preserved: targetConstraintsValid,
      freshness_evidence_budget_coherent: policyCoherent,
      real_cost_within_cap: actualCostEur <= hardBudgetEur && Number(budgetState?.committed_cost_eur) <= hardBudgetEur,
      llm_plan_without_silent_fallback: plan.parse_source === 'llm' && Boolean(canonical),
      exactly_one_llm_call_no_paid_repair: compilationRows.length === 1 &&
        compilationRows.every((row) => String(row.idempotency_key).endsWith(':initial')),
      no_customer_publication: (publicationCount || 0) === 0,
    }
    const semanticErrors = Object.entries(checks).filter(([, ok]) => !ok).map(([name]) => name)
    const metrics = {
      checks,
      semantic_errors: semanticErrors,
      sanitized_plan: canonical || null,
      semantic_validation_issues: semanticIssues,
      explicit_signals: explicitSignals,
      schema_valid: Boolean(canonical),
      parse_source: plan.parse_source,
      strategy: plan.search_strategy,
      required_signals: plan.required_signals,
      allowed_source_classes: allowedSources,
      enterprise_exclusions_present: canonical?.target?.company_sizes?.some((value) =>
        /micro|small|medium|pmi/i.test(String(value)),
      ) ?? false,
      expected_hiring_signal_present: plan.required_signals.some((value) => /^hiring(?:_|$)/.test(value)),
      signal_led_routing_valid: plan.search_strategy === 'organic_web_search' || plan.search_strategy === 'hybrid',
      elapsed_ms: Date.now() - started,
      actual_cost_eur: actualCostEur,
      within_hard_budget: actualCostEur <= hardBudgetEur,
      budget_state: budgetState,
      customer_publications: publicationCount || 0,
      ledger,
      diagnostics,
    }
    const passed = semanticErrors.length === 0
    await supabase.from('evaluation_runs').update({
      status: passed ? 'completed' : 'failed', metrics, completed_at: new Date().toISOString(),
    }).eq('id', runId)
    await supabase.from('canary_runs').update({
      status: passed ? 'completed' : 'quarantined',
      stop_reason: passed ? 'intent_only_complete' : 'intent_acceptance_failed',
      completed_at: new Date().toISOString(),
    }).eq('id', canaryId)
    await supabase.from('searches').update({
      status: 'cancelled', progress: { stop_reason: 'intent_canary_complete' }, results: [],
    }).eq('id', searchId)
    console.log(JSON.stringify({ ok: passed, run_id: runId, canary_id: canaryId, search_id: searchId, metrics }, null, 2))
    if (!passed) throw new Error('INTENT_CANARY_ACCEPTANCE_FAILED')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (message === 'INTENT_CANARY_ACCEPTANCE_FAILED') throw error
    await supabase.from('evaluation_runs').update({
      status: 'failed', metrics: { error: message }, completed_at: new Date().toISOString(),
    }).eq('id', runId)
    await supabase.from('canary_runs').update({
      status: 'failed', stop_reason: message.slice(0, 500), completed_at: new Date().toISOString(),
    }).eq('id', canaryId)
    await supabase.from('searches').update({
      status: 'cancelled', progress: { stop_reason: 'intent_canary_failed', error: message }, results: [],
    }).eq('id', searchId)
    throw error
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
