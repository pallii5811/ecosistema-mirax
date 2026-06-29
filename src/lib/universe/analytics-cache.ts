/**
 * Fase 9 — Analytics con cache DB (multi-instance safe).
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { getUniverseAnalytics, type UniverseAnalyticsSummary } from './analytics.ts'
import {
  buildUniverseCacheKey,
  getQueryCache,
  isUniverseCacheEnabled,
  setQueryCache,
} from './query-cache.ts'

export async function getUniverseAnalyticsCached(
  sb: SupabaseClient,
  days = 30,
): Promise<{ analytics: UniverseAnalyticsSummary; cache_hit: boolean }> {
  if (!isUniverseCacheEnabled()) {
    const analytics = await getUniverseAnalytics(sb, days)
    return { analytics, cache_hit: false }
  }

  const cacheKey = buildUniverseCacheKey('analytics', { days })
  const hit = await getQueryCache<UniverseAnalyticsSummary>(sb, cacheKey)
  if (hit) return { analytics: hit, cache_hit: true }

  const analytics = await getUniverseAnalytics(sb, days)
  await setQueryCache(sb, cacheKey, 'analytics', analytics)
  return { analytics, cache_hit: false }
}
