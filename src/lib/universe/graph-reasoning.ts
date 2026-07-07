/**
 * Graph Reasoning Engine — multi-hop traversal for Agentic Search.
 *
 * Turns a CommercialIntent into a multi-hop query plan, executes it on the
 * knowledge graph, and scores the resulting entities using path evidence.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  CommercialIntent,
  CommercialGraphConstraint,
} from '@/lib/signal-intent/commercial-intent'
import type { EntityType, RelationshipType, UniverseEntity, UniverseRelationship } from './types.ts'
import { wrapSupabaseError, UniverseError } from './errors.ts'
import { resolveTargetEntityIds, type ObservationFilter, VALID_RELATIONSHIP_TYPES } from './query-builder.ts'

export { VALID_RELATIONSHIP_TYPES }

export interface GraphHopTargetFilters {
  entity_type?: EntityType
  name_contains?: string
  industry?: string
  location?: string
  observations?: ObservationFilter[]
}

export interface GraphHop {
  /** Type of the entities reached at this hop. */
  entity_type: EntityType
  relationship_type: RelationshipType
  direction: 'outgoing' | 'incoming' | 'any'
  /** Filters on the relationship target (the fixed side of the edge). */
  target_filters: GraphHopTargetFilters
}

export interface GraphQueryPlan {
  /** Optional filters on the starting entity set. When present, the final
   *  results are the starting entities that satisfy the full hop chain. */
  source_filters?: {
    entity_type: EntityType
    city?: string
    country?: string
    observations?: ObservationFilter[]
  }
  hops: GraphHop[]
  /** Human-readable description of the plan. */
  summary: string
}

export interface HopEvidence {
  hop_index: number
  relationship_type: RelationshipType
  direction: 'outgoing' | 'incoming'
  from_entity_id: string
  from_entity_name: string
  to_entity_id: string
  to_entity_name: string
  confidence: number
  observed_at: string
}

export interface GraphReasoningResult {
  entity: UniverseEntity
  path_evidence: HopEvidence[]
  subgraph_score: number
}

// ------------------------------------------------------------------
// Plan builder
// ------------------------------------------------------------------

const RELATIONSHIP_SYNONYMS: Array<{
  keywords: RegExp
  relationship_type: RelationshipType
  default_direction: GraphHop['direction']
}> = [
  {
    // Companies that sell *to* the source: the source buys from them.
    keywords: /\b(fornisce(?:re)?|fornitori|fornitore|che fornisce|che forniscono|vende(?:re)? a)\b/i,
    relationship_type: 'sells_to',
    default_direction: 'incoming',
  },
  {
    // Companies that buy *from* the source: the source has them as customers.
    keywords: /\b(clienti?|acquista|compra|che acquista|che compra|chi compra)\b/i,
    relationship_type: 'has_customer',
    default_direction: 'outgoing',
  },
  {
    keywords: /\b(competitor|concorrenti|concorrente)\b/i,
    relationship_type: 'competes_with',
    default_direction: 'any',
  },
  {
    keywords: /\b(partner|collabora|collaborazione)\b/i,
    relationship_type: 'partner_of',
    default_direction: 'any',
  },
  {
    keywords: /\b(investe|investito_in|investimenti)\b/i,
    relationship_type: 'invested_in',
    default_direction: 'outgoing',
  },
  {
    keywords: /\b(investitori?|finanziatori|backer|chi ha investito in)\b/i,
    relationship_type: 'received_investment_from',
    default_direction: 'outgoing',
  },
  {
    keywords: /\b(dipendenti?|personale|team|dirigenti?|executive|ceo|cto|manager)\b/i,
    relationship_type: 'has',
    default_direction: 'outgoing',
  },
]

function normalizeRelationshipType(raw: string): RelationshipType | null {
  const key = raw.trim().toLowerCase()
  if (VALID_RELATIONSHIP_TYPES.has(key)) return key as RelationshipType
  return null
}

function normalizeDirection(raw: string): GraphHop['direction'] {
  if (raw === 'incoming' || raw === 'outgoing') return raw
  return 'any'
}

function pickEntityType(intent: CommercialIntent): EntityType {
  const types = intent.target_profile.entity_types ?? []
  return types.includes('person') ? 'person' : 'company'
}

