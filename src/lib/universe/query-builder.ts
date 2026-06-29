/**
 * Universe Query Builder.
 *
 * Builds structured queries on the knowledge graph.
 * This is the foundation for Agentic Search.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { EntityType, RelationshipType, UniverseEntity } from './types.ts'
import { wrapSupabaseError } from './errors.ts'

export interface ObservationFilter {
  attribute: string
  operator: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'is_null' | 'is_not_null'
  value?: unknown
}

export interface RelationshipFilter {
  relationship_type: RelationshipType
  direction: 'outgoing' | 'incoming'
  target_entity_type?: EntityType
  target_filters?: {
    name_contains?: string
    observation?: ObservationFilter
  }
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
  limit?: number
  offset?: number
  orderBy?: {
    attribute: string
    direction?: 'asc' | 'desc'
  }
}

function observationFilterToSql(filter: ObservationFilter): { column: string; value: unknown } | null {
  switch (filter.operator) {
    case 'eq':
    case 'neq':
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte':
      return { column: 'value', value: filter.value }
    case 'in':
      return { column: 'value', value: filter.value }
    case 'is_null':
      return { column: 'value', value: null }
    case 'is_not_null':
      return { column: 'value', value: null }
    default:
      return null
  }
}

export async function executeUniverseQuery(
  sb: SupabaseClient,
  query: UniverseQuery
): Promise<{ entities: UniverseEntity[]; total: number }> {
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
      const opMap: Record<string, string> = {
        eq: 'eq',
        neq: 'neq',
        gt: 'gt',
        gte: 'gte',
        lt: 'lt',
        lte: 'lte',
        in: 'in',
        is_null: 'is',
        is_not_null: 'not.is',
      }

      let q = sb
        .from('universe_observations')
        .select('entity_id')
        .eq('attribute', obsFilter.attribute)

      const mapped = observationFilterToSql(obsFilter)
      if (mapped) {
        const op = opMap[obsFilter.operator]
        if (obsFilter.operator === 'is_null') {
          q = q.filter('value', 'is', null)
        } else if (obsFilter.operator === 'is_not_null') {
          q = q.filter('value', 'not.is', null)
        } else {
          q = q.filter('value', op as 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'in', mapped.value)
        }
      }

      const { data, error } = await q
      if (error) throw wrapSupabaseError(error)
      const ids = (data ?? []).map((d) => d.entity_id)
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

      if (relFilter.target_entity_type) {
        // Join via subquery: target entities must match type
        const { data: targetEntities, error: targetError } = await sb
          .from('universe_entities')
          .select('id')
          .eq('entity_type', relFilter.target_entity_type)
        if (targetError) throw wrapSupabaseError(targetError)
        const targetIds = (targetEntities ?? []).map((e) => e.id)
        relQ = relQ.in(targetCol, targetIds)
      }

      const { data, error } = await relQ
      if (error) throw wrapSupabaseError(error)
      const ids = (data ?? []).map((d) => (d as Record<string, string>)[sourceCol])
      candidateIds = candidateIds ? candidateIds.filter((id) => ids.includes(id)) : ids
      if (candidateIds.length === 0) return { entities: [], total: 0 }
    }
  }

  // Step 3: fetch full entities
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
