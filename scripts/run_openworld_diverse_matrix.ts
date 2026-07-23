/**
 * Open-world diverse matrix — production path only.
 *
 * Cases supply ONLY raw_query + requested_count (+ optional user-written filters).
 * Compilation goes through buildMiraxQueryPlan / compileCommercialSearchPlan
 * (same entry as unified-search-action UI).
 *
 * Usage:
 *   npx tsx scripts/run_openworld_diverse_matrix.ts budget
 *   npx tsx scripts/run_openworld_diverse_matrix.ts offline-check
 *   npx tsx scripts/run_openworld_diverse_matrix.ts prepare --case=A --user-email=you@example.com
 *   npx tsx scripts/run_openworld_diverse_matrix.ts review --search-id=<uuid>
 *   npx tsx scripts/run_openworld_diverse_matrix.ts worker-cmd --search-id=<uuid> --worker-cap=0.21
 *
 * Do NOT run `all`. Do NOT set override env vars unless the owner authorizes spend.
 */
import { config } from 'dotenv'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { writeFileSync, mkdirSync } from 'fs'
import path from 'path'

import { createAgenticPlanningJob, requestAgenticWorkerJob } from '../src/lib/search-cache'
import { buildMiraxQueryPlan } from '../src/lib/uqe/mirax-query-planner'
import type { MiraxQueryPlan } from '@/types/uqe'
import { PersistentResearchCostGovernor } from '../src/lib/research/persistent-cost-governor'
import {
  OPENWORLD_MATRIX_CASES,
  type MatrixCaseId,
  type MatrixCaseSpec,
  assertCaseIsProductionInputOnly,
  formatLeadReview,
  formatFunnel,
  extractLeadReviewFields,
} from './lib/openworld-matrix-cases'
import {
  CASE_TOTAL_CAP_EUR,
  LEDGER_SPEND_STATUSES,
  MATRIX_TELEMETRY_SOURCE,
  type CanaryBudgetRow,
  type LedgerBudgetRow,
  type SearchBudgetRow,
  assertBudgetAccountingMatch,
  computeCampaignSpendTotals,
  computeWorkerRemainingCap,
  ledgerRowCost,
  parseAllowOverCeiling,
  parseOwnerAuthorizedExtraEur,
  resolveSpendAuthorization,
} from './lib/openworld-matrix-budget'

config({ path: '.env.local' })

const SPEND_CEILING_EUR = Number(process.env.MIRAX_OPENWORLD_SPEND_CEILING_EUR || '2.70')
/** Inclusive lower bound for campaign spend accounting (ISO date). */
const BUDGET_SINCE = String(process.env.MIRAX_OPENWORLD_BUDGET_SINCE || '2026-07-20')

const args = new Map(
  process.argv.slice(2).map((arg) => {
    const [key, ...value] = arg.replace(/^--/, '').split('=')
    return [key, value.join('=') || 'true'] as const
  }),
)
const action = String(args.get('action') || process.argv[2] || 'offline-check').replace(/^--/, '')
const caseId = (args.get('case') || '').toUpperCase() as MatrixCaseId | ''
const searchIdArg = args.get('search-id') || ''
const userEmail = args.get('user-email') || ''
const workerCapArg = args.get('worker-cap') || ''

function requiredEnv(name: string): string {
  const value = String(process.env[name] || '').trim()
  if (!value) throw new Error(`${name} required`)
  return value
}

