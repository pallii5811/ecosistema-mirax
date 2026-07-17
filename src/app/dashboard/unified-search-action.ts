'use server'

import { createClient, createServiceRoleClient } from '@/utils/supabase/server'
import type { CommercialIntent } from '@/lib/signal-intent/commercial-intent'
import { executeCommercialUniverseSearch } from '@/lib/universe/agentic-search'
import {
  cancelAgenticPlanningJob,
  createAgenticPlanningJob,
  requestAgenticWorkerJob,
  requestIncrementalScrape,
} from '@/lib/search-cache'
import { PersistentResearchCostGovernor } from '@/lib/research/persistent-cost-governor'
import {
  clampSearchMaxLeads,
  AGENTIC_NICHE_USER_MESSAGE,
} from '@/lib/search-job-payload'
import { filterLeadsForQuery } from '@/lib/lead-relevance'
import { hasLeadContact } from '@/lib/search-contact-quality'
import {
  buildMiraxQueryPlan,
  buildHeuristicMiraxQueryPlan,
  isSellerAbstractQuery,
} from '@/lib/uqe/mirax-query-planner'
import {
  enrichCommercialIntentFromSellerQuery,
  inferSellerBuyerProfile,
} from '@/lib/signal-intent/seller-buyer-inference'
import type { MiraxQueryPlan } from '@/types/uqe'
import {
  buyerMarketingMapsSector,
  isBuyerMarketingInvestmentQuery,
  isSellerMarketingAgencySector,
} from '@/lib/signal-intent/marketing-investment'
import {
  resolveStage1CapabilityFromSignals,
  stage1SearchOutcomeStatus,
  stage1UserMessage,
  type Stage1Capability,
} from '@/lib/stage1-capabilities'

const UNIFIED_SEARCH_TIMEOUT_MS = 50_000
const SEARCH_DISABLED_MESSAGE =
  'Ricerca temporaneamente in modalità sicurezza: stiamo validando i quality gate prima di riattivare i worker. Nessun credito è stato scalato.'

function envFlag(name: string): boolean {
  return ['1', 'true', 'yes', 'on'].includes(String(process.env[name] || '').trim().toLowerCase())
}

const withTimeout = async <T,>(promise: Promise<T>, ms: number) => {
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<T>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error('timeout')), ms)
  })
  try {
    return await Promise.race([promise, timeout])
  } finally {
    if (timeoutId) clearTimeout(timeoutId)
  }
}

export type UnifiedSearchResponse = {
  results: Record<string, unknown>[]
  status?: 'completed' | 'pending' | 'partial' | 'unavailable'
  jobId?: string
  searchId?: string
  filters?: Record<string, unknown>
  ai_debug?: Record<string, unknown>
  cache_meta?: Record<string, unknown>
  user_message?: string | null
  capability?: {
    id: string
    label: string
    status: string
    limits: string
  }
}

function capabilityPayload(capability: Stage1Capability) {
  return {
    id: capability.id,
    label: capability.label,
    status: capability.status,
    limits: capability.limits,
  }
}

function attachCapability(
  response: UnifiedSearchResponse,
  capability: Stage1Capability,
  extras: Record<string, unknown> = {},
): UnifiedSearchResponse {
  return {
    ...response,
    capability: capabilityPayload(capability),
    user_message: response.user_message ?? (
      capability.status === 'SUPPORTED' ? response.user_message : stage1UserMessage(capability)
    ),
    ai_debug: {
      ...(response.ai_debug || {}),
      stage1_capability: capabilityPayload(capability),
      ...extras,
    },
  }
}

const GRAPH_SUFFICIENCY_MIN = 5
const GRAPH_MIN_WITH_CONTACT = 3
const SELLER_LEADGEN_TARGET_CATEGORY = 'PMI B2B con team commerciale in espansione'
const SELLER_LEADGEN_TARGET_LOCATION = 'Italia'

