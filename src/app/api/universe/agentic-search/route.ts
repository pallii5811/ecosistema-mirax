/**
 * POST /api/universe/agentic-search
 * Query NL → intent → grafo → risultati compatibili ResultsTable.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/utils/supabase/server'
import { executeAgenticUniverseSearch } from '@/lib/universe'
import { requireUniverseAuth } from '@/lib/universe/require-auth'
import {
  buildUniverseCacheKey,
  getQueryCache,
  isUniverseCacheEnabled,
  setQueryCache,
} from '@/lib/universe/query-cache'
import { parseSignalIntent } from '@/lib/signal-intent/parse-semantic'
import { coerceSignalIntent } from '@/lib/signal-intent/parse-heuristic'
import type { SignalIntentSpec } from '@/lib/signal-intent/types'

export async function POST(req: NextRequest) {
  const auth = await requireUniverseAuth()
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  try {
    const body = await req.json().catch(() => ({}))
    const userQuery = typeof body?.user_query === 'string' ? body.user_query.trim() : ''
    const city = typeof body?.city === 'string' ? body.city.trim() : undefined
    const limit = Math.min(100, Math.max(1, Number(body?.limit) || 50))

    if (!userQuery && !body?.signal_intent) {
      return NextResponse.json({ error: 'user_query o signal_intent richiesto' }, { status: 400 })
    }

    let intent: SignalIntentSpec
    if (body?.signal_intent && typeof body.signal_intent === 'object') {
      intent = coerceSignalIntent(body.signal_intent)
    } else {
      intent = await parseSignalIntent(userQuery)
    }

    const t0 = Date.now()
    const sb = createServiceRoleClient()
    const effectiveCity = city || intent.location || undefined

    type SearchPayload = Awaited<ReturnType<typeof executeAgenticUniverseSearch>>
    let result: SearchPayload | null = null
    let cache_hit = false

    if (isUniverseCacheEnabled()) {
      const cacheKey = buildUniverseCacheKey('agentic', {
        intent,
        city: effectiveCity,
        limit,
      })
      const hit = await getQueryCache<SearchPayload>(sb, cacheKey)
      if (hit) {
        result = hit
        cache_hit = true
      }
    }

    if (!result) {
      result = await executeAgenticUniverseSearch(sb, intent, { city: effectiveCity, limit })
      if (isUniverseCacheEnabled()) {
        const cacheKey = buildUniverseCacheKey('agentic', {
          intent,
          city: effectiveCity,
          limit,
        })
        await setQueryCache(sb, cacheKey, 'agentic', result)
      }
    }

    return NextResponse.json({
      ok: true,
      user_query: userQuery || null,
      intent_summary: result.intent.summary,
      parse_source: result.intent.parse_source,
      signal_intent: intent,
      universe_query: result.intent.query,
      total: result.total,
      results: result.results,
      elapsed_ms: Date.now() - t0,
      cache_hit,
    })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Errore agentic search'
    console.error('[universe/agentic-search] error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
