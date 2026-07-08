'use server'

import { createClient } from '@/utils/supabase/server'
import type { CommercialIntent } from '@/lib/signal-intent/commercial-intent'
import { executeCommercialUniverseSearch } from '@/lib/universe/agentic-search'
import { requestAgenticWorkerJob, requestIncrementalScrape } from '@/lib/search-cache'
import {
  clampSearchMaxLeads,
  AGENTIC_NICHE_USER_MESSAGE,
} from '@/lib/search-job-payload'
import { filterLeadsForQuery } from '@/lib/lead-relevance'
import { hasLeadContact } from '@/lib/search-contact-quality'
import { buildMiraxQueryPlan, buildHeuristicMiraxQueryPlan } from '@/lib/uqe/mirax-query-planner'
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

const UNIFIED_SEARCH_TIMEOUT_MS = 50_000

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
  status?: 'completed' | 'pending'
  jobId?: string
  searchId?: string
  filters?: Record<string, unknown>
  ai_debug?: Record<string, unknown>
  cache_meta?: Record<string, unknown>
  user_message?: string | null
}

const GRAPH_SUFFICIENCY_MIN = 5
const GRAPH_MIN_WITH_CONTACT = 3

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
      status: 'completed' as const,
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

  const plan = options?.plan ?? (await buildMiraxQueryPlan(query))

  const supabase = await createClient()
  const desiredMax = clampSearchMaxLeads(options?.maxLeads ?? 10)

  let userId: string | undefined
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser()
    userId = user?.id
  } catch {
    userId = undefined
  }

  const aiDebug = planAiDebug(plan, desiredMax)

  const filters: Record<string, unknown> = {
    citta: plan.location || null,
    categoria: plan.sector || null,
  }

  if (plan.search_strategy === 'fallback') {
    return {
      results: [],
      status: 'completed',
      user_message: plan.user_message,
      filters,
      ai_debug: { ...aiDebug, source: 'uqe_fallback' },
    }
  }

  const intent = commercialIntentFromPlan(plan, query)
  const location = resolveLocation(plan, query, intent)
  const scrapeCategory = inferMapsCategoryFromPlan(plan, query, intent)
  const workerPayload = workerIntentPayload(intent, query, plan)

  if (plan.search_strategy === 'organic_web_search') {
    const agenticJob = await requestAgenticWorkerJob(supabase, {
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
    })

    return {
      results: [],
      status: 'pending',
      jobId: agenticJob.jobId,
      searchId: agenticJob.searchId,
      filters,
      user_message: AGENTIC_NICHE_USER_MESSAGE,
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
    }
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

      return {
        results: [],
        status: 'pending',
        jobId: scrape.jobId,
        searchId: scrape.jobId,
        filters,
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
      }
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e)
      return {
        results: [],
        status: 'completed',
        filters,
        user_message: `Impossibile avviare la discovery Maps: ${err}`,
        ai_debug: { ...aiDebug, source: 'maps_worker', scrape_error: err },
      }
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
    return {
      results: graphResults.slice(0, desiredMax),
      status: 'completed',
      searchId: `graph-${Date.now()}`,
      filters,
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
    }
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

    return {
      results: graphResults,
      status: 'pending',
      jobId: scrape.jobId,
      searchId: scrape.jobId,
      filters,
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
    }
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e)
    console.error('[unified] scrape trigger error:', err)
    return {
      results: graphResults,
      status: 'completed',
      searchId: `graph-${Date.now()}`,
      filters,
      ai_debug: {
        ...aiDebug,
        source: 'knowledge_graph',
        graph_total: graphTotal,
        graph_returned: graphResults.length,
        scrape_error: err,
        graph_error: graphError,
      },
      cache_meta: { source: 'knowledge_graph' },
    }
  }
}
