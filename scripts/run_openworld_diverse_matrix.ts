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
 *   npx tsx scripts/run_openworld_diverse_matrix.ts prepare --case A --user-email you@example.com
 *   npx tsx scripts/run_openworld_diverse_matrix.ts review --search-id <uuid>
 *   npx tsx scripts/run_openworld_diverse_matrix.ts worker-cmd --search-id <uuid>
 *
 * Do NOT run `all`. Execute case A only after SSH deploy, review, then B, …
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

config({ path: '.env.local' })

const SPEND_CEILING_EUR = Number(process.env.MIRAX_OPENWORLD_SPEND_CEILING_EUR || '2.70')
const HARD_CAP_EUR = Number(process.env.MIRAX_SOURCE_ADAPTER_SHADOW_HARD_CAP_EUR || '0.25')
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

/** Real cumulative spend from ledger — not report estimates. */
async function reconstructBudgetViaPostgres() {
  const { connectMiraxDb, loadMiraxDbPassword } = await import('./lib/mirax-db.mjs')
  if (!loadMiraxDbPassword()) throw new Error('ECOSISTEMA_DB_PASSWORD missing for budget fallback')
  const c = await connectMiraxDb()
  try {
    // Campaign-scoped spend only (open-world / v5_shadow), not the whole product ledger.
    const r = await c.query(
      `with campaign_searches as (
         select s.id
           from public.searches s
          where s.created_at >= $2::timestamptz
            and (
              coalesce(s.intent->'intent_compiler_telemetry'->>'source','')
                = 'openworld_diverse_matrix_production_path'
              or coalesce(s.category,'') ilike '%Open-World%'
              or coalesce(s.category,'') ilike '%open-world%'
              or exists (
                   select 1 from public.canary_runs c
                    where c.search_id = s.id
                      and (
                        c.canary_type ilike 'open_world%'
                        or c.canary_type ilike '%openworld%'
                      )
                 )
            )
       )
       select coalesce(sum(coalesce(l.actual_cost_eur, l.estimated_cost_eur, 0)), 0)::float as cumulative,
              count(*)::int as n
         from public.search_cost_ledger l
         join campaign_searches cs on cs.id = l.search_id
        where l.status = any($1::text[])`,
      [['settled', 'committed', 'failed', 'halted'], BUDGET_SINCE],
    )
    const cumulative = Number(r.rows[0]?.cumulative || 0)
    const residual = Math.max(0, SPEND_CEILING_EUR - cumulative)
    return {
      cumulative_cost_eur: Number(cumulative.toFixed(6)),
      spend_ceiling_eur: SPEND_CEILING_EUR,
      residual_budget_eur: Number(residual.toFixed(6)),
      hard_cap_per_search_eur: HARD_CAP_EUR,
      ledger_rows: Number(r.rows[0]?.n || 0),
      enough_for_one_case: residual + 1e-9 >= HARD_CAP_EUR,
      source: 'postgres_direct_campaign_scoped' as const,
      budget_since: BUDGET_SINCE,
    }
  } finally {
    await c.end()
  }
}