function hasLeadGenerationOffer(query: string): boolean {
  return /\b(lead\s*generation|generazione\s+lead|sales\s*intelligence|prospect(?:ing)?|outreach|scouting|appointment\s*setting)\b/i.test(
    query,
  )
}

function isSellerLeadGenerationTarget(query: string, plan: MiraxQueryPlan): boolean {
  return Boolean(plan.commercial_hypothesis) || (isSellerAbstractQuery(query) && hasLeadGenerationOffer(query))
}

function normalizeSellerLeadGenerationPlan(plan: MiraxQueryPlan, query: string): MiraxQueryPlan {
  if (!isSellerLeadGenerationTarget(query, plan)) return plan
  const signals = new Set(plan.required_signals || [])
  signals.add('hiring')
  signals.add('expansion')
  return {
    ...plan,
    search_strategy: 'organic_web_search',
    sector: SELLER_LEADGEN_TARGET_CATEGORY,
    location: SELLER_LEADGEN_TARGET_LOCATION,
    required_signals: Array.from(signals),
    intent_summary:
      plan.intent_summary ||
      'PMI italiane B2B con investimento commerciale verificato: SDR/BDR, outbound, prospecting o sviluppo nuovi clienti.',
    research_questions: plan.research_questions?.length
      ? plan.research_questions
      : [
          'Quali PMI italiane stanno investendo adesso in sviluppo commerciale o outbound?',
          'Quale annuncio o fonte prova SDR, BDR, prospecting, pipeline o acquisizione nuovi clienti?',
          'Quanto e recente il segnale e chi guida Sales/Revenue nell azienda?',
        ],
  }
}

function countLeadsWithContact(leads: Record<string, unknown>[]): number {
  return leads.filter((l) => hasLeadContact(l)).length
}

function commercialIntentFromPlan(plan: MiraxQueryPlan, query: string): CommercialIntent {
  const base: CommercialIntent = {
    user_service_description: null,
    target_profile: {
      industries: plan.sector ? [plan.sector] : [],
      locations: plan.location ? [plan.location] : [],
      roles: [],
    },
    signals: plan.required_signals.map((type) => ({
      type: type as CommercialIntent['signals'][number]['type'],
      params: {},
    })),
    tech_profile: (plan.technical_filters || {}) as CommercialIntent['tech_profile'],
    graph_constraints: [],
    ranking_hint: 'default',
    intent_summary: plan.intent_summary,
    reasoning: plan.reasoning ?? null,
    confidence: plan.confidence,
    original_query: query,
    parse_source: plan.parse_source === 'llm' ? 'llm' : 'heuristic',
  }
  return enrichCommercialIntentFromSellerQuery(query, base)
}

function inferMapsCategoryFromPlan(plan: MiraxQueryPlan, query: string, intent: CommercialIntent): string {
  if (
    plan.required_signals.includes('investing_marketing') &&
    isBuyerMarketingInvestmentQuery(query)
  ) {
    if (plan.sector?.trim() && !isSellerMarketingAgencySector(plan.sector)) {
      return plan.sector.trim()
    }
    return buyerMarketingMapsSector()
  }
  if (plan.sector?.trim()) return plan.sector.trim()
  const q = query.toLowerCase()
  if (/\b(commercialist|ragioniere|contabil)\b/i.test(q)) return 'Studi commercialisti'
  if (/\b(python|programmatore|developer|sviluppat\w*)\b/i.test(q)) return 'Servizi informatici'
  if (intent.target_profile.industries?.[0]) {
    return intent.target_profile.industries[0].replace(/\b\w/g, (c) => c.toUpperCase())
  }
  return 'Aziende'
}

function resolveLocation(plan: MiraxQueryPlan, query: string, intent: CommercialIntent): string {
  const bogus = /^(marketing|software|digitale|crescita|espansione|trovarmi|vendere|cui)$/i
  const fromPlan = plan.location?.trim()
  if (fromPlan && !bogus.test(fromPlan)) return fromPlan
  const fromIntent = intent.target_profile.locations?.[0]
  if (fromIntent && !bogus.test(fromIntent)) return fromIntent
  const seller = inferSellerBuyerProfile(query, intent)
  if (seller.default_location) return seller.default_location
  return /\b(python|programmatore|developer|sviluppat\w*)\b/i.test(query) ? 'Milano' : 'Italia'
}

