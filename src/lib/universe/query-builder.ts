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

const DB_PAGE_SIZE = 1_000
const MAX_GRAPH_CANDIDATES = 50_000
const ENTITY_ID_BATCH_SIZE = 150
const MIN_RELATIONSHIP_CONFIDENCE = 0.65

function intersectIds(left: string[], right: string[]): string[] {
  const allowed = new Set(right)
  return left.filter((id) => allowed.has(id))
}

function hasRelationshipTargetConstraints(relFilter: RelationshipFilter): boolean {
  const tf = relFilter.target_filters
  return Boolean(
    relFilter.target_entity_type ||
      tf?.name_contains ||
      tf?.name_contains_any?.length ||
      tf?.observation ||
      tf?.observations?.length,
  )
}

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
    name_contains_any?: string[]
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
    const ids: string[] = []
    for (let from = 0; from < MAX_GRAPH_CANDIDATES; from += DB_PAGE_SIZE) {
      const { data, error } = await sb
        .rpc('universe_observation_text_search', {
          p_attribute: filter.attribute,
          p_pattern: pattern,
        })
        .range(from, from + DB_PAGE_SIZE - 1)
      if (error) throw wrapSupabaseError(error)
      const page = (data ?? []).map((d: { entity_id: string }) => d.entity_id)
      ids.push(...page)
      if (page.length < DB_PAGE_SIZE) break
    }
    return [...new Set(ids)]
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

  const ids: string[] = []
  for (let from = 0; from < MAX_GRAPH_CANDIDATES; from += DB_PAGE_SIZE) {
    const { data, error } = await q.range(from, from + DB_PAGE_SIZE - 1)
    if (error) throw wrapSupabaseError(error)
    const page = (data ?? []).map((d) => d.entity_id)
    ids.push(...page)
    if (page.length < DB_PAGE_SIZE) break
  }
  return [...new Set(ids)]
}