function serviceClient(): SupabaseClient {
  return createClient(requiredEnv('NEXT_PUBLIC_SUPABASE_URL'), requiredEnv('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

async function resolveUserId(service: SupabaseClient, email: string): Promise<string> {
  if (!email) throw new Error('--user-email required for prepare')
  const { data, error } = await service.auth.admin.listUsers({ page: 1, perPage: 1000 })
  if (error) throw error
  const user = data.users.find((item) => item.email?.toLowerCase() === email.toLowerCase())
  if (!user) throw new Error(`staging UI user not found: ${email}`)
  return user.id
}

async function loadCampaignDatasetViaPostgres(): Promise<{
  searches: SearchBudgetRow[]
  canaries: CanaryBudgetRow[]
  ledger: LedgerBudgetRow[]
}> {
  const { connectMiraxDb, loadMiraxDbPassword } = await import('./lib/mirax-db.mjs')
  if (!loadMiraxDbPassword()) throw new Error('ECOSISTEMA_DB_PASSWORD missing')
  const c = await connectMiraxDb()
  try {
    const searches = await c.query(
      `select id, category, intent, status, results, created_at
         from public.searches
        where created_at >= $1::timestamptz`,
      [BUDGET_SINCE],
    )
    const canaries = await c.query(
      `select search_id, canary_type from public.canary_runs
        where created_at >= $1::timestamptz
           or canary_type ilike 'open_world%'
           or canary_type ilike '%openworld%'`,
      [BUDGET_SINCE],
    )
    const ledger = await c.query(
      `select search_id, actual_cost_eur, estimated_cost_eur, status
         from public.search_cost_ledger
        where status = any($1::text[])`,
      [[...LEDGER_SPEND_STATUSES]],
    )
    return {
      searches: searches.rows as SearchBudgetRow[],
      canaries: canaries.rows as CanaryBudgetRow[],
      ledger: ledger.rows as LedgerBudgetRow[],
    }
  } finally {
    await c.end()
  }
}

async function loadCampaignDatasetViaRest(service: SupabaseClient): Promise<{
  searches: SearchBudgetRow[]
  canaries: CanaryBudgetRow[]
  ledger: LedgerBudgetRow[]
}> {
  const { data: searches, error: sErr } = await service
    .from('searches')
    .select('id,category,intent,status,results,created_at')
    .gte('created_at', BUDGET_SINCE)
  if (sErr) throw new Error(`REST searches: ${sErr.message}`)

  const { data: canaries, error: cErr } = await service
    .from('canary_runs')
    .select('search_id,canary_type,created_at')
    .gte('created_at', BUDGET_SINCE)
  if (cErr) throw new Error(`REST canaries: ${cErr.message}`)

  // Also pull open_world canaries that may predate BUDGET_SINCE but still bind searches.
  const { data: owCanaries, error: owErr } = await service
    .from('canary_runs')
    .select('search_id,canary_type,created_at')
    .or('canary_type.ilike.open_world%,canary_type.ilike.%openworld%')
  if (owErr) throw new Error(`REST open_world canaries: ${owErr.message}`)

  const canaryMap = new Map<string, CanaryBudgetRow>()
  for (const row of [...(canaries || []), ...(owCanaries || [])]) {
    const key = `${row.search_id}:${row.canary_type}`
    canaryMap.set(key, { search_id: row.search_id, canary_type: row.canary_type })
  }

  const { data: ledger, error: lErr } = await service
    .from('search_cost_ledger')
    .select('search_id,actual_cost_eur,estimated_cost_eur,status')
    .in('status', [...LEDGER_SPEND_STATUSES])
  if (lErr) throw new Error(`REST ledger: ${lErr.message}`)

  return {
    searches: (searches || []) as SearchBudgetRow[],
    canaries: [...canaryMap.values()],
    ledger: (ledger || []) as LedgerBudgetRow[],
  }
}

function authorizationFromEnv(totals: {
  cumulative_cost_eur: number
  successful_completed_cost_eur: number
}) {
  return resolveSpendAuthorization({
    actualCumulativeBefore: totals.cumulative_cost_eur,
    successfulCompletedCostEur: totals.successful_completed_cost_eur,
    spendCeilingEur: SPEND_CEILING_EUR,
    allowOverCeiling: parseAllowOverCeiling(process.env.MIRAX_OPENWORLD_ALLOW_OVER_CEILING),
    ownerAuthorizedExtraEur: parseOwnerAuthorizedExtraEur(
      process.env.MIRAX_OPENWORLD_OWNER_AUTHORIZED_EXTRA_EUR,
    ),
    caseTotalCapEur: CASE_TOTAL_CAP_EUR,
  })
}

/**
 * Dual-source authoritative budget. REST and Postgres must agree on campaign spend
 * or fail closed with BUDGET_ACCOUNTING_MISMATCH.
 */
async function reconstructBudget(service: SupabaseClient) {
  let restDataset: Awaited<ReturnType<typeof loadCampaignDatasetViaRest>>
  let pgDataset: Awaited<ReturnType<typeof loadCampaignDatasetViaPostgres>>
  try {
    ;[restDataset, pgDataset] = await Promise.all([
      loadCampaignDatasetViaRest(service),
      loadCampaignDatasetViaPostgres(),
    ])
  } catch (error) {
    const err = new Error(
      `BUDGET_ACCOUNTING_MISMATCH source_load_failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    )
    err.name = 'BUDGET_ACCOUNTING_MISMATCH'
    throw err
  }

  const restTotals = computeCampaignSpendTotals({
    ...restDataset,
    budgetSinceIso: BUDGET_SINCE,
  })
  const pgTotals = computeCampaignSpendTotals({
    ...pgDataset,
    budgetSinceIso: BUDGET_SINCE,
  })
  assertBudgetAccountingMatch(restTotals.cumulative_cost_eur, pgTotals.cumulative_cost_eur)

  const auth = authorizationFromEnv(pgTotals)
  const out = {
    ...auth,
    ledger_rows: pgTotals.ledger_rows,
    campaign_search_count: pgTotals.campaign_search_ids.length,
    budget_since: BUDGET_SINCE,
    sources: {
      rest_cumulative_cost_eur: restTotals.cumulative_cost_eur,
      postgres_cumulative_cost_eur: pgTotals.cumulative_cost_eur,
      matched: true,
    },
    note: 'successful_completed_cost_eur is diagnostic only and does not increase residual',
  }
  console.log(JSON.stringify({ budget: out }, null, 2))
  return out
}

async function sumSearchPlanningSpend(service: SupabaseClient, searchId: string): Promise<number> {
  const { data, error } = await service
    .from('search_cost_ledger')
    .select('actual_cost_eur,estimated_cost_eur,status')
    .eq('search_id', searchId)
    .in('status', [...LEDGER_SPEND_STATUSES])
  if (error) {
    // Fallback postgres for this search only
    const { connectMiraxDb, loadMiraxDbPassword } = await import('./lib/mirax-db.mjs')
    if (!loadMiraxDbPassword()) throw new Error(error.message)
    const c = await connectMiraxDb()
    try {
      const r = await c.query(
        `select coalesce(sum(coalesce(actual_cost_eur, estimated_cost_eur, 0)), 0)::float as c
           from public.search_cost_ledger
          where search_id = $1 and status = any($2::text[])`,
        [searchId, [...LEDGER_SPEND_STATUSES]],
      )
      return Number(r.rows[0]?.c || 0)
    } finally {
      await c.end()
    }
  }
  return (data || []).reduce((sum, row) => sum + ledgerRowCost(row), 0)
}

async function assertSafeIdle(service: SupabaseClient) {
  const [{ count: jobs }, { count: reservations }] = await Promise.all([
    service
      .from('searches')
      .select('id', { count: 'exact', head: true })
      .in('status', ['planning', 'pending', 'pending_user', 'processing', 'running']),
    service.from('search_cost_ledger').select('id', { count: 'exact', head: true }).eq('status', 'reserved'),
  ])
  if ((jobs || 0) > 0 || (reservations || 0) > 0) {
    throw new Error(`unsafe active state jobs=${jobs || 0} reservations=${reservations || 0}`)
  }
}

async function cancelPlanningJob(
  service: SupabaseClient,
  planningId: string,
  reason: string,
) {
  await service
    .from('searches')
    .update({
      status: 'cancelled',
      results: [],
      progress: { stop_reason: reason, stage: 'matrix_budget_guard' },
    })
    .eq('id', planningId)
}

/**
 * Production compile path (same as unified-search-action shadow lane):
 * raw query → buildMiraxQueryPlan → canonical_plan from compiler.
 */
async function compileProductionPlan(
  service: SupabaseClient,
  spec: MatrixCaseSpec,
  planningSearchId: string,
): Promise<MiraxQueryPlan> {
  const meter = new PersistentResearchCostGovernor(service)
  await meter.initialize(planningSearchId, spec.requested_count)
  const diagnostics: unknown[] = []
  const plan = await buildMiraxQueryPlan(spec.raw_query, {
    requestedLeadCount: spec.requested_count,
    searchId: planningSearchId,
    costMeter: meter,
    allowRepair: false,
    onDiagnostic: (d) => diagnostics.push(d),
  })
  if (!plan.canonical_plan) {
    throw new Error(`production compiler returned no canonical_plan: ${JSON.stringify(diagnostics)}`)
  }
  if (plan.search_strategy === 'fallback') {
    throw new Error(`production compiler fell back: ${plan.user_message || plan.reasoning || 'fallback'}`)
  }
  return plan
}

async function prepareCase(service: SupabaseClient, id: MatrixCaseId) {
  const spec = OPENWORLD_MATRIX_CASES[id]
  if (!spec) throw new Error(`unknown --case ${id}; choices ${Object.keys(OPENWORLD_MATRIX_CASES).join(',')}`)
  assertCaseIsProductionInputOnly(spec)

  const budget = await reconstructBudget(service)
  if (!budget.can_prepare) {
    throw new Error(
      `prepare rejected: ${budget.reject_reason} residual=${budget.residual_budget_eur} ` +
        `authorized_ceiling=${budget.authorized_ceiling_eur} case_cap=${CASE_TOTAL_CAP_EUR}`,
    )
  }
  await assertSafeIdle(service)

  const userId = await resolveUserId(service, userEmail)
  const planningId = await createAgenticPlanningJob(service, {
    query: spec.raw_query,
    maxLeads: spec.requested_count,
    userId,
  })

  let plan: MiraxQueryPlan
  try {
    plan = await compileProductionPlan(service, spec, planningId)
  } catch (error) {
    await cancelPlanningJob(
      service,
      planningId,
      error instanceof Error ? error.message : String(error),
    )
    throw error
  }

  const planningSpend = await sumSearchPlanningSpend(service, planningId)
  let workerCap: ReturnType<typeof computeWorkerRemainingCap>
  try {
    workerCap = computeWorkerRemainingCap(CASE_TOTAL_CAP_EUR, planningSpend)
  } catch (error) {
    await cancelPlanningJob(service, planningId, 'CASE_BUDGET_EXHAUSTED_DURING_PLANNING')
    throw error
  }

  const canonical = plan.canonical_plan!
  const priorBudget =
    canonical.budget_policy && typeof canonical.budget_policy === 'object'
      ? (canonical.budget_policy as Record<string, unknown>)
      : {}
  const workerCanonical = {
    ...canonical,
    budget_policy: {
      ...priorBudget,
      // Worker may only spend the residual after planning — never a fresh CASE_TOTAL_CAP.
      hard_cost_eur: workerCap.worker_remaining_cap_eur,
      target_cost_eur: Number((workerCap.worker_remaining_cap_eur * 0.8).toFixed(4)),
    },
  }
  const job = await requestAgenticWorkerJob(service, {
    query: spec.raw_query,
    maxLeads: spec.requested_count,
    userId,
    location: plan.location,
    sector: plan.sector,
    intent: {
      lifecycle_stage: 'v5_shadow',
      customer_visible: false,
      prepare_only: false,
      execution_authorized: true,
      source_adapter_shadow: true,
      canonical_plan_prevalidated: true,
      required_signals: plan.required_signals,
      signals: (plan.required_signals || []).map((type) => ({ type, params: {} })),
      commercial_intent_spec: (canonical as { commercial_intent_spec?: unknown }).commercial_intent_spec,
      case_total_cap_eur: CASE_TOTAL_CAP_EUR,
      planning_spend_eur: workerCap.planning_spend_eur,
      worker_remaining_cap_eur: workerCap.worker_remaining_cap_eur,
      intent_compiler_telemetry: {
        source: MATRIX_TELEMETRY_SOURCE,
        case_id: id,
        request_mode: (canonical as { request_mode?: string }).request_mode ?? null,
        parse_source: plan.parse_source,
      },
    },
    plan: { ...plan, canonical_plan: workerCanonical },
    existingSearchId: planningId,
  })

  // Worker hard budget = remainder only (never re-grant the full CASE_TOTAL_CAP).
  // May no-op if planning already initialized an immutable lower product cap.
  try {
    await service.rpc('initialize_search_budget', {
      p_search_id: job.searchId,
      p_target_cost_eur: Number((workerCap.worker_remaining_cap_eur * 0.8).toFixed(4)),
      p_hard_cost_eur: workerCap.worker_remaining_cap_eur,
    })
  } catch {
    // non-fatal; MIRAX_SOURCE_ADAPTER_SHADOW_HARD_CAP_EUR enforces worker_remaining_cap
  }

  const artifact = {
    case_id: id,
    label: spec.label,
    raw_query: spec.raw_query,
    requested_count: spec.requested_count,
    search_id: job.searchId,
    compiled_intent: {
      parse_source: plan.parse_source,
      search_strategy: plan.search_strategy,
      intent_summary: plan.intent_summary,
      required_signals: plan.required_signals,
      location: plan.location,
      sector: plan.sector,
      request_mode: (canonical as { request_mode?: string }).request_mode ?? null,
    },
    canonical_plan: canonical,
    query_mode: (canonical as { request_mode?: string }).request_mode ?? plan.search_strategy,
    strategies: {
      search_strategy: plan.search_strategy,
      preferred_source_classes: canonical.source_policy?.preferred_source_classes ?? [],
      required_signals: canonical.signal_policy?.required_signals ?? [],
    },
    budget_before: budget,
    case_budget: {
      case_total_cap_eur: CASE_TOTAL_CAP_EUR,
      ...workerCap,
    },
    note: 'Job prepared pending. Run worker --once with worker_remaining_cap only.',
  }

  const outDir = path.join(process.cwd(), 'tmp', 'openworld-matrix')
  mkdirSync(outDir, { recursive: true })
  const outPath = path.join(outDir, `${id}-${job.searchId}.prepare.json`)
  writeFileSync(outPath, JSON.stringify(artifact, null, 2), 'utf8')

  console.log(
    JSON.stringify(
      {
        prepared: {
          case_id: id,
          search_id: job.searchId,
          query_mode: artifact.query_mode,
          required_signals: artifact.strategies.required_signals,
          preferred_sources: artifact.strategies.preferred_source_classes,
          case_budget: artifact.case_budget,
          artifact: outPath,
          worker_cmd: stagingWorkerCmd(job.searchId, workerCap.worker_remaining_cap_eur),
        },
      },
      null,
      2,
    ),
  )
  return artifact
}

function stagingWorkerCmd(searchId: string, workerRemainingCapEur: number): string {
  return [
    'cd /home/worker/app/backend-staging &&',
    'MIRAX_WORKER_DISABLED=0 MIRAX_SEARCH_DISABLED=0 MIRAX_SOURCE_ADAPTER_SHADOW_ENABLED=1',
    `MIRAX_SOURCE_ADAPTER_SHADOW_HARD_CAP_EUR=${workerRemainingCapEur}`,
    'PYTHONUNBUFFERED=1 PYTHONPATH=/home/worker/app/backend-staging',
    '/home/worker/app/venv/bin/python -u worker_supabase.py',
    `--once --search-id ${searchId} --mode user --user-recent-minutes 0 --cooldown 0`,
  ].join(' ')
}

async function reviewSearch(service: SupabaseClient, searchId: string) {
  const [{ data: search, error }, { data: candidates }, { data: ledger }] = await Promise.all([
    service.from('searches').select('id,status,results,progress,intent,updated_at').eq('id', searchId).single(),
    service
      .from('search_candidates')
      .select('id,stage,canonical_domain,entity_name,entity_type,payload')
      .eq('search_id', searchId),
    service
      .from('search_cost_ledger')
      .select('actual_cost_eur,estimated_cost_eur,status,operation_type')
      .eq('search_id', searchId),
  ])
  if (error) throw error
  const results = Array.isArray(search?.results) ? (search!.results as Record<string, unknown>[]) : []
  const progress = (search?.progress && typeof search.progress === 'object' ? search.progress : {}) as Record<
    string,
    unknown
  >
  const intent = (search?.intent && typeof search.intent === 'object' ? search.intent : {}) as Record<
    string,
    unknown
  >
  const cost = (ledger || []).reduce((sum, row) => sum + ledgerRowCost(row), 0)
  const leads = results.map((lead, i) => {
    const domain = String(lead.official_domain || lead.website_domain || lead.sito || lead.website || '')
      .replace(/^https?:\/\//i, '')
      .replace(/^www\./i, '')
      .split('/')[0]
      .toLowerCase()
    const cand = (candidates || []).find(
      (c) => String(c.canonical_domain || '').toLowerCase().replace(/^www\./, '') === domain,
    )
    const stamped = {
      ...lead,
      canonical_lead_id: lead.canonical_lead_id || cand?.id || null,
      entity_type: lead.entity_type || cand?.entity_type || null,
      query_mode:
        (intent.canonical_plan as { request_mode?: string } | undefined)?.request_mode ||
        (intent.uqe_plan as { canonical_plan?: { request_mode?: string } } | undefined)?.canonical_plan
          ?.request_mode ||
        null,
    }
    return formatLeadReview(stamped, i)
  })

  const out = {
    search_id: searchId,
    status: search?.status,
    raw_query: intent.original_query || intent.query || null,
    query_mode:
      (intent.canonical_plan as { request_mode?: string } | undefined)?.request_mode ||
      (intent.uqe_plan as MiraxQueryPlan | undefined)?.search_strategy ||
      null,
    strategies: {
      search_strategy: (intent.uqe_plan as MiraxQueryPlan | undefined)?.search_strategy || null,
      required_signals:
        (intent.canonical_plan as { signal_policy?: { required_signals?: string[] } } | undefined)?.signal_policy
          ?.required_signals ||
        intent.required_signals ||
        null,
    },
    cost_eur: Number(cost.toFixed(6)),
    funnel: formatFunnel(progress, results.length, (candidates || []).length),
    published_count: results.length,
    leads,
  }
  console.log(JSON.stringify({ review: out }, null, 2))
  return out
}

function offlineCheck() {
  const ids = Object.keys(OPENWORLD_MATRIX_CASES) as MatrixCaseId[]
  for (const id of ids) {
    assertCaseIsProductionInputOnly(OPENWORLD_MATRIX_CASES[id])
  }
  const fixtureLead = {
    canonical_lead_id: '00000000-0000-0000-0000-000000000001',
    azienda: 'Fixture SpA',
    entity_type: 'company',
    official_domain: 'fixture.example',
    email: 'info@fixture.example',
    query_mode: 'inferred_need',
    opportunity_state: 'OPEN_DEMAND',
    claim_type: 'OBSERVED_EVENT',
    source_url: 'https://fixture.example/news',
    evidence_excerpt: 'ampliamento linea produttiva',
    event_date: '2026-01-15',
    source_published_at: '2026-01-16',
    why_fit: '',
    why_now: 'Evento osservato',
    market_scope_status: 'LIKELY_SME',
    _lead_acceptance: { accepted: true, opportunity_state: 'OPEN_DEMAND', intent_strength: 'inferred' },
  }
  console.log(
    JSON.stringify(
      {
        offline_check: 'ok',
        cases: ids.map((id) => ({
          id,
          label: OPENWORLD_MATRIX_CASES[id].label,
          keys: Object.keys(OPENWORLD_MATRIX_CASES[id]).sort(),
        })),
        sample_lead_review: formatLeadReview(fixtureLead, 0),
        sample_funnel: formatFunnel(
          {
            acquisition: { pages_fetched: 12, provider_queries: 3 },
            universal_prefilter_telemetry: { prefilter_accepted: 8, prefilter_rejected: 20 },
            cumulative_raw_unique: 40,
            qualified: 3,
            published: 3,
          },
          3,
          3,
        ),
        extract: extractLeadReviewFields(fixtureLead),
      },
      null,
      2,
    ),
  )
}

async function main() {
  if (action === 'offline-check' || action === 'offline_check') {
    offlineCheck()
    return
  }
  if (action === 'all') {
    throw new Error('Refuse --all. Run one case at a time: prepare --case A, review, then B, …')
  }

  const service = serviceClient()
  try {
    if (action === 'budget') {
      await reconstructBudget(service)
      return
    }
    if (action === 'prepare') {
      if (!caseId || !(caseId in OPENWORLD_MATRIX_CASES)) {
        throw new Error(`--case required (A|B|C|D|E|F)`)
      }
      await prepareCase(service, caseId)
      return
    }
    if (action === 'review') {
      if (!searchIdArg) throw new Error('--search-id required')
      await reviewSearch(service, searchIdArg)
      return
    }
    if (action === 'worker-cmd' || action === 'worker_cmd') {
      if (!searchIdArg) throw new Error('--search-id required')
      const cap = Number(workerCapArg)
      if (!(cap > 0)) throw new Error('--worker-cap=<positive EUR> required (remaining after planning)')
      console.log(JSON.stringify({ worker_cmd: stagingWorkerCmd(searchIdArg, cap) }, null, 2))
      return
    }
    throw new Error(`unknown action ${action}; use budget|offline-check|prepare|review|worker-cmd`)
  } finally {
    await service.auth.signOut().catch(() => undefined)
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