function workerIntentPayload(intent: CommercialIntent, query: string, plan: MiraxQueryPlan): Record<string, unknown> {
  const roles = [...(intent.target_profile.roles ?? [])]
  if (!roles.length && /\b(python|programmatore|developer|sviluppat\w*)\b/i.test(query)) {
    roles.push('programmatore')
  }
  const signals = intent.signals.map((s) => ({ ...s, params: { ...(s.params ?? {}) } }))
  if (roles.length) {
    const hiringIdx = signals.findIndex((s) => s.type === 'hiring')
    if (hiringIdx >= 0) {
      signals[hiringIdx] = {
        ...signals[hiringIdx],
        params: { ...signals[hiringIdx].params, role: signals[hiringIdx].params?.role ?? roles[0], roles },
      }
    }
  }
  return {
    query,
    original_query: query,
    user_service_description: intent.user_service_description,
    target_profile: intent.target_profile,
    signals,
    hiring_roles: roles,
    tech_profile: intent.tech_profile,
    graph_constraints: intent.graph_constraints,
    ranking_hint: intent.ranking_hint,
    intent_summary: intent.intent_summary,
    reasoning: intent.reasoning,
    confidence: intent.confidence,
    parse_source: intent.parse_source,
    search_strategy: plan.search_strategy,
    required_signals: plan.required_signals,
    commercial_hypothesis: plan.commercial_hypothesis,
    ranking_policy: plan.ranking_policy,
    uqe_plan: plan,
  }
}

function planAiDebug(plan: MiraxQueryPlan, desiredMax: number): Record<string, unknown> {
  return {
    mode: 'unified',
    uqe: true,
    search_strategy: plan.search_strategy,
    parse_source: plan.parse_source,
    confidence: plan.confidence,
    intent_summary: plan.intent_summary,
    reasoning: plan.reasoning,
    required_signals: plan.required_signals,
    technical_filters: plan.technical_filters,
    sector: plan.sector,
    location: plan.location,
    desired_max: desiredMax,
  }
}

export async function unifiedSearchAction(
  userQuery: string,
  options?: { maxLeads?: number; plan?: MiraxQueryPlan },
): Promise<UnifiedSearchResponse> {
  if (envFlag('MIRAX_SEARCH_DISABLED') || envFlag('MIRAX_WORKER_DISABLED')) {
    const capability = resolveStage1CapabilityFromSignals([])
    return attachCapability(
      {
        results: [],
        status: 'unavailable',
        user_message: SEARCH_DISABLED_MESSAGE,
        ai_debug: {
          mode: 'safe_disabled',
          search_disabled: true,
        },
      },
      capability,
      { brake_engaged: true },
    )
  }
  try {
    return await withTimeout(unifiedSearchActionCore(userQuery, options), UNIFIED_SEARCH_TIMEOUT_MS)
  } catch (err) {
    const query = (userQuery || '').trim()
    if (query && err instanceof Error && err.message === 'timeout' && !options?.plan) {
      try {
        const heuristic = buildHeuristicMiraxQueryPlan(query)
        if (heuristic.search_strategy !== 'fallback') {
          return await withTimeout(
            unifiedSearchActionCore(userQuery, { ...options, plan: heuristic }),
            UNIFIED_SEARCH_TIMEOUT_MS,
          )
        }
      } catch {
        // fall through
      }
    }
    return {
      results: [],
      status: 'unavailable',
      user_message:
        'La ricerca ha impiegato troppo tempo. Riprova con categoria e città (es. "ristoranti Milano") o riduci il target.',
      ai_debug: { error: err instanceof Error ? err.message : String(err), mode: 'unified_timeout' },
    }
  }
}

