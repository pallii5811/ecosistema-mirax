/**
 * Fase 8 — Analytics aggregate sul Knowledge Graph.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { wrapSupabaseError } from './errors.ts'

export type UniverseAnalyticsSummary = {
  companies: number
  observations: number
  relationships: number
  events_total: number
  events_unprocessed: number
  events_last_7d: number
  events_by_type: Record<string, number>
  top_cities: Array<{ city: string; count: number }>
  observations_by_source: Record<string, number>
  generated_at?: string
}

const EMPTY: UniverseAnalyticsSummary = {
  companies: 0,
  observations: 0,
  relationships: 0,
  events_total: 0,
  events_unprocessed: 0,
  events_last_7d: 0,
  events_by_type: {},
  top_cities: [],
  observations_by_source: {},
}

function parseSummary(raw: unknown): UniverseAnalyticsSummary {
  if (!raw || typeof raw !== 'object') return EMPTY
  const o = raw as Record<string, unknown>
  return {
    companies: Number(o.companies) || 0,
    observations: Number(o.observations) || 0,
    relationships: Number(o.relationships) || 0,
    events_total: Number(o.events_total) || 0,
    events_unprocessed: Number(o.events_unprocessed) || 0,
    events_last_7d: Number(o.events_last_7d) || 0,
    events_by_type: (o.events_by_type as Record<string, number>) ?? {},
    top_cities: Array.isArray(o.top_cities)
      ? (o.top_cities as Array<{ city: string; count: number }>)
      : [],
    observations_by_source: (o.observations_by_source as Record<string, number>) ?? {},
    generated_at: typeof o.generated_at === 'string' ? o.generated_at : undefined,
  }
}

/** RPC universe_analytics_summary con fallback query leggero. */
export async function getUniverseAnalytics(
  sb: SupabaseClient,
  days = 30,
): Promise<UniverseAnalyticsSummary> {
  const { data, error } = await sb.rpc('universe_analytics_summary', { p_days: days })
  if (!error && data) return parseSummary(data)

  // Fallback se migration non ancora applicata
  const [c1, c2, c3, c4] = await Promise.all([
    sb
      .from('universe_entities')
      .select('*', { count: 'exact', head: true })
      .eq('entity_type', 'company')
      .is('merged_into_id', null),
    sb.from('universe_observations').select('*', { count: 'exact', head: true }),
    sb.from('universe_relationships').select('*', { count: 'exact', head: true }),
    sb.from('universe_events').select('*', { count: 'exact', head: true }),
  ])

  if (c1.error) throw wrapSupabaseError(c1.error)

  return {
    ...EMPTY,
    companies: c1.count ?? 0,
    observations: c2.count ?? 0,
    relationships: c3.count ?? 0,
    events_total: c4.count ?? 0,
    generated_at: new Date().toISOString(),
  }
}