function buildSourceFilters(
  intent: CommercialIntent,
): GraphQueryPlan['source_filters'] | undefined {
  const tp = intent.target_profile
  const locations = (tp.locations ?? []).filter(Boolean)
  const industries = (tp.industries ?? []).filter(Boolean)

  const observations: ObservationFilter[] = []

  if (locations.length > 1) {
    observations.push({ attribute: 'city', operator: 'in', value: locations })
  }

  const size = tp.company_size
  if (size) {
    if (size.min_employees != null) observations.push({ attribute: 'employees', operator: 'gte', value: size.min_employees })
    if (size.max_employees != null) observations.push({ attribute: 'employees', operator: 'lte', value: size.max_employees })
    if (size.revenue_min != null) observations.push({ attribute: 'revenue', operator: 'gte', value: size.revenue_min })
    if (size.revenue_max != null) observations.push({ attribute: 'revenue', operator: 'lte', value: size.revenue_max })
  }

  const hasBaseFilters =
    locations.length === 1 || observations.length > 0 || tp.entity_types?.length

  if (!hasBaseFilters) return undefined

  return {
    entity_type: pickEntityType(intent),
    city: locations.length === 1 ? locations[0] : undefined,
    observations: observations.length ? observations : undefined,
  }
}

function constraintToHop(c: CommercialGraphConstraint): GraphHop | null {
  const rel = normalizeRelationshipType(c.relationship_type)
  if (!rel) return null

  const observations: ObservationFilter[] = []
  if (c.target_filter?.industry) {
    observations.push({ attribute: 'category', operator: 'contains', value: c.target_filter.industry })
  }
  if (c.target_filter?.location) {
    observations.push({ attribute: 'city', operator: 'contains', value: c.target_filter.location })
  }

  return {
    entity_type: (c.target_filter?.entity_type as EntityType) ?? 'company',
    relationship_type: rel,
    direction: normalizeDirection(c.direction),
    target_filters: {
      entity_type: c.target_filter?.entity_type as EntityType | undefined,
      industry: c.target_filter?.industry,
      location: c.target_filter?.location,
      observations: observations.length ? observations : undefined,
    },
  }
}

function extractNamedTarget(query: string): string | null {
  // "fornitori di X", "clienti di Y", "competitor di Z"
  const match = query.match(/(?:di|dei|degli|delle)\s+['"]?([^'".,;]{2,60})['"]?/i)
  return match ? match[1].trim() : null
}

function parseMultiHopHeuristic(lower: string): GraphHop[] | null {
  // "competitor dei clienti di X"
  const m1 = lower.match(/\bcompetitor\s+(?:dei|degli|delle|di)\s+clienti\s+(?:di|dei|degli|delle)\s+['"]?([^'".,;]{2,60})['"]?/i)
  if (m1) {
    return [
      {
        entity_type: 'company',
        relationship_type: 'has_customer',
        direction: 'outgoing',
        target_filters: { entity_type: 'company', name_contains: m1[1].trim() },
      },
      {
        entity_type: 'company',
        relationship_type: 'competes_with',
        direction: 'any',
        target_filters: {},
      },
    ]
  }

  // "competitor dei fornitori di X"
  const m2 = lower.match(/\bcompetitor\s+(?:dei|degli|delle|di)\s+fornitori\s+(?:di|dei|degli|delle)\s+['"]?([^'".,;]{2,60})['"]?/i)
  if (m2) {
    return [
      {
        entity_type: 'company',
        relationship_type: 'sells_to',
        direction: 'incoming',
        target_filters: { entity_type: 'company', name_contains: m2[1].trim() },
      },
      {
        entity_type: 'company',
        relationship_type: 'competes_with',
        direction: 'any',
        target_filters: {},
      },
    ]
  }

  // "fornitori dei clienti di X"
  const m3 = lower.match(/\bfornitori\s+(?:dei|degli|delle|di)\s+clienti\s+(?:di|dei|degli|delle)\s+['"]?([^'".,;]{2,60})['"]?/i)
  if (m3) {
    return [
      {
        entity_type: 'company',
        relationship_type: 'has_customer',
        direction: 'outgoing',
        target_filters: { entity_type: 'company', name_contains: m3[1].trim() },
      },
      {
        entity_type: 'company',
        relationship_type: 'sells_to',
        direction: 'incoming',
        target_filters: {},
      },
    ]
  }

  return null
}

