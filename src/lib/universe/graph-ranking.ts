/**
 * Fase 10 — Graph ranking (rule-based relevance 0–100 per Agentic Search).
 * ponytail: euristica interpretabile; upgrade path = ML re-ranker su feature store.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { SignalIntentSpec } from '@/lib/signal-intent/types'
import type { UniverseEntity } from './types.ts'

export type GraphRankFactors = {
  freshness: number
  intent_location: number
  intent_category: number
  recent_events: number
  relationships: number
  observations: number
  confidence: number
}

export type GraphRankResult = {
  score: number
  factors: GraphRankFactors
}

function daysSince(iso: string | null | undefined): number | null {
  if (!iso) return null
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return null
  return (Date.now() - t) / 86_400_000
}

export function computeGraphRankScore(factors: GraphRankFactors): number {
  let score = 35
  score += factors.freshness
  score += factors.intent_location
  score += factors.intent_category
  score += Math.min(20, factors.recent_events * 4)
  score += Math.min(12, factors.relationships * 2)
  score += Math.min(10, Math.floor(factors.observations / 2))
  score += factors.confidence
  return Math.min(100, Math.round(score))
}

export function buildGraphRankFactors(
  entity: UniverseEntity,
  intent: SignalIntentSpec,
  counts: { recent_events: number; relationships: number; observations: number },
): GraphRankFactors {
  const days = daysSince(entity.last_seen_at ?? entity.updated_at)
  let freshness = 0
  if (days != null) {
    if (days <= 7) freshness = 12
    else if (days <= 30) freshness = 8
    else if (days <= 90) freshness = 4
  }

  const loc = (intent.location ?? '').trim().toLowerCase()
  const city = (entity.city ?? '').trim().toLowerCase()
  const intent_location = loc && city && (city.includes(loc) || loc.includes(city)) ? 10 : 0

  const cat = (intent.category ?? '').trim().toLowerCase()
  const metaCat = String(entity.metadata?.category ?? '').toLowerCase()
  const name = entity.name.toLowerCase()
  const intent_category =
    cat && (name.includes(cat) || metaCat.includes(cat) || cat.split(/\s+/).some((w) => name.includes(w)))
      ? 8
      : 0

  const conf = typeof entity.confidence === 'number' ? Math.round(entity.confidence * 5) : 0

  return {
    freshness,
    intent_location,
    intent_category,
    recent_events: counts.recent_events,
    relationships: counts.relationships,
    observations: counts.observations,
    confidence: conf,
  }
}

async function batchEntityCounts(
  sb: SupabaseClient,
  entityIds: string[],
): Promise<Map<string, { recent_events: number; relationships: number; observations: number }>> {
  const out = new Map<string, { recent_events: number; relationships: number; observations: number }>()
  if (!entityIds.length) return out

  const since = new Date(Date.now() - 30 * 86_400_000).toISOString()

  const [evRes, relRes, obsRes] = await Promise.all([
    sb.from('universe_events').select('entity_id').in('entity_id', entityIds).gte('occurred_at', since),
    sb.from('universe_relationships').select('source_entity_id').in('source_entity_id', entityIds),
    sb.from('universe_observations').select('entity_id').in('entity_id', entityIds),
  ])

  for (const id of entityIds) {
    out.set(id, { recent_events: 0, relationships: 0, observations: 0 })
  }

  for (const row of evRes.data ?? []) {
    const id = row.entity_id as string
    const cur = out.get(id)
    if (cur) cur.recent_events++
  }
  for (const row of relRes.data ?? []) {
    const id = row.source_entity_id as string
    const cur = out.get(id)
    if (cur) cur.relationships++
  }
  for (const row of obsRes.data ?? []) {
    const id = row.entity_id as string
    const cur = out.get(id)
    if (cur) cur.observations++
  }

  return out
}

/** Ordina entità per graph score decrescente (Agentic Search). */
export async function rankUniverseEntities(
  sb: SupabaseClient,
  entities: UniverseEntity[],
  intent: SignalIntentSpec,
): Promise<Array<{ entity: UniverseEntity; graph_score: number; graph_rank_factors: GraphRankFactors }>> {
  if (!entities.length) return []

  const counts = await batchEntityCounts(
    sb,
    entities.map((e) => e.id),
  )

  const ranked = entities.map((entity) => {
    const c = counts.get(entity.id) ?? { recent_events: 0, relationships: 0, observations: 0 }
    const factors = buildGraphRankFactors(entity, intent, c)
    return {
      entity,
      graph_score: computeGraphRankScore(factors),
      graph_rank_factors: factors,
    }
  })

  ranked.sort((a, b) => b.graph_score - a.graph_score)
  return ranked
}