/** Real cumulative spend from ledger — not report estimates. */
async function reconstructBudget(service: SupabaseClient) {
  try {
    const { data, error } = await service
      .from('search_cost_ledger')
      .select('actual_cost_eur,estimated_cost_eur,status')
      .in('status', ['settled', 'committed', 'failed', 'halted'])
    if (error) throw new Error(error.message || JSON.stringify(error))
    const rows = data || []
    const cumulative = rows.reduce(
      (sum, row) => sum + Number(row.actual_cost_eur ?? row.estimated_cost_eur ?? 0),
      0,
    )
    const residual = Math.max(0, SPEND_CEILING_EUR - cumulative)
    const out = {
      cumulative_cost_eur: Number(cumulative.toFixed(6)),
      spend_ceiling_eur: SPEND_CEILING_EUR,
      residual_budget_eur: Number(residual.toFixed(6)),
      hard_cap_per_search_eur: HARD_CAP_EUR,
      ledger_rows: rows.length,
      enough_for_one_case: residual + 1e-9 >= HARD_CAP_EUR,
      source: 'supabase_rest' as const,
    }
    console.log(JSON.stringify({ budget: out }, null, 2))
    return out
  } catch (restErr) {
    const out = await reconstructBudgetViaPostgres()
    console.log(
      JSON.stringify(
        {
          budget: out,
          rest_fallback_reason: restErr instanceof Error ? restErr.message : String(restErr),
        },
        null,
        2,
      ),
    )
    return out
  }
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

/**
 * Production compile path (same as unified-search-action shadow lane):
 * raw query → buildMiraxQueryPlan → canonical_plan from compiler.
 * No manual seller/target/signals/adapters injection.
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
  if (!budget.enough_for_one_case) {
    throw new Error(
      `residual budget ${budget.residual_budget_eur} < hard cap ${HARD_CAP_EUR}; refuse paid prepare`,
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
    await service
      .from('searches')
      .update({
        status: 'cancelled',
        results: [],
        progress: {
          stop_reason: error instanceof Error ? error.message : String(error),
          stage: 'matrix_compile_failed',
        },
      })
      .eq('id', planningId)
    throw error
  }

  const canonical = plan.canonical_plan!
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
      intent_compiler_telemetry: {
        source: 'openworld_diverse_matrix_production_path',
        case_id: id,
        request_mode: (canonical as { request_mode?: string }).request_mode ?? null,
        parse_source: plan.parse_source,
      },
    },
    plan: { ...plan, canonical_plan: canonical },
    existingSearchId: planningId,
  })

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
    note: 'Job prepared pending. Run worker --once on staging (persistent workers stay inactive+disabled).',
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
          artifact: outPath,
          worker_cmd: stagingWorkerCmd(job.searchId),
        },
      },
      null,
      2,
    ),
  )
  return artifact
}

function stagingWorkerCmd(searchId: string): string {
  return [
    'cd /home/worker/app/backend-staging &&',
    'MIRAX_WORKER_DISABLED=0 MIRAX_SEARCH_DISABLED=0 MIRAX_SOURCE_ADAPTER_SHADOW_ENABLED=1',
    `MIRAX_SOURCE_ADAPTER_SHADOW_HARD_CAP_EUR=${HARD_CAP_EUR}`,
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
  const cost = (ledger || []).reduce(
    (sum, row) => sum + Number(row.actual_cost_eur ?? row.estimated_cost_eur ?? 0),
    0,
  )
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
  const fields = extractLeadReviewFields(fixtureLead)
  if (fields.event_date !== '2026-01-15') throw new Error('event_date must stay literal')
  if (fields.source_published_at !== '2026-01-16') throw new Error('source_published_at must stay literal')
  // no cross-fallback: missing event_date stays empty
  const noEvent = extractLeadReviewFields({ ...fixtureLead, event_date: undefined })
  if (noEvent.event_date !== '') throw new Error('must not fall back source_published_at into event_date')
  if (noEvent.source_published_at !== '2026-01-16') throw new Error('source_published_at lost')

  console.log(
    JSON.stringify(
      {
        offline_check: 'ok',
        cases: ids.map((id) => ({
          id,
          label: OPENWORLD_MATRIX_CASES[id].label,
          keys: Object.keys(OPENWORLD_MATRIX_CASES[id]).sort(),
          raw_query_preview: OPENWORLD_MATRIX_CASES[id].raw_query.slice(0, 80),
        })),
        sample_lead_review: formatLeadReview(fixtureLead, 0),
        sample_funnel: formatFunnel(
          {
            acquisition: { pages_fetched: 12, provider_queries: 3 },
            universal_prefilter_telemetry: { prefilter_accepted: 8, prefilter_rejected: 20 },
            cumulative_raw_unique: 40,
            cumulative_audited: 10,
            qualified: 3,
            published: 3,
          },
          3,
          3,
        ),
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
      console.log(JSON.stringify({ worker_cmd: stagingWorkerCmd(searchIdArg) }, null, 2))
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