export async function resolveTargetEntityIds(
  sb: SupabaseClient,
  relFilter: RelationshipFilter,
): Promise<string[]> {
  const tf = relFilter.target_filters
  const hasTargetFilters = hasRelationshipTargetConstraints(relFilter)

  if (!hasTargetFilters) {
    // No target constraints — every relationship of this type matches.
    return []
  }

  const aliases = (tf?.name_contains_any ?? []).map((value) => value.trim().toLowerCase()).filter(Boolean)
  const hasEntityConstraints = Boolean(relFilter.target_entity_type || tf?.name_contains || aliases.length)
  let ids: string[] | undefined
  if (hasEntityConstraints) {
    ids = []
    for (let from = 0; from < MAX_GRAPH_CANDIDATES; from += DB_PAGE_SIZE) {
      let targetQ = sb.from('universe_entities').select('id, name')
      if (relFilter.target_entity_type) targetQ = targetQ.eq('entity_type', relFilter.target_entity_type)
      if (tf?.name_contains) targetQ = targetQ.ilike('name', `%${tf.name_contains}%`)
      const { data, error } = await targetQ.range(from, from + DB_PAGE_SIZE - 1)
      if (error) throw wrapSupabaseError(error)
      const page = data ?? []
      ids.push(
        ...page
          .filter((entity) => {
            if (!aliases.length) return true
            const name = String(entity.name ?? '').toLowerCase()
            return aliases.some((alias) => name.includes(alias))
          })
          .map((entity) => entity.id),
      )
      if (page.length < DB_PAGE_SIZE) break
    }
  }

  const obsFilters: ObservationFilter[] = [
    ...(tf?.observations ?? []),
    ...(tf?.observation ? [tf.observation] : []),
  ]

  for (const obs of obsFilters) {
    const obsIds = await fetchEntityIdsByObservation(sb, obs)
    ids = ids ? intersectIds(ids, obsIds) : obsIds
    if (ids.length === 0) break
  }

  return [...new Set(ids ?? [])]
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
    candidateIds = []
    for (let from = 0; from < MAX_GRAPH_CANDIDATES; from += DB_PAGE_SIZE) {
      const { data, error } = await sb
        .from('universe_entities')
        .select('id')
        .eq('entity_type', query.entity_type)
        .ilike('name', `%${query.filters.name_contains}%`)
        .range(from, from + DB_PAGE_SIZE - 1)
      if (error) throw wrapSupabaseError(error)
      const page = data ?? []
      candidateIds.push(...page.map((entity) => entity.id))
      if (page.length < DB_PAGE_SIZE) break
    }
  }

  // Observation filters
  if (query.filters?.observations && query.filters.observations.length > 0) {
    for (const obsFilter of query.filters.observations) {
      const ids = await fetchEntityIdsByObservation(sb, obsFilter)
      candidateIds = candidateIds ? intersectIds(candidateIds, ids) : ids
      if (candidateIds.length === 0) return { entities: [], total: 0 }
    }
  }

  // Step 2: relationship filters
  if (query.relationships && query.relationships.length > 0) {
    for (const relFilter of query.relationships) {
      const sourceCol = relFilter.direction === 'outgoing' ? 'source_entity_id' : 'target_entity_id'
      const targetCol = relFilter.direction === 'outgoing' ? 'target_entity_id' : 'source_entity_id'

      const targetIds = await resolveTargetEntityIds(sb, relFilter)
      if (hasRelationshipTargetConstraints(relFilter) && targetIds.length === 0) {
        return { entities: [], total: 0 }
      }
      const targetBatches: Array<string[] | undefined> = targetIds.length
        ? Array.from({ length: Math.ceil(targetIds.length / ENTITY_ID_BATCH_SIZE) }, (_, index) =>
            targetIds.slice(index * ENTITY_ID_BATCH_SIZE, (index + 1) * ENTITY_ID_BATCH_SIZE),
          )
        : [undefined]
      const relationshipIds = new Set<string>()
      for (const targetBatch of targetBatches) {
        for (let from = 0; from < MAX_GRAPH_CANDIDATES; from += DB_PAGE_SIZE) {
          let relQ = sb
            .from('universe_relationships')
            .select(sourceCol)
            .eq('relationship_type', relFilter.relationship_type)
            .gte('confidence', MIN_RELATIONSHIP_CONFIDENCE)
          if (targetBatch) relQ = relQ.in(targetCol, targetBatch)
          const { data, error } = await relQ.range(from, from + DB_PAGE_SIZE - 1)
          if (error) throw wrapSupabaseError(error)
          const page = data ?? []
          for (const row of page) relationshipIds.add((row as Record<string, string>)[sourceCol])
          if (page.length < DB_PAGE_SIZE) break
        }
      }
      const ids = [...relationshipIds]
      candidateIds = candidateIds ? intersectIds(candidateIds, ids) : ids
      if (candidateIds.length === 0) return { entities: [], total: 0 }
    }
  }

  // Step 3: event filters
  if (query.events && query.events.length > 0) {
    for (const eventFilter of query.events) {
      const eventIds = new Set<string>()
      for (let from = 0; from < MAX_GRAPH_CANDIDATES; from += DB_PAGE_SIZE) {
        let q = sb.from('universe_events').select('entity_id').eq('event_type', eventFilter.event_type)
        if (eventFilter.time_window_days != null && eventFilter.time_window_days > 0) {
          const since = new Date(
            Date.now() - eventFilter.time_window_days * 24 * 60 * 60 * 1000,
          ).toISOString()
          q = q.gte('occurred_at', since)
        }
        const { data, error } = await q.range(from, from + DB_PAGE_SIZE - 1)
        if (error) throw wrapSupabaseError(error)
        const page = data ?? []
        for (const row of page) if (row.entity_id) eventIds.add(row.entity_id)
        if (page.length < DB_PAGE_SIZE) break
      }
      const ids = [...eventIds]
      candidateIds = candidateIds ? intersectIds(candidateIds, ids) : ids
      if (candidateIds.length === 0) return { entities: [], total: 0 }
    }
  }

  // Step 4: fetch full entities. Large candidate sets are chunked to avoid
  // oversized PostgREST URLs (e.g. thousands of entities without Meta Pixel).
  const limit = query.limit ?? 50
  const offset = query.offset ?? 0
  if (candidateIds) {
    const uniqueIds = [...new Set(candidateIds)]
    const batches: string[][] = []
    for (let index = 0; index < uniqueIds.length; index += ENTITY_ID_BATCH_SIZE) {
      batches.push(uniqueIds.slice(index, index + ENTITY_ID_BATCH_SIZE))
    }

    const pages: UniverseEntity[][] = []
    for (let index = 0; index < batches.length; index += 6) {
      const wave = batches.slice(index, index + 6)
      const results = await Promise.all(
        wave.map(async (ids) => {
          let batchQ = sb.from('universe_entities').select('*').eq('entity_type', query.entity_type).in('id', ids)
          if (query.filters?.city) batchQ = batchQ.ilike('city', `%${query.filters.city}%`)
          if (query.filters?.country) batchQ = batchQ.eq('country', query.filters.country)
          const { data, error } = await batchQ
          if (error) throw wrapSupabaseError(error)
          return (data as UniverseEntity[]) ?? []
        }),
      )
      pages.push(...results)
    }

    const entities = pages.flat()
    const orderAttribute = query.orderBy?.attribute ?? 'last_seen_at'
    const direction = query.orderBy?.direction === 'asc' ? 1 : -1
    entities.sort((a, b) => {
      const left = String((a as unknown as Record<string, unknown>)[orderAttribute] ?? '')
      const right = String((b as unknown as Record<string, unknown>)[orderAttribute] ?? '')
      return left.localeCompare(right) * direction
    })
    return {
      entities: entities.slice(offset, offset + limit),
      total: entities.length,
    }
  }

  let entityQ = sb.from('universe_entities').select('*', { count: 'exact' }).eq('entity_type', query.entity_type)

  if (query.filters?.city) entityQ = entityQ.ilike('city', `%${query.filters.city}%`)
  if (query.filters?.country) entityQ = entityQ.eq('country', query.filters.country)
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