async function unifiedSearchActionCore(
  userQuery: string,
  options?: { maxLeads?: number; plan?: MiraxQueryPlan },
): Promise<UnifiedSearchResponse> {
  const query = (userQuery || '').trim()
  if (!query) {
    return { results: [], status: 'completed', ai_debug: { error: 'QUERY_EMPTY' } }
  }

  const desiredMax = clampSearchMaxLeads(options?.maxLeads ?? 10)
  const supabase = await createClient()

  let userId: string | undefined
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser()
    userId = user?.id
  } catch {
    userId = undefined
  }

  let planningSearchId: string | null = null
  let rawPlan: MiraxQueryPlan
  if (options?.plan) {
    rawPlan = options.plan
  } else {
    planningSearchId = await createAgenticPlanningJob(supabase, {
      query,
      maxLeads: desiredMax,
      userId,
    })
    try {
      const costMeter = new PersistentResearchCostGovernor(createServiceRoleClient())
      await costMeter.initialize(planningSearchId, desiredMax)
      rawPlan = await buildMiraxQueryPlan(query, {
        requestedLeadCount: desiredMax,
        searchId: planningSearchId,
        costMeter,
      })
    } catch (error) {
      await cancelAgenticPlanningJob(supabase, planningSearchId, 'planning_failed')
      throw error
    }
  }
  const plan = normalizeSellerLeadGenerationPlan(rawPlan, query)
  const capability = resolveStage1CapabilityFromSignals(plan.required_signals || [])

  const aiDebug = planAiDebug(plan, desiredMax)

  const filters: Record<string, unknown> = {
    citta: plan.location || null,
    categoria: plan.sector || null,
  }

  if (capability.status === 'BETA' || capability.status === 'UNAVAILABLE') {
    if (planningSearchId) {
      await cancelAgenticPlanningJob(supabase, planningSearchId, 'capability_unavailable')
    }
    return attachCapability(
      {
        results: [],
        status: 'unavailable',
        user_message: stage1UserMessage(capability),
        filters,
        ai_debug: { ...aiDebug, source: 'stage1_capability_gate' },
      },
      capability,
    )
  }

  if (plan.search_strategy === 'fallback') {
    if (planningSearchId) {
      await cancelAgenticPlanningJob(supabase, planningSearchId, 'intent_fallback')
    }
    return attachCapability(
      {
        results: [],
        status: 'unavailable',
        user_message: plan.user_message || stage1UserMessage(capability),
        filters,
        ai_debug: { ...aiDebug, source: 'uqe_fallback' },
      },
      capability,
    )
  }

  const intent = commercialIntentFromPlan(plan, query)
  const location = resolveLocation(plan, query, intent)
  const scrapeCategory = inferMapsCategoryFromPlan(plan, query, intent)
  const workerPayload = workerIntentPayload(intent, query, plan)

  // The staging UI can opt into the already-existing v5 source-adapter lane.
  // Production remains fail-closed unless this explicit server-side flag is set.
  if (envFlag('MIRAX_UI_SOURCE_ADAPTER_SHADOW_ENABLED') && plan.canonical_plan) {
    let sourceAdapterJob
    try {
      sourceAdapterJob = await requestAgenticWorkerJob(supabase, {
        query,
        maxLeads: desiredMax,
        userId,
        location,
        sector: scrapeCategory,
        intent: {
          ...workerPayload,
          lifecycle_stage: 'v5_shadow',
          customer_visible: false,
          prepare_only: false,
          execution_authorized: true,
          source_adapter_shadow: true,
          canonical_plan_prevalidated: true,
        },
        plan: {
          ...plan,
          canonical_plan: plan.canonical_plan,
        },
        existingSearchId: planningSearchId,
      })
    } catch (error) {
      if (planningSearchId) {
        await cancelAgenticPlanningJob(supabase, planningSearchId, 'source_adapter_ui_activation_failed')
      }
      throw error
    }

    return attachCapability(
      {
        results: [],
        status: 'pending',
        jobId: sourceAdapterJob.jobId,
        searchId: sourceAdapterJob.searchId,
        filters,
        user_message: 'Ricerca live evidence-first avviata in staging.',
        ai_debug: {
          ...aiDebug,
          source: 'source_adapter_shadow_ui',
          billing_suppressed: true,
          customer_visible: false,
          max_leads: desiredMax,
        },
        cache_meta: {
          source: 'source_adapter_shadow_ui',
          canonical_job_id: sourceAdapterJob.jobId,
          needs_more_scrape: true,
        },
      },
      capability,
    )
  }

  if (plan.search_strategy === 'organic_web_search') {
    let agenticJob
    try {
      agenticJob = await requestAgenticWorkerJob(supabase, {
      query,
      maxLeads: desiredMax,
      userId,
      location,
      sector: scrapeCategory,
      intent: {
        ...workerPayload,
        search_mode: 'agentic_only',
        search_strategy: 'organic_web_search',
      },
      plan: {
        original_query: query,
        search_strategy: 'organic_web_search',
        sector: scrapeCategory,
        location,
        required_signals: plan.required_signals,
        technical_filters: plan.technical_filters,
         extraction_schema: plan.extraction_schema,
         intent_summary: plan.intent_summary,
         research_questions: plan.research_questions,
         source_plan: plan.source_plan,
         evidence_policy: plan.evidence_policy,
         commercial_hypothesis: plan.commercial_hypothesis,
         ranking_policy: plan.ranking_policy,
       },
      existingSearchId: planningSearchId,
      })
    } catch (error) {
      if (planningSearchId) {
        await cancelAgenticPlanningJob(supabase, planningSearchId, 'worker_activation_failed')
      }
      throw error
    }

    return attachCapability(
      {
        results: [],
        status: 'pending',
        jobId: agenticJob.jobId,
        searchId: agenticJob.searchId,
        filters,
        user_message: [
          AGENTIC_NICHE_USER_MESSAGE,
          capability.status === 'SUPPORTED_PARTIAL' ? stage1UserMessage(capability) : null,
        ].filter(Boolean).join(' '),
        ai_debug: {
          ...aiDebug,
          source: 'agentic_worker',
          max_leads: desiredMax,
          scrape_category: scrapeCategory,
          scrape_location: location,
        },
        cache_meta: {
          source: 'agentic_worker',
          canonical_job_id: agenticJob.jobId,
          needs_more_scrape: true,
        },
      },
      capability,
    )
  }

  // maps + hybrid → discovery Maps immediata (streaming + audit 1-a-1 sul worker)
  if (plan.search_strategy === 'maps' || plan.search_strategy === 'hybrid') {
    try {
      const scrape = await requestIncrementalScrape(supabase, {
        category: scrapeCategory,
        location,
        maxLeads: desiredMax,
        userId,
        originalQuery: query,
        intent: workerPayload,
      })

      if (planningSearchId) {
        await cancelAgenticPlanningJob(supabase, planningSearchId, 'planning_transferred_to_maps_job')
      }

      return attachCapability(
        {
          results: [],
          status: 'pending',
          jobId: scrape.jobId,
          searchId: scrape.jobId,
          filters,
          user_message: capability.status === 'SUPPORTED_PARTIAL' ? stage1UserMessage(capability) : null,
          ai_debug: {
            ...aiDebug,
            source: plan.search_strategy === 'hybrid' ? 'maps_hybrid_worker' : 'maps_worker',
            scrape_category: scrapeCategory,
            scrape_location: location,
            scrape_reused: scrape.reused,
          },
          cache_meta: {
            source: 'maps_worker',
            canonical_job_id: scrape.jobId,
            needs_more_scrape: true,
          },
        },
        capability,
      )
    } catch (e) {
      if (planningSearchId) {
        await cancelAgenticPlanningJob(supabase, planningSearchId, 'maps_activation_failed')
      }
      const err = e instanceof Error ? e.message : String(e)
      return attachCapability(
        {
          results: [],
          status: 'unavailable',
          filters,
          user_message: `Impossibile avviare la discovery Maps: ${err}`,
          ai_debug: { ...aiDebug, source: 'maps_worker', scrape_error: err },
        },
        capability,
      )
    }
  }

  // graph esplicito — Knowledge Graph, fallback Maps se insufficiente
  let graphResults: Record<string, unknown>[] = []
  let graphTotal = 0
  let graphError: string | null = null
  try {
    const graphResponse = await executeCommercialUniverseSearch(supabase, intent, {
      limit: Math.max(desiredMax, GRAPH_SUFFICIENCY_MIN),
      userId,
      skipOpportunities: false,
      skipHydration: false,
      skipRanking: false,
    })
    graphResults = Array.isArray(graphResponse.results) ? graphResponse.results : []
    graphTotal = graphResponse.total ?? graphResults.length
  } catch (e) {
    graphError = e instanceof Error ? e.message : String(e)
    console.error('[unified] graph search error:', graphError)
  }

  graphResults = await filterLeadsForQuery(graphResults, query, { useAI: true })

  const withContact = countLeadsWithContact(graphResults)
  const sufficientAfterFilter =
    graphResults.length >= Math.min(desiredMax, GRAPH_SUFFICIENCY_MIN) &&
    withContact >= Math.min(desiredMax, GRAPH_MIN_WITH_CONTACT)

  if (plan.search_strategy === 'graph' && sufficientAfterFilter) {
    const sliced = graphResults.slice(0, desiredMax)
    return attachCapability(
      {
        results: sliced,
        status: stage1SearchOutcomeStatus(capability, {
          found: sliced.length,
          target: desiredMax,
        }),
        searchId: `graph-${Date.now()}`,
        filters,
        user_message:
          sliced.length < desiredMax && capability.status === 'SUPPORTED_PARTIAL'
            ? stage1UserMessage(capability)
            : null,
        ai_debug: {
          ...aiDebug,
          source: 'knowledge_graph',
          graph_total: graphTotal,
          graph_returned: graphResults.length,
          graph_error: graphError,
        },
        cache_meta: {
          source: 'knowledge_graph',
          graph_total: graphTotal,
          graph_returned: graphResults.length,
        },
      },
      capability,
    )
  }

  try {
    const scrape = await requestIncrementalScrape(supabase, {
      category: scrapeCategory,
      location,
      maxLeads: desiredMax,
      userId,
      originalQuery: query,
      intent: workerPayload,
    })

    return attachCapability(
      {
        results: graphResults,
        status: 'pending',
        jobId: scrape.jobId,
        searchId: scrape.jobId,
        filters,
        user_message: capability.status === 'SUPPORTED_PARTIAL' ? stage1UserMessage(capability) : null,
        ai_debug: {
          ...aiDebug,
          source: 'knowledge_graph_then_scrape',
          graph_total: graphTotal,
          graph_returned: graphResults.length,
          scrape_category: scrapeCategory,
          scrape_location: location,
          scrape_reused: scrape.reused,
          graph_error: graphError,
        },
        cache_meta: {
          source: 'knowledge_graph_then_scrape',
          graph_total: graphTotal,
          graph_returned: graphResults.length,
          canonical_job_id: scrape.jobId,
          needs_more_scrape: true,
        },
      },
      capability,
    )
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e)
    console.error('[unified] scrape trigger error:', err)
    return attachCapability(
      {
        results: graphResults,
        status: stage1SearchOutcomeStatus(capability, {
          found: graphResults.length,
          target: desiredMax,
        }),
        searchId: `graph-${Date.now()}`,
        filters,
        user_message: graphResults.length
          ? `Risultati parziali dal Knowledge Graph. Scrape non avviato: ${err}`
          : `Impossibile completare la ricerca: ${err}`,
        ai_debug: {
          ...aiDebug,
          source: 'knowledge_graph',
          graph_total: graphTotal,
          graph_returned: graphResults.length,
          scrape_error: err,
          graph_error: graphError,
        },
        cache_meta: { source: 'knowledge_graph' },
      },
      capability,
    )
  }
}