function inferHopsFromQuery(query: string): GraphHop[] {
  const lower = query.toLowerCase()
  const hops: GraphHop[] = []
  const namedTarget = extractNamedTarget(query)

  // Multi-hop heuristics
  const multiHop = parseMultiHopHeuristic(lower)
  if (multiHop) return multiHop

  // Single named-target patterns: "fornitori di X", "clienti di Y"
  for (const syn of RELATIONSHIP_SYNONYMS) {
    if (syn.keywords.test(lower)) {
      const isSupplierLike = syn.relationship_type === 'sells_to'
      const isCustomerLike = syn.relationship_type === 'has_customer'

      if (namedTarget) {
        // "fornitori di X" -> X buys from returned suppliers (sells_to X).
        // "clienti di Y" -> Y has returned entities as customers (has_customer Y).
        // "competitor di Z" -> Z competes_with returned entities.
        // "partner di W" -> W partner_of returned entities.
        return [
          {
            entity_type: 'company',
            relationship_type: syn.relationship_type,
            direction: isSupplierLike ? 'incoming' : syn.default_direction,
            target_filters: { entity_type: 'company', name_contains: namedTarget },
          },
        ]
      }

      hops.push({
        entity_type: 'company',
        relationship_type: syn.relationship_type,
        direction: syn.default_direction,
        target_filters: {},
      })
      break
    }
  }

  return hops
}

function mergeTargetIndustryIntoHops(
  sourceFilters: GraphQueryPlan['source_filters'],
  hops: GraphHop[],
  intent: CommercialIntent,
): GraphHop[] {
  const industries = (intent.target_profile.industries ?? []).filter(Boolean)
  if (!industries.length) return hops

  // If the query names a specific target company, the industry belongs to the
  // first hop target rather than the source filter.
  if (hops.length && !sourceFilters) {
    const first = hops[0]
    if (!first.target_filters.industry && !first.target_filters.name_contains) {
      first.target_filters = {
        ...first.target_filters,
        industry: industries[0],
      }
    }
  }
  return hops
}

/**
 * Translate a CommercialIntent into a multi-hop graph query plan.
 *
 * Recognises graph constraints, supplier/customer/competitor phrasing, and
 * merges base target filters (location, size) into source filters.
 */
const NAMED_GRAPH_PATTERN =
  /\b(fornitori?|clienti?|competitor|concorrenti?|partner|investitori?|dipendenti?|team|dirigenti?)\s+(?:di|dei|degli|delle)\s+['"]?[^'".,;]{2,60}['"]?/i

export function buildGraphQueryPlan(intent: CommercialIntent): GraphQueryPlan {
  let sourceFilters = buildSourceFilters(intent)
  let hops: GraphHop[] = []

  const isNamedGraph = NAMED_GRAPH_PATTERN.test(intent.original_query)

  // For named-target graph queries we always use the deterministic hop inference,
  // because the LLM often emits generic/wrong graph_constraints for these patterns.
  if (intent.graph_constraints.length && !isNamedGraph) {
    hops = intent.graph_constraints
      .map(constraintToHop)
      .filter((h): h is GraphHop => h != null)
  }

  if (hops.length === 0) {
    hops = inferHopsFromQuery(intent.original_query)
  }

  // Named-target graph queries ("fornitori di X") should not inherit base filters
  // like the city embedded in the company name; they must start from the named entity.
  if (hops.length > 0 && hops[0].target_filters.name_contains) {
    sourceFilters = undefined
  }

  // Ensure the named target is pinned on the first hop even if the LLM omitted it.
  const namedTarget = extractNamedTarget(intent.original_query)
  if (namedTarget && hops.length > 0 && !hops[0].target_filters.name_contains) {
    hops[0].target_filters.name_contains = namedTarget
  }

  hops = mergeTargetIndustryIntoHops(sourceFilters, hops, intent)

  const parts: string[] = []
  if (sourceFilters?.city) parts.push(`a ${sourceFilters.city}`)
  if (hops.length) parts.push(`via ${hops.map((h) => h.relationship_type).join(' → ')}`)

  return {
    source_filters: sourceFilters,
    hops,
    summary: parts.length ? parts.join(' ') : intent.intent_summary || intent.original_query || 'Ricerca grafo',
  }
}

