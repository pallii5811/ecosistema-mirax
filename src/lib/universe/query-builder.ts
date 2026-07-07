/**
 * Universe Query Builder.
 *
 * Builds structured queries on the knowledge graph.
 * This is the foundation for Agentic Search.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { EntityType, RelationshipType, UniverseEntity, UniverseEventType } from './types.ts'
import { wrapSupabaseError, UniverseError } from './errors.ts'

export const ALLOWED_OPERATORS = [
  'eq',
  'neq',
  'gt',
  'gte',
  'lt',
  'lte',
  'in',
  'is_null',
  'not_null',
  'contains',
] as const

export type ObservationOperator = (typeof ALLOWED_OPERATORS)[number]

export interface ObservationFilter {
  attribute: string
  operator: ObservationOperator
  value?: unknown
}

export interface RelationshipFilter {
  relationship_type: RelationshipType
  direction: 'outgoing' | 'incoming'
  target_entity_type?: EntityType
  target_filters?: {
    name_contains?: string
    /** @deprecated use observations */
    observation?: ObservationFilter
    observations?: ObservationFilter[]
  }
}

export interface EventFilter {
  event_type: UniverseEventType
  time_window_days?: number | null
}

export interface UniverseQuery {
  entity_type: EntityType
  filters?: {
    city?: string
    country?: string
    name_contains?: string
    observations?: ObservationFilter[]
  }
  relationships?: RelationshipFilter[]
  events?: EventFilter[]
  limit?: number
  offset?: number
  orderBy?: {
    attribute: string
    direction?: 'asc' | 'desc'
  }
}

export const VALID_RELATIONSHIP_TYPES = new Set([
  'owns','uses','hires','has','receives','buys','competes_with','located_in',
  'related_to','mentioned_in','supplies','supplied_by','sells_to','buys_from',
  'partner_of','invested_in','received_investment_from','awarded_to',
  'awarded_by','customer_of','has_customer','competed_for',
])

function isValidOperator(op: string): op is ObservationOperator {
  return (ALLOWED_OPERATORS as readonly string[]).includes(op)
}

function observationFilterToSql(
  filter: ObservationFilter,
): { column: string; value: unknown } | null {
  switch (filter.operator) {
    case 'eq':
    case 'neq':
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte':
    case 'in':
    case 'contains':
      return { column: 'value', value: filter.value }
    case 'is_null':
    case 'not_null':
      return { column: 'value', value: null }
    default:
      return null
  }
}

const OP_TO_SUPABASE: Record<
  Exclude<ObservationOperator, 'is_null' | 'not_null' | 'contains'>,
  'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'in'
> = {
  eq: 'eq',
  neq: 'neq',
  gt: 'gt',
  gte: 'gte',
  lt: 'lt',
  lte: 'lte',
  in: 'in',
}

export async function fetchEntityIdsByObservation(
  sb: SupabaseClient,
  filter: ObservationFilter,
): Promise<string[]> {
  if (!isValidOperator(filter.operator)) {
    throw new UniverseError('INVALID_OPERATOR', `Unknown observation operator: ${filter.operator}`)
  }

  let q = sb.from('universe_observations').select('entity_id').eq('attribute', filter.attribute)

  if (filter.operator === 'contains') {
    const pattern = typeof filter.value === 'string' ? `%${filter.value}%` : `%${String(filter.value)}%`
    // universe_observations.value is jsonb; use server-side cast via RPC.
    const { data, error } = await sb.rpc('universe_observation_text_search', {
      p_attribute: filter.attribute,
      p_pattern: pattern,
    })
    if (error) throw wrapSupabaseError(error)
    return (data ?? []).map((d: { entity_id: string }) => d.entity_id)
  } else if (filter.operator === 'is_null') {
    q = q.filter('value', 'is', null)
  } else if (filter.operator === 'not_null') {
    q = q.filter('value', 'not.is', null)
  } else {
    const mapped = observationFilterToSql(filter)
    if (mapped) {
      q = q.filter('value', OP_TO_SUPABASE[filter.operator], mapped.value)
    }
  }

  const { data, error } = await q
  if (error) throw wrapSupabaseError(error)
  return (data ?? []).map((d) => d.entity_id)
}

export async function resolveTargetEntityIds(
  sb: SupabaseClient,
  relFilter: RelationshipFilter,
): Promise<string[]> {
  const tf = relFilter.target_filters
  const hasTargetFilters =
    relFilter.target_entity_type || tf?.name_contains || tf?.observation || tf?.observations?.length

  if (!hasTargetFilters) {
    // No target constraints — every relationship of this type matches.
    return []
  }

  let targetQ = sb.from('universe_entities').select('id')
  if (relFilter.target_entity_type) {
    targetQ = targetQ.eq('entity_type', relFilter.target_entity_type)
  }
  if (tf?.name_contains) {
    targetQ = targetQ.ilike('name', `%${tf.name_contains}%`)
  }

  const { data, error } = await targetQ
  if (error) throw wrapSupabaseError(error)
  let ids = (data ?? []).map((d) => d.id)

  const obsFilters: ObservationFilter[] = [
    ...(tf?.observations ?? []),
    ...(tf?.observation ? [tf.observation] : []),
  ]

  for (const obs of obsFilters) {
    const obsIds = await fetchEntityIdsByObservation(sb, obs)
    ids = ids.filter((id) => obsIds.includes(id))
    if (ids.length === 0) break
  }

  return ids
}

