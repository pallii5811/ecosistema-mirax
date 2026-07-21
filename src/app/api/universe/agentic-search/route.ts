/**
 * POST /api/universe/agentic-search
 * Query NL → intent → grafo → risultati compatibili ResultsTable.
 *
 * Supports two modes:
 * 1. Commercial intent (LLM-first, free-text) — default when user_query is sent.
 * 2. Signal intent (legacy structured) — used when signal_intent is sent explicitly.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/utils/supabase/server'
import {
  executeAgenticUniverseSearch,
  executeCommercialUniverseSearch,
  type CommercialUniverseQueryIntent,
  type UniverseQueryIntent,
} from '@/lib/universe'
import { requireUniverseAuth } from '@/lib/universe/require-auth'
import {
  buildUniverseCacheKey,
  getQueryCache,
  isUniverseCacheEnabled,
  setQueryCache,
} from '@/lib/universe/query-cache'
import { parseSignalIntentOffline } from '@/lib/signal-intent/parse-semantic'
import { coerceSignalIntent } from '@/lib/signal-intent/parse-heuristic'
import { parseCommercialIntentOffline } from '@/lib/signal-intent/parse-commercial-intent'
import { commercialIntentKey, type CommercialIntent } from '@/lib/signal-intent/commercial-intent'
import {
  cancelAgenticPlanningJob,
  createAgenticPlanningJob,
  requestAgenticWorkerJob,
} from '@/lib/search-cache'
import { PersistentResearchCostGovernor } from '@/lib/research/persistent-cost-governor'
import { clampSearchMaxLeads } from '@/lib/search-job-payload'
import { buildMiraxQueryPlan } from '@/lib/uqe/mirax-query-planner'
import { buildWorkerCommercialIntentBundle } from '@/lib/commercial-intent/attach-worker-intent'
import type { SignalIntentSpec } from '@/lib/signal-intent/types'
import { universeClientError } from '@/lib/universe/errors'

type AgenticSearchMode = 'commercial' | 'signal' | 'worker_agentic'

type CommercialSearchResult = Awaited<ReturnType<typeof executeCommercialUniverseSearch>>
type SignalSearchResult = Awaited<ReturnType<typeof executeAgenticUniverseSearch>>

const searchDisabled = () => /^(1|true|yes|on)$/i.test(String(process.env.MIRAX_SEARCH_DISABLED || ''))

export async function POST(req: NextRequest) {
  // This route used to bypass the dashboard brake and could still invoke paid
  // semantic/search providers. Keep the global kill switch at the outer boundary.
  if (searchDisabled()) {
    return NextResponse.json(
      { error: 'SEARCH_TEMPORARILY_DISABLED', status: 'disabled' },
      { status: 503, headers: { 'Retry-After': '300' } },
    )
  }
  const auth = await requireUniverseAuth()
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  try {
    const body = await req.json().catch(() => ({}))
    const userQuery = typeof body?.user_query === 'string' ? body.user_query.trim() : ''
    const city = typeof body?.city === 'string' ? body.city.trim() : undefined
    const limit = Math.min(500, Math.max(1, Number(body?.limit) || 50))

    const explicitMode = typeof body?.mode === 'string' ? body.mode.trim() : ''
    const mode: AgenticSearchMode =
      explicitMode === 'worker_agentic' || body?.worker_agentic === true
        ? 'worker_agentic'
        : body?.signal_intent && typeof body.signal_intent === 'object'
          ? 'signal'
          : 'commercial'

    if (mode === 'worker_agentic') {
      if (!userQuery) {
        return NextResponse.json({ error: 'user_query richiesto' }, { status: 400 })
      }
      const t0 = Date.now()
      const authClient = await createClient()
      const userId = auth.userId
      const agenticMax = clampSearchMaxLeads(limit)
      const planningSearchId = await createAgenticPlanningJob(authClient, {
        query: userQuery,
        maxLeads: agenticMax,
        userId,
      })
      let plan: Awaited<ReturnType<typeof buildMiraxQueryPlan>>
      try {
        const costMeter = new PersistentResearchCostGovernor(createServiceRoleClient())
        await costMeter.initialize(planningSearchId, agenticMax)
        plan = await buildMiraxQueryPlan(userQuery, {
          requestedLeadCount: agenticMax,
          searchId: planningSearchId,
          costMeter,
        })
      } catch (error) {
        await cancelAgenticPlanningJob(authClient, planningSearchId, 'planning_failed')
        throw error
      }
      const effectiveCity = city || plan.location || 'Italia'
      const sector = plan.sector || 'Agentic AI'
      const commercialBundle = buildWorkerCommercialIntentBundle(userQuery, plan.canonical_plan ?? null, {
        parse_source: plan.parse_source,
        confidence: plan.confidence,
        intent_summary: plan.intent_summary,
      })

      const job = await requestAgenticWorkerJob(authClient, {
        query: userQuery,
        maxLeads: agenticMax,
        userId,
        location: effectiveCity,
        sector,
        intent: {
          original_query: userQuery,
          query: userQuery,
          search_strategy: plan.search_strategy,
          required_signals: plan.required_signals,
          intent_summary: plan.intent_summary,
          uqe_plan: plan,
          ...(commercialBundle
            ? {
                commercial_intent_spec: commercialBundle.commercial_intent_spec,
                commercial_hypotheses: commercialBundle.commercial_hypotheses,
                intent_compiler_telemetry: commercialBundle.intent_compiler_telemetry,
                commercial_intent_required: true,
              }
            : {}),
        },
        plan: {
          original_query: userQuery,
          search_strategy: plan.search_strategy,
          sector,
          location: effectiveCity,
          required_signals: plan.required_signals,
          technical_filters: plan.technical_filters,
          extraction_schema: plan.extraction_schema,
          intent_summary: plan.intent_summary,
        },
        existingSearchId: planningSearchId,
      })

      return NextResponse.json({
        ok: true,
        mode: 'worker_agentic',
        user_query: userQuery,
        status: 'pending',
        job_id: job.jobId,
        search_id: job.searchId,
        organic_web_search: plan.search_strategy === 'organic_web_search',
        search_strategy: plan.search_strategy,
        intent_summary: plan.intent_summary,
        max_leads: agenticMax,
        elapsed_ms: Date.now() - t0,
        cache_hit: false,
      })
    }

    const t0 = Date.now()

    if (mode === 'commercial' && !userQuery) {
      return NextResponse.json({ error: 'user_query richiesto' }, { status: 400 })
    }
    if (mode === 'signal' && !body?.signal_intent) {
      return NextResponse.json({ error: 'signal_intent richiesto' }, { status: 400 })
    }

    const authClient = await createClient()
    const cacheClient = isUniverseCacheEnabled() ? createServiceRoleClient() : authClient
    const userId = auth.userId

    let commercialIntent: CommercialIntent | undefined
    let signalIntent: SignalIntentSpec | undefined
    let universeQueryIntent: CommercialUniverseQueryIntent | UniverseQueryIntent
    let searchResult: CommercialSearchResult | SignalSearchResult
    let cache_hit = false

    if (mode === 'commercial') {
      // Graph-only mode has no search lifecycle/ledger. Keep it deterministic;
      // all paid intent compilation belongs to worker_agentic after budget init.
      commercialIntent = parseCommercialIntentOffline(userQuery)
      const effectiveCity = city || commercialIntent.target_profile.locations?.[0] || undefined

      const cachePayload = {
        mode,
        commercial_intent: commercialIntentKey(commercialIntent),
        city: effectiveCity,
        limit,
      }

      let commercialResult: CommercialSearchResult | null = null
      if (isUniverseCacheEnabled()) {
        const cacheKey = buildUniverseCacheKey('agentic', cachePayload)
        const hit = await getQueryCache<CommercialSearchResult>(cacheClient, cacheKey)
        if (hit) {
          commercialResult = hit
          cache_hit = true
        }
      }

      if (!commercialResult) {
        commercialResult = await executeCommercialUniverseSearch(authClient, commercialIntent, { limit, userId })
        if (isUniverseCacheEnabled()) {
          const cacheKey = buildUniverseCacheKey('agentic', cachePayload)
          await setQueryCache(cacheClient, cacheKey, 'agentic', commercialResult)
        }
      }

      searchResult = commercialResult
      universeQueryIntent = commercialResult.intent
    } else {
      signalIntent =
        body.signal_intent && typeof body.signal_intent === 'object'
          ? coerceSignalIntent(body.signal_intent)
          : parseSignalIntentOffline(userQuery)
      const effectiveCity = city || signalIntent.location || undefined

      const cachePayload = {
        mode,
        signal_intent: signalIntent,
        city: effectiveCity,
        limit,
      }

      let signalResult: SignalSearchResult | null = null
      if (isUniverseCacheEnabled()) {
        const cacheKey = buildUniverseCacheKey('agentic', cachePayload)
        const hit = await getQueryCache<SignalSearchResult>(cacheClient, cacheKey)
        if (hit) {
          signalResult = hit
          cache_hit = true
        }
      }

      if (!signalResult) {
        signalResult = await executeAgenticUniverseSearch(authClient, signalIntent, {
          city: effectiveCity,
          limit,
        })
        if (isUniverseCacheEnabled()) {
          const cacheKey = buildUniverseCacheKey('agentic', cachePayload)
          await setQueryCache(cacheClient, cacheKey, 'agentic', signalResult)
        }
      }

      searchResult = signalResult
      universeQueryIntent = signalResult.intent
    }

    return NextResponse.json({
      ok: true,
      mode,
      user_query: userQuery || null,
      intent_summary: universeQueryIntent.summary,
      reasoning:
        mode === 'commercial' ? (commercialIntent?.reasoning ?? null) : (signalIntent?.reasoning ?? null),
      confidence: mode === 'commercial' ? (commercialIntent?.confidence ?? null) : null,
      parse_source: universeQueryIntent.parse_source,
      commercial_intent: commercialIntent ?? null,
      signal_intent: signalIntent ?? null,
      universe_query: universeQueryIntent.query,
      total: searchResult.total,
      results: searchResult.results,
      elapsed_ms: Date.now() - t0,
      cache_hit,
    })
  } catch (e: unknown) {
    const { message, status } = universeClientError(e, 'agentic-search')
    return NextResponse.json({ error: message }, { status })
  }
}