// ------------------------------------------------------------------
// Plan executor
// ------------------------------------------------------------------

function hopTargetFiltersToRelationshipFilters(
  targetFilters: GraphHopTargetFilters,
): Parameters<typeof resolveTargetEntityIds>[1] {
  const observations: ObservationFilter[] = [...(targetFilters.observations ?? [])]
  if (targetFilters.industry) {
    observations.push({ attribute: 'category', operator: 'contains', value: targetFilters.industry })
  }
  if (targetFilters.location) {
    observations.push({ attribute: 'city', operator: 'contains', value: targetFilters.location })
  }

  return {
    relationship_type: 'related_to', // placeholder; resolveTargetEntityIds ignores this when target filters exist
    direction: 'outgoing',
    target_entity_type: targetFilters.entity_type,
    target_filters: {
      name_contains: targetFilters.name_contains,
      observations: observations.length ? observations : undefined,
    },
  }
}

async function resolveGraphHopTargetIds(
  sb: SupabaseClient,
  targetFilters: GraphHopTargetFilters,
): Promise<string[]> {
  const hasFilters =
    targetFilters.entity_type ||
    targetFilters.name_contains ||
    targetFilters.industry ||
    targetFilters.location ||
    targetFilters.observations?.length

  if (!hasFilters) return []

  return resolveTargetEntityIds(sb, hopTargetFiltersToRelationshipFilters(targetFilters))
}

async function fetchEntityNames(
  sb: SupabaseClient,
  ids: string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  if (ids.length === 0) return map

  const { data, error } = await sb
    .from('universe_entities')
    .select('id,name')
    .in('id', ids)

  if (error) throw wrapSupabaseError(error)

  for (const row of (data ?? []) as Array<{ id: string; name: string }>) {
    map.set(row.id, row.name)
  }
  return map
}

function pathConfidence(path: HopEvidence[]): number {
  if (path.length === 0) return 0
  const values = path.map((h) => h.confidence ?? 1)
  return values.reduce((a, b) => a + b, 0) / values.length
}

function observedAtDaysAgo(iso: string): number | null {
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return null
  return (Date.now() - t) / 86_400_000
}

export interface ExecuteGraphQueryPlanOptions {
  limit?: number
  maxHopSize?: number
  allowFallback?: boolean
}

/**
 * Execute a multi-hop plan on Supabase.
 *
 * Uses `.in()` batching to avoid N+1 queries. When `source_filters` are set,
 * the returned entities are the starting entities; otherwise they are the
 * entities reached after the last hop.
 */
