/**
 * Quality Monitoring — Fase 7 Knowledge Graph.
 *
 * Tracks coverage, freshness, and signal quality so the team knows
 * when the graph is improving and where to invest enrichment.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { getUserFeedbackProfile, type FeedbackRecord } from './feedback.ts'

export type UniverseQualityMetrics = {
  entities: number
  observations: number
  relationships: number
  events: number
  entity_types: Record<string, number>
  relationship_types: Record<string, number>
  event_types: Record<string, number>
  top_sources: Record<string, number>
  freshness_days: {
    avg_last_seen: number | null
    median_last_seen: number | null
    stale_count: number
  }
}

export type SearchQualityMetrics = {
  total_feedback: number
  positive_rate: number
  negative_rate: number
  top10_positive_rate: number | null
  closed_won_rate: number
  average_opportunity_score?: number | null
}

function daysSince(iso: string | null | undefined): number | null {
  if (!iso) return null
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return null
  return (Date.now() - t) / 86_400_000
}

export async function getUniverseQualityMetrics(sb: SupabaseClient): Promise<UniverseQualityMetrics> {
  const [
    entityCount,
    observationCount,
    relationshipCount,
    eventCount,
    entityTypeRes,
    relationshipTypeRes,
    eventTypeRes,
    sourceRes,
    lastSeenRes,
  ] = await Promise.all([
    sb.from('universe_entities').select('*', { count: 'exact', head: true }),
    sb.from('universe_observations').select('*', { count: 'exact', head: true }),
    sb.from('universe_relationships').select('*', { count: 'exact', head: true }),
    sb.from('universe_events').select('*', { count: 'exact', head: true }),
    sb.from('universe_entities').select('entity_type'),
    sb.from('universe_relationships').select('relationship_type'),
    sb.from('universe_events').select('event_type'),
    sb.from('universe_observations').select('source'),
    sb.from('universe_entities').select('last_seen_at'),
  ])

  const count = (res: { count?: number | null }) => res.count ?? 0

  const distribution = (rows: unknown[] | null, key: string) => {
    const out: Record<string, number> = {}
    for (const row of (rows ?? []) as Record<string, unknown>[]) {
      const val = String(row[key] ?? 'unknown')
      out[val] = (out[val] ?? 0) + 1
    }
    return out
  }

  const lastSeenDays = ((lastSeenRes.data ?? []) as { last_seen_at: string | null }[])
    .map((r) => daysSince(r.last_seen_at))
    .filter((d): d is number => d != null)
    .sort((a, b) => a - b)

  const avgLastSeen = lastSeenDays.length
    ? Math.round(lastSeenDays.reduce((a, b) => a + b, 0) / lastSeenDays.length)
    : null
  const medianLastSeen = lastSeenDays.length
    ? Math.round(lastSeenDays[Math.floor(lastSeenDays.length / 2)])
    : null
  const staleCount = lastSeenDays.filter((d) => d > 90).length

  return {
    entities: count(entityCount),
    observations: count(observationCount),
    relationships: count(relationshipCount),
    events: count(eventCount),
    entity_types: distribution(entityTypeRes.data, 'entity_type'),
    relationship_types: distribution(relationshipTypeRes.data, 'relationship_type'),
    event_types: distribution(eventTypeRes.data, 'event_type'),
    top_sources: distribution(sourceRes.data, 'source'),
    freshness_days: {
      avg_last_seen: avgLastSeen,
      median_last_seen: medianLastSeen,
      stale_count: staleCount,
    },
  }
}

export async function getSearchQualityMetrics(
  sb: SupabaseClient,
  userId?: string,
): Promise<SearchQualityMetrics> {
  let q = sb.from('universe_feedback').select('action, feedback_value')
  if (userId) q = q.eq('user_id', userId)

  const { data, error } = await q
  if (error) throw error

  const rows = (data ?? []) as Pick<FeedbackRecord, 'action' | 'feedback_value'>[]
  const total = rows.length
  if (!total) {
    return {
      total_feedback: 0,
      positive_rate: 0,
      negative_rate: 0,
      top10_positive_rate: null,
      closed_won_rate: 0,
    }
  }

  const positive = rows.filter((r) => (r.feedback_value ?? 0) > 0).length
  const negative = rows.filter((r) => (r.feedback_value ?? 0) < 0).length
  const closedWon = rows.filter((r) => r.action === 'closed_won').length

  return {
    total_feedback: total,
    positive_rate: Math.round((positive / total) * 100),
    negative_rate: Math.round((negative / total) * 100),
    top10_positive_rate: null, // requires search position data
    closed_won_rate: Math.round((closedWon / total) * 100),
  }
}

export async function getUserLearningMetrics(sb: SupabaseClient, userId: string) {
  const profile = await getUserFeedbackProfile(sb, userId)
  return {
    positive_leads: profile.positive_entity_ids.length,
    negative_leads: profile.negative_entity_ids.length,
    top_actions: profile.top_actions,
    recent_queries: profile.recent_queries.length,
  }
}