export async function executeUniverseQuery(
  sb: SupabaseClient,
  query: UniverseQuery,
): Promise<{ entities: UniverseEntity[]; total: number }> {
  // Validate observation operators up-front.
  const allObservations: ObservationFilter[] = [
    ...(query.filters?.observations ?? []),
    ...(query.relationships?.flatMap((r) => [
      ...(r.target_filters?.observations ?? []),
      ...(r.target_filters?.observation ? [r.target_filters.observation] : []),
    ]) ?? []),
  ]
  for (const obs of allObservations) {
    if (!isValidOperator(obs.operator)) {
      throw new UniverseError('INVALID_OPERATOR', `Unknown observation operator: ${obs.operator}`)
    }
  }

  // Step 1: find candidate entity IDs from base filters
  let candidateIds: string[] | undefined

  // Name search
  if (query.filters?.name_contains) {
    const { data, error } = await sb
      .from('universe_entities')
      .select('id')
      .eq('entity_type', query.entity_type)
      .ilike('name', `%${query.filters.name_contains}%`)
    if (error) throw wrapSupabaseError(error)
    candidateIds = (data ?? []).map((d) => d.id)
  }

  // Observation filters
  if (query.filters?.observations && query.filters.observations.length > 0) {
    for (const obsFilter of query.filters.observations) {
      const ids = await fetchEntityIdsByObservation(sb, obsFilter)
      candidateIds = candidateIds ? candidateIds.filter((id) => ids.includes(id)) : ids
      if (candidateIds.length === 0) return { entities: [], total: 0 }
    }
  }

  // Step 2: relationship filters
  if (query.relationships && query.relationships.length > 0) {
    for (const relFilter of query.relationships) {
      const sourceCol = relFilter.direction === 'outgoing' ? 'source_entity_id' : 'target_entity_id'
      const targetCol = relFilter.direction === 'outgoing' ? 'target_entity_id' : 'source_entity_id'

      let relQ = sb
        .from('universe_relationships')
        .select(sourceCol)
        .eq('relationship_type', relFilter.relationship_type)

      const targetIds = await resolveTargetEntityIds(sb, relFilter)
      if (targetIds.length > 0) {
        relQ = relQ.in(targetCol, targetIds)
      }

      const { data, error } = await relQ
      if (error) throw wrapSupabaseError(error)
      const ids = (data ?? []).map((d) => (d as Record<string, string>)[sourceCol])
      candidateIds = candidateIds ? candidateIds.filter((id) => ids.includes(id)) : ids
      if (candidateIds.length === 0) return { entities: [], total: 0 }
    }
  }

  // Step 3: event filters
  if (query.events && query.events.length > 0) {
    for (const eventFilter of query.events) {
      let q = sb.from('universe_events').select('entity_id').eq('event_type', eventFilter.event_type)

      if (eventFilter.time_window_days != null && eventFilter.time_window_days > 0) {
        const since = new Date(
          Date.now() - eventFilter.time_window_days * 24 * 60 * 60 * 1000,
        ).toISOString()
        q = q.gte('occurred_at', since)
      }

      const { data, error } = await q
      if (error) throw wrapSupabaseError(error)
      const ids = (data ?? []).map((d) => d.entity_id).filter((id): id is string => Boolean(id))
      candidateIds = candidateIds ? candidateIds.filter((id) => ids.includes(id)) : ids
      if (candidateIds.length === 0) return { entities: [], total: 0 }
    }
  }

  // Step 4: fetch full entities
  let entityQ = sb.from('universe_entities').select('*', { count: 'exact' }).eq('entity_type', query.entity_type)

  if (query.filters?.city) entityQ = entityQ.ilike('city', `%${query.filters.city}%`)
  if (query.filters?.country) entityQ = entityQ.eq('country', query.filters.country)
  if (candidateIds) entityQ = entityQ.in('id', candidateIds)

  const limit = query.limit ?? 50
  const offset = query.offset ?? 0

  const { data, error, count } = await entityQ
    .order(query.orderBy?.attribute ?? 'last_seen_at', {
      ascending: query.orderBy?.direction === 'asc',
    })
    .range(offset, offset + limit - 1)

  if (error) throw wrapSupabaseError(error)

  return {
    entities: (data as UniverseEntity[]) ?? [],
    total: count ?? 0,
  }
}

export function buildNoPixelRomaQuery(): UniverseQuery {
  return {
    entity_type: 'company',
    filters: {
      city: 'Roma',
      observations: [{ attribute: 'meta_pixel', operator: 'eq', value: false }],
    },
    limit: 50,
  }
}

export function buildHiringMilanoQuery(role?: string): UniverseQuery {
  return {
    entity_type: 'company',
    filters: {
      city: 'Milano',
    },
    relationships: [
      {
        relationship_type: 'hires',
        direction: 'outgoing',
        target_entity_type: 'job',
        target_filters: role ? { name_contains: role } : undefined,
      },
    ],
    limit: 50,
  }
}