export async function executeGraphQueryPlan(
  sb: SupabaseClient,
  plan: GraphQueryPlan,
  opts?: ExecuteGraphQueryPlanOptions,
): Promise<{ results: GraphReasoningResult[]; total: number; usedFallback: boolean }> {
  const maxHopSize = opts?.maxHopSize ?? 5000
  const limit = opts?.limit ?? 50

  let currentPaths = new Map<string, HopEvidence[]>()
  let usedFallback = false

  if (plan.source_filters) {
    const sf = plan.source_filters
    let q = sb.from('universe_entities').select('id').eq('entity_type', sf.entity_type)
    if (sf.city) q = q.ilike('city', `%${sf.city}%`)
    if (sf.country) q = q.eq('country', sf.country)

    const { data, error } = await q
    if (error) throw wrapSupabaseError(error)
    let ids = ((data ?? []) as Array<{ id: string }>).map((d) => d.id)

    if (sf.observations?.length) {
      ids = await intersectObservationFilters(sb, ids, sf.observations)
    }

    for (const id of ids) {
      currentPaths.set(id, [])
    }
  }

  for (let i = 0; i < plan.hops.length; i++) {
    const hop = plan.hops[i]
    const targetIds = await resolveGraphHopTargetIds(sb, hop.target_filters)
    const directions: Array<'outgoing' | 'incoming'> =
      hop.direction === 'any' ? ['outgoing', 'incoming'] : [hop.direction]

    if (currentPaths.size === 0 && targetIds.length === 0) {
      if (opts?.allowFallback !== false) {
        return { results: [], total: 0, usedFallback: true }
      }
      throw new UniverseError(
        'RELATIONSHIP_INVALID',
        `Hop ${i} is unbounded: no source set and no target filters.`,
      )
    }

    const relations: Array<{
      prevId: string
      nextId: string
      rel: UniverseRelationship
      direction: 'outgoing' | 'incoming'
    }> = []

    for (const dir of directions) {
      let q = sb
        .from('universe_relationships')
        .select('*')
        .eq('relationship_type', hop.relationship_type)

      const fixedSideCol = dir === 'outgoing' ? 'source_entity_id' : 'target_entity_id'
      const otherSideCol = dir === 'outgoing' ? 'target_entity_id' : 'source_entity_id'

      if (currentPaths.size > 0) {
        // Continue the path from the fixed side.
        q = q.in(fixedSideCol, Array.from(currentPaths.keys()))
        if (targetIds.length > 0) {
          // Named target constrains the other end of the edge.
          q = q.in(otherSideCol, targetIds)
        }
      } else if (targetIds.length > 0) {
        // No path yet: the named target is the fixed side of the edge.
        q = q.in(fixedSideCol, targetIds)
      }

      q = q.limit(maxHopSize)
      const { data, error } = await q
      if (error) throw wrapSupabaseError(error)

      for (const rel of (data ?? []) as UniverseRelationship[]) {
        const prev = dir === 'outgoing' ? rel.source_entity_id : rel.target_entity_id
        const next = dir === 'outgoing' ? rel.target_entity_id : rel.source_entity_id
        relations.push({ prevId: prev, nextId: next, rel, direction: dir })
      }
    }

    if (relations.length === 0) {
      if (plan.source_filters && opts?.allowFallback !== false) {
        usedFallback = true
        break
      }
      return { results: [], total: 0, usedFallback: false }
    }

    const involvedIds = Array.from(new Set(relations.flatMap((r) => [r.prevId, r.nextId])))
    const nameMap = await fetchEntityNames(sb, involvedIds)

    const nextPaths = new Map<string, HopEvidence[]>()
    for (const r of relations) {
      const basePath = currentPaths.get(r.prevId)
      if (currentPaths.size > 0 && !basePath) continue

      const evidence: HopEvidence = {
        hop_index: i,
        relationship_type: r.rel.relationship_type,
        direction: r.direction,
        from_entity_id: r.prevId,
        from_entity_name: nameMap.get(r.prevId) ?? 'Sconosciuto',
        to_entity_id: r.nextId,
        to_entity_name: nameMap.get(r.nextId) ?? 'Sconosciuto',
        confidence: r.rel.confidence ?? 1,
        observed_at: r.rel.observed_at,
      }

      const newPath = [...(basePath ?? []), evidence]
      const existing = nextPaths.get(r.nextId)
      if (!existing || pathConfidence(newPath) > pathConfidence(existing)) {
        nextPaths.set(r.nextId, newPath)
      }
    }

    currentPaths = nextPaths
  }

  let resultPaths = new Map<string, HopEvidence[]>()

  if (plan.source_filters) {
    // Group by the original source entity (first hop origin, or the source itself on fallback).
    for (const path of currentPaths.values()) {
      const sourceId = path.length ? path[0].from_entity_id : Array.from(currentPaths.keys())[0]
      if (!sourceId) continue
      const existing = resultPaths.get(sourceId)
      if (!existing || pathConfidence(path) > pathConfidence(existing)) {
        resultPaths.set(sourceId, path)
      }
    }
  } else {
    resultPaths = currentPaths
  }

  let resultIds = Array.from(resultPaths.keys())
  if (resultIds.length > limit) {
    // Keep highest-confidence paths first.
    resultIds = resultIds
      .sort((a, b) => pathConfidence(resultPaths.get(b)!) - pathConfidence(resultPaths.get(a)!))
      .slice(0, limit)
  }

  if (resultIds.length === 0) {
    return { results: [], total: 0, usedFallback }
  }

  const { data: entitiesData, error: entitiesError } = await sb
    .from('universe_entities')
    .select('*')
    .in('id', resultIds)

  if (entitiesError) throw wrapSupabaseError(entitiesError)

  const entityMap = new Map<string, UniverseEntity>()
  for (const e of (entitiesData ?? []) as UniverseEntity[]) {
    entityMap.set(e.id, e)
  }

  const results: GraphReasoningResult[] = []
  for (const id of resultIds) {
    const entity = entityMap.get(id)
    if (!entity) continue
    results.push({
      entity,
      path_evidence: resultPaths.get(id) ?? [],
      subgraph_score: 0,
    })
  }

  return { results, total: results.length, usedFallback }
}

