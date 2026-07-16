import { config } from 'dotenv'
import { createClient } from '@supabase/supabase-js'

import { createAgenticPlanningJob, requestAgenticWorkerJob } from '../src/lib/search-cache'
import { buildMiraxQueryPlan } from '../src/lib/uqe/mirax-query-planner'
import { PersistentResearchCostGovernor } from '../src/lib/research/persistent-cost-governor'

config({ path: '.env.local' })

const SPECS = {
  'digital-audit': 'Trova imprese di pulizia a Milano con sito ufficiale, criticità SEO e assenza di strumenti di tracciamento pubblicitario.',
  'hiring-sales': 'Trova aziende in Lombardia che stanno assumendo commerciali, sales manager o business developer.',
  'hiring-marketing': 'Trovami aziende in Italia che stanno assumendo marketing manager, digital marketing specialist, growth manager, performance marketing specialist o social media manager.',
} as const

const args = new Map(process.argv.slice(2).map((arg) => {
  const [key, ...value] = arg.replace(/^--/, '').split('=')
  return [key, value.join('=') || 'true']
}))
const action = args.get('action') || 'status'
const vertical = args.get('vertical') as keyof typeof SPECS
const searchId = args.get('search-id') || ''
const userEmail = args.get('user-email') || ''
const requestedCount = 5

function required(name: string): string {
  const value = String(process.env[name] || '').trim()
  if (!value) throw new Error(`${name} required`)
  return value
}

const service = createClient(required('NEXT_PUBLIC_SUPABASE_URL'), required('SUPABASE_SERVICE_ROLE_KEY'), {
  auth: { persistSession: false, autoRefreshToken: false },
})

async function assertSafeIdle() {
  const [{ count: jobs }, { count: reservations }] = await Promise.all([
    service.from('searches').select('id', { count: 'exact', head: true })
      .in('status', ['planning', 'pending', 'pending_user', 'processing', 'running']),
    service.from('search_cost_ledger').select('id', { count: 'exact', head: true }).eq('status', 'reserved'),
  ])
  if ((jobs || 0) > 0 || (reservations || 0) > 0) {
    throw new Error(`unsafe active state jobs=${jobs || 0} reservations=${reservations || 0}`)
  }
}

async function resolveUserId(email: string): Promise<string> {
  if (!email) throw new Error('--user-email required')
  const { data, error } = await service.auth.admin.listUsers({ page: 1, perPage: 1000 })
  if (error) throw error
  const user = data.users.find((item) => item.email?.toLowerCase() === email.toLowerCase())
  if (!user) throw new Error('staging UI user not found')
  return user.id
}

async function prepare() {
  if (!SPECS[vertical]) throw new Error('unknown --vertical')
  await assertSafeIdle()
  const query = SPECS[vertical]
  const userId = await resolveUserId(userEmail)
  const planningId = await createAgenticPlanningJob(service, {
    query,
    maxLeads: requestedCount,
    userId,
  })
  try {
    const meter = new PersistentResearchCostGovernor(service)
    await meter.initialize(planningId, requestedCount)
    const diagnostics: unknown[] = []
    const plan = await buildMiraxQueryPlan(query, {
      requestedLeadCount: requestedCount,
      searchId: planningId,
      costMeter: meter,
      allowRepair: false,
      onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
    })
    const canonical = plan.canonical_plan
    if (!canonical || plan.parse_source !== 'llm' || canonical.signal_policy.required_signals.length === 0) {
      throw new Error(`canonical LLM plan required: ${JSON.stringify(diagnostics)}`)
    }
    if (canonical.budget_policy.hard_cost_eur > 0.125 + 1e-9) throw new Error('canonical hard cap exceeds EUR 0.125')
    const job = await requestAgenticWorkerJob(service, {
      query,
      maxLeads: requestedCount,
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
        signals: plan.required_signals.map((type) => ({ type, params: {} })),
      },
      plan: { ...plan, canonical_plan: canonical },
      existingSearchId: planningId,
    })
    console.log(JSON.stringify({
      action: 'prepared', vertical, query, search_id: job.searchId,
      requested_count: requestedCount, hard_cap_eur: 0.125,
      search_strategy: plan.search_strategy,
      required_signals: canonical.signal_policy.required_signals,
      preferred_sources: canonical.source_policy.preferred_source_classes,
      customer_visible: false,
    }, null, 2))
  } catch (error) {
    await service.from('searches').update({
      status: 'cancelled', results: [],
      progress: { stop_reason: error instanceof Error ? error.message : String(error) },
    }).eq('id', planningId)
    throw error
  }
}

async function status() {
  if (!/^[0-9a-f-]{36}$/i.test(searchId)) throw new Error('--search-id required')
  const [{ data: search, error: searchError }, { data: candidates }, { data: evidence }, { data: ledger }, { count: publications }, { count: charges }] = await Promise.all([
    service.from('searches').select('id,status,results,progress,intent,updated_at').eq('id', searchId).single(),
    service.from('search_candidates').select('id,stage,canonical_domain,entity_name,rejection_code,payload').eq('search_id', searchId),
    service.from('search_evidence').select('candidate_id,signal_type,source_url,source_publisher,published_at,evidence_excerpt,confidence').eq('search_id', searchId),
    service.from('search_cost_ledger').select('operation_type,provider,status,actual_cost_eur,estimated_cost_eur,error_code').eq('search_id', searchId),
    service.from('search_publications').select('id', { count: 'exact', head: true }).eq('search_id', searchId),
    service.from('search_credit_charges').select('id', { count: 'exact', head: true }).eq('search_id', searchId),
  ])
  if (searchError) throw searchError
  const totalCost = (ledger || []).reduce((sum, row) => sum + Number(row.actual_cost_eur ?? row.estimated_cost_eur ?? 0), 0)
  console.log(JSON.stringify({ search, candidates: candidates || [], evidence: evidence || [], ledger: ledger || [], total_cost_eur: totalCost, publications: publications || 0, charges: charges || 0 }, null, 2))
}

async function quarantine() {
  if (!/^[0-9a-f-]{36}$/i.test(searchId)) throw new Error('--search-id required')
  await service.from('searches').update({
    status: 'cancelled', results: [],
    progress: { stage: 'live_ui_quarantined', stop_reason: args.get('reason') || 'LIVE_UI_VALUE_SLICE_FAILED' },
  }).eq('id', searchId).in('status', ['planning', 'pending', 'processing', 'running', 'error'])
  console.log(JSON.stringify({ action: 'quarantined', search_id: searchId }, null, 2))
}

async function main() {
  try {
    if (action === 'prepare') await prepare()
    else if (action === 'status') await status()
    else if (action === 'quarantine') await quarantine()
    else throw new Error('action must be prepare, status or quarantine')
  } finally {
    await service.auth.signOut().catch(() => undefined)
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
