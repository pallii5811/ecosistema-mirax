/**
 * GET /api/universe/analytics
 * Fase 8 — metriche aggregate Knowledge Graph.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/utils/supabase/server'
import { requireUniverseAuth } from '@/lib/universe/require-auth'
import { getUniverseAnalyticsCached } from '@/lib/universe/analytics-cache'
import { isUniverseEnabled } from '@/lib/universe/sidecar'
import { isUniverseReadEnabled } from '@/lib/universe/hydrate-leads'
import { isUniverseCacheEnabled } from '@/lib/universe/query-cache'
import { universeClientError } from '@/lib/universe/errors'

export async function GET(req: NextRequest) {
  const auth = await requireUniverseAuth()
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  try {
    const days = Math.min(90, Math.max(7, Number(req.nextUrl.searchParams.get('days')) || 30))
    const authClient = await createClient()
    const cacheClient = isUniverseCacheEnabled() ? createServiceRoleClient() : authClient
    const { analytics, cache_hit } = await getUniverseAnalyticsCached(authClient, days, cacheClient)

    return NextResponse.json({
      ok: true,
      days,
      analytics,
      cache_hit,
      cache_enabled: isUniverseCacheEnabled(),
      universe_enabled: isUniverseEnabled(),
      universe_read_enabled: isUniverseReadEnabled(),
    })
  } catch (e: unknown) {
    const { message, status } = universeClientError(e, 'analytics')
    return NextResponse.json({ error: message }, { status })
  }
}