// ------------------------------------------------------------------
// Observation helpers duplicated minimally to keep graph-reasoning self-contained
// ------------------------------------------------------------------

function buildObservationQuery(sb: SupabaseClient, filter: ObservationFilter) {
  let q = sb.from('universe_observations').select('entity_id').eq('attribute', filter.attribute)

  switch (filter.operator) {
    case 'eq':
    case 'neq':
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte':
    case 'in':
      q = q.filter('value', filter.operator, filter.value)
      break
    case 'contains': {
      const pattern = typeof filter.value === 'string' ? `%${filter.value}%` : `%${String(filter.value)}%`
      q = q.ilike('value', pattern)
      break
    }
    case 'is_null':
      q = q.filter('value', 'is', null)
      break
    case 'not_null':
      q = q.filter('value', 'not.is', null)
      break
  }

  return q
}

async function intersectObservationFilters(
  sb: SupabaseClient,
  baseIds: string[],
  filters: ObservationFilter[],
): Promise<string[]> {
  let current = new Set(baseIds)
  for (const filter of filters) {
    const { data, error } = await buildObservationQuery(sb, filter)
    if (error) throw wrapSupabaseError(error)
    const ids = new Set(((data ?? []) as Array<{ entity_id: string }>).map((d) => d.entity_id))
    current = new Set([...current].filter((id) => ids.has(id)))
    if (current.size === 0) break
  }
  return Array.from(current)
}

// ------------------------------------------------------------------
// Scoring
// ------------------------------------------------------------------

export interface SubgraphScoreFactors {
  hops: number
  confidence: number
  freshness: number
  intent_fit: number
}

/**
 * Score an entity based on its graph path evidence, freshness, confidence and
 * intent fit.
 */
export function computeSubgraphScore(
  entity: UniverseEntity,
  pathEvidence: HopEvidence[],
  intent: CommercialIntent,
): { score: number; factors: SubgraphScoreFactors } {
  let score = 35

  const hops = pathEvidence.length
  score += Math.min(30, hops * 15)

  const confidences = pathEvidence.map((h) => h.confidence ?? 1)
  const confidence = confidences.length ? confidences.reduce((a, b) => a + b, 0) / confidences.length : 0
  score += Math.round(confidence * 20)

  let freshness = 0
  const recent = pathEvidence
    .map((h) => observedAtDaysAgo(h.observed_at))
    .filter((d): d is number => d != null)
    .sort((a, b) => a - b)[0]

  if (recent != null) {
    if (recent <= 30) freshness = 15
    else if (recent <= 90) freshness = 8
    else freshness = 3
  }
  score += freshness

  let intent_fit = 0
  const targetLocations = intent.target_profile.locations ?? []
  if (targetLocations.length) {
    const city = (entity.city ?? '').toLowerCase()
    const region = (entity.region ?? '').toLowerCase()
    const matched = targetLocations.some(
      (loc) =>
        city.includes(loc.toLowerCase()) ||
        loc.toLowerCase().includes(city) ||
        region.includes(loc.toLowerCase()) ||
        loc.toLowerCase().includes(region),
    )
    if (matched) intent_fit += 8
  }

  const targetIndustries = intent.target_profile.industries ?? []
  if (targetIndustries.length) {
    const metaCat = String(entity.metadata?.category ?? '').toLowerCase()
    const name = entity.name.toLowerCase()
    const matched = targetIndustries.some(
      (ind) => metaCat.includes(ind.toLowerCase()) || name.includes(ind.toLowerCase()),
    )
    if (matched) intent_fit += 7
  }
  score += intent_fit

  score = Math.min(100, Math.round(score))

  return {
    score,
    factors: { hops, confidence, freshness, intent_fit },
  }
}
