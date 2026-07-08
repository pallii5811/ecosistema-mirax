/**
 * Agentic Search v0 — SignalIntent → UniverseQuery → lead rows compatibili con ResultsTable.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { SignalIntentSpec } from '@/lib/signal-intent/types'
import type {
  CommercialIntent,
  CommercialSignal,
  CommercialGraphConstraint,
  CommercialEntityType,
} from '@/lib/signal-intent/commercial-intent'
import type { EntityType, UniverseEntity } from './types.ts'
import {
  executeUniverseQuery,
  type UniverseQuery,
  type ObservationFilter,
  type RelationshipFilter,
  type EventFilter,
  VALID_RELATIONSHIP_TYPES,
} from './query-builder.ts'
import {
  buildGraphQueryPlan,
  executeGraphQueryPlan,
  computeSubgraphScore,
  type HopEvidence,
} from './graph-reasoning.ts'
import { getLatestObservation } from './observation-repository.ts'
import { rankUniverseEntities } from './graph-ranking.ts'
import { buildCommercialOpportunities, rankOpportunities, type CommercialOpportunity } from './opportunity.ts'
import { getEntityFeedbackBoostMap, applyFeedbackBoost } from './feedback.ts'
import { graphCategoryTokenForQuery } from '@/lib/lead-relevance'

export type UniverseQueryIntent = {
  query: UniverseQuery
  summary: string
  parse_source: string
}

export type CommercialUniverseQueryIntent = {
  query: UniverseQuery
  summary: string
  reasoning: string | null
  confidence: number
  parse_source: string
}

function booleanObservation(attribute: string, value: boolean | null | undefined): ObservationFilter | null {
  if (value === true) return { attribute, operator: 'eq', value: true }
  if (value === false) return { attribute, operator: 'eq', value: false }
  return null
}

function technicalFiltersToObservations(
  tf: SignalIntentSpec['technical_filters'],
): ObservationFilter[] {
  if (!tf) return []
  const out: ObservationFilter[] = []

  const meta = booleanObservation('meta_pixel', tf.has_meta_pixel)
  if (meta) out.push(meta)

  const gtm = booleanObservation('google_tag_manager', tf.has_gtm)
  if (gtm) out.push(gtm)

  const ga = booleanObservation('google_analytics', tf.has_google_analytics)
  if (ga) out.push(ga)

  const ssl = booleanObservation('ssl', tf.has_ssl)
  if (ssl) out.push(ssl)

  if (tf.errors_seo === true) out.push({ attribute: 'seo_disaster', operator: 'eq', value: true })
  if (tf.errors_seo === false) out.push({ attribute: 'seo_disaster', operator: 'eq', value: false })

  const mobile = booleanObservation('mobile_friendly', tf.mobile_friendly)
  if (mobile) out.push(mobile)

  if (tf.load_speed_slow === true) {
    out.push({ attribute: 'load_speed_seconds', operator: 'gt', value: 3 })
  } else if (tf.load_speed_slow === false) {
    out.push({ attribute: 'load_speed_seconds', operator: 'lte', value: 3 })
  }
  if (tf.site_speed === 'slow') {
    out.push({ attribute: 'load_speed_seconds', operator: 'gt', value: 3 })
  } else if (tf.site_speed === 'fast') {
    out.push({ attribute: 'load_speed_seconds', operator: 'lte', value: 3 })
  }

  const chatbot = booleanObservation('has_chatbot', tf.has_chatbot)
  if (chatbot) out.push(chatbot)

  const booking = booleanObservation('has_booking', tf.has_booking)
  if (booking) out.push(booking)

  return out
}

function socialFiltersToObservations(
  sf: SignalIntentSpec['social_filters'],
): ObservationFilter[] {
  if (!sf) return []
  const out: ObservationFilter[] = []

  const instagram = booleanObservation('has_instagram', sf.has_instagram)
  if (instagram) out.push(instagram)
  if (sf.missing_instagram === true) out.push({ attribute: 'has_instagram', operator: 'eq', value: false })

  const facebook = booleanObservation('has_facebook', sf.has_facebook)
  if (facebook) out.push(facebook)
  if (sf.missing_facebook === true) out.push({ attribute: 'has_facebook', operator: 'eq', value: false })

  const linkedin = booleanObservation('has_linkedin', sf.has_linkedin)
  if (linkedin) out.push(linkedin)
  if (sf.missing_linkedin === true) out.push({ attribute: 'has_linkedin', operator: 'eq', value: false })

  if (sf.reviews_negative === true) out.push({ attribute: 'rating', operator: 'lt', value: 4 })
  if (sf.reviews_negative === false) out.push({ attribute: 'rating', operator: 'gte', value: 4 })

  const followers = booleanObservation('social_followers_low', sf.social_followers_low)
  if (followers) out.push(followers)

  return out
}

function businessFiltersToObservations(
  bf: SignalIntentSpec['business_filters'],
): ObservationFilter[] {
  if (!bf) return []
  const out: ObservationFilter[] = []
  if (bf.revenue_min != null) out.push({ attribute: 'revenue', operator: 'gte', value: bf.revenue_min })
  if (bf.revenue_max != null) out.push({ attribute: 'revenue', operator: 'lte', value: bf.revenue_max })
  if (bf.employees_min != null) out.push({ attribute: 'employees', operator: 'gte', value: bf.employees_min })
  if (bf.employees_max != null) out.push({ attribute: 'employees', operator: 'lte', value: bf.employees_max })
  if (bf.founded_after) out.push({ attribute: 'founded_at', operator: 'gte', value: bf.founded_after })
  if (bf.founded_before) out.push({ attribute: 'founded_at', operator: 'lte', value: bf.founded_before })
  return out
}

const PLATFORM_TECHS = new Set([
  'wordpress',
  'shopify',
  'react',
  'angular',
  'vue',
  'prestashop',
  'magento',
  'salesforce',
  'hubspot',
  'zoho',
])

function commercialTechToQueryParts(
  tech?: CommercialIntent['tech_profile'],
): { observations: ObservationFilter[]; relationships: RelationshipFilter[] } {
  if (!tech) return { observations: [], relationships: [] }
  const observations: ObservationFilter[] = []
  const relationships: RelationshipFilter[] = []
  for (const t of tech.has ?? []) {
    const key = t.trim().toLowerCase()
    if (!key) continue
    if (PLATFORM_TECHS.has(key)) {
      relationships.push({
        relationship_type: 'uses',
        direction: 'outgoing',
        target_entity_type: 'technology',
        target_filters: { name_contains: key },
      })
    } else {
      observations.push({ attribute: key, operator: 'eq', value: true })
    }
  }
  for (const t of tech.missing ?? []) {
    const key = t.trim().toLowerCase()
    if (key && !PLATFORM_TECHS.has(key)) observations.push({ attribute: key, operator: 'eq', value: false })
  }
  return { observations, relationships }
}

function commercialTargetToFilters(
  target?: CommercialIntent['target_profile'],
): { city?: string; observations: ObservationFilter[] } {
  const observations: ObservationFilter[] = []
  let city: string | undefined

  if (!target) return { city, observations }

  const locations = (target.locations ?? []).filter(Boolean)
  if (locations.length === 1) {
    city = locations[0]
  } else if (locations.length > 1) {
    observations.push({ attribute: 'city', operator: 'in', value: locations })
  }

  for (const ind of target.industries ?? []) {
    if (!ind.trim()) continue
    if (/^(startup|scaleup)$/i.test(ind.trim())) {
      observations.push({ attribute: 'company_stage', operator: 'contains', value: ind.trim().toLowerCase() })
    } else {
      observations.push({ attribute: 'category', operator: 'contains', value: ind.trim() })
    }
  }

  const size = target.company_size
  if (size) {
    // Treat 0 as "not specified" — the LLM often returns 0 as a default.
    if (size.min_employees != null && size.min_employees > 0) {
      observations.push({ attribute: 'employees', operator: 'gte', value: size.min_employees })
    }
    if (size.max_employees != null && size.max_employees > 0) {
      observations.push({ attribute: 'employees', operator: 'lte', value: size.max_employees })
    }
    if (size.revenue_min != null && size.revenue_min > 0) {
      observations.push({ attribute: 'revenue', operator: 'gte', value: size.revenue_min })
    }
    if (size.revenue_max != null && size.revenue_max > 0) {
      observations.push({ attribute: 'revenue', operator: 'lte', value: size.revenue_max })
    }
  }

  return { city, observations }
}

function commercialSignalToQueryParts(
  signals: CommercialSignal[],
): { observations: ObservationFilter[]; relationships: RelationshipFilter[]; events: EventFilter[] } {
  const observations: ObservationFilter[] = []
  const relationships: RelationshipFilter[] = []
  const events: EventFilter[] = []

  for (const sig of signals) {
    const window = sig.time_window_days ?? 365
    const params = sig.params ?? {}
    switch (sig.type) {
      case 'hiring': {
        const role = typeof params.role === 'string' ? params.role : undefined
        relationships.push({
          relationship_type: 'hires',
          direction: 'outgoing',
          target_entity_type: 'job',
          target_filters: role ? { name_contains: role } : undefined,
        })
        break
      }
      case 'tender_won':
        events.push({ event_type: 'tender_won', time_window_days: window })
        break
      case 'funding_received':
        events.push({ event_type: 'funding_received', time_window_days: window })
        break
      case 'seeking_supplier':
        events.push({ event_type: 'supplier_sought', time_window_days: window })
        break
      case 'seeking_investment':
        // investment_sought is not yet a formal UniverseEventType; map to funding_received for now.
        events.push({ event_type: 'funding_received', time_window_days: window })
        break
      case 'investing_marketing':
        observations.push({ attribute: 'investing_marketing', operator: 'eq', value: true })
        break
      case 'site_stale':
        observations.push({
          attribute: 'last_audited_at',
          operator: 'lt',
          value: daysAgoIso(window, 180),
        })
        break
      case 'ecommerce':
        observations.push({ attribute: 'ecommerce', operator: 'eq', value: true })
        break
      case 'b2b':
        observations.push({ attribute: 'business_model', operator: 'eq', value: 'B2B' })
        break
      case 'b2c':
      case 'd2c':
        observations.push({ attribute: 'business_model', operator: 'eq', value: 'B2C' })
        break
      case 'new_location':
      case 'registry_change':
        events.push({ event_type: 'registry_change', time_window_days: window })
        break
      case 'international_expansion':
        observations.push({ attribute: 'international_presence', operator: 'eq', value: true })
        break
      case 'certification': {
        const cert = typeof params.certification === 'string' ? params.certification : undefined
        observations.push({
          attribute: 'certifications',
          operator: 'contains',
          value: cert ?? 'certificazione',
        })
        break
      }
      case 'crm_installed':
        events.push({ event_type: 'crm_installed', time_window_days: window })
        break
      case 'ads_started':
        observations.push({ attribute: 'meta_ads_running', operator: 'eq', value: true })
        observations.push({ attribute: 'google_ads_running', operator: 'eq', value: true })
        break
      case 'new_director':
        events.push({ event_type: 'new_director', time_window_days: window })
        break
      case 'revenue_changed':
        events.push({ event_type: 'revenue_changed', time_window_days: window })
        break
      case 'employees_changed':
        events.push({ event_type: 'employees_changed', time_window_days: window })
        break
      case 'sector_investment':
        events.push({ event_type: 'sector_investment', time_window_days: window })
        break
      case 'partnership_announced':
        // partnership_announced is not yet a formal UniverseEventType; map to generic signal observation.
        observations.push({ attribute: 'partnership_announced', operator: 'eq', value: true })
        break
      default:
        // Unknown signals are best-effort: try an observation of the same name.
        observations.push({ attribute: sig.type, operator: 'eq', value: true })
    }
  }

  return { observations, relationships, events }
}

function commercialGraphConstraintsToRelationships(
  constraints: CommercialGraphConstraint[],
): RelationshipFilter[] {
  return constraints
    .filter((c) => VALID_RELATIONSHIP_TYPES.has(c.relationship_type))
    .map((c) => {
      const targetType = c.target_filter?.entity_type
      const target_filters: RelationshipFilter['target_filters'] = {}
      if (c.target_filter?.industry) {
        target_filters.observations = [
          { attribute: 'category', operator: 'contains', value: c.target_filter.industry },
        ]
      }
      if (c.target_filter?.location) {
        target_filters.observations = target_filters.observations ?? []
        target_filters.observations.push({
          attribute: 'city',
          operator: 'contains',
          value: c.target_filter.location,
        })
      }
      return {
        relationship_type: c.relationship_type as RelationshipFilter['relationship_type'],
        direction: c.direction === 'any' ? 'outgoing' : c.direction,
        target_entity_type: targetType as EntityType | undefined,
        target_filters: Object.keys(target_filters).length ? target_filters : undefined,
      }
    })
}

function hiringRoleAliases(role: string): string[] {
  const normalized = role.trim().toLowerCase()
  if (/programmator|developer|sviluppator|software engineer|full[\s-]?stack|backend|frontend/.test(normalized)) {
    return ['programmatore', 'developer', 'sviluppatore', 'software engineer', 'frontend', 'backend']
  }
  if (/commercial|sales|venditor|account manager|business developer/.test(normalized)) {
    return ['commerciale', 'sales', 'venditore', 'account manager', 'business developer']
  }
  if (/marketing|growth|seo|social media|copywriter/.test(normalized)) {
    return ['marketing', 'growth', 'seo', 'social media', 'copywriter']
  }
  return normalized ? [normalized] : []
}

function shouldUseGraphReasoning(intent: CommercialIntent): boolean {
  if (intent.graph_constraints.length >= 2) return true

  const lower = intent.original_query.toLowerCase()
  const multiHopPatterns = [
    /\bcompetitor\s+(?:dei|degli|delle|di)\s+clienti\b/i,
    /\bclienti\s+(?:dei|degli|delle|di)\s+clienti\b/i,
    /\bfornitori\s+(?:dei|degli|delle|di)\s+clienti\b/i,
    /\bfornitori\s+(?:dei|degli|delle|di)\s+fornitori\b/i,
    /\bcompetitor\s+(?:dei|degli|delle|di)\s+competitor\b/i,
  ]
  if (multiHopPatterns.some((p) => p.test(lower))) return true

  // Single named-target graph queries (e.g. "fornitori di X", "clienti di Y").
  const namedGraphPattern =
    /\b(fornitori?|clienti?|competitor|concorrenti?|partner|investitori?|dipendenti?|team|dirigenti?)\s+(?:di|dei|degli|delle)\s+['"]?[^'".,;]{2,60}['"]?/i
  if (namedGraphPattern.test(lower)) return true

  return false
}

async function executeGraphReasoningSearch(
  sb: SupabaseClient,
  intent: CommercialIntent,
  opts?: {
    limit?: number
    userId?: string
    skipOpportunities?: boolean
    skipHydration?: boolean
    skipRanking?: boolean
  },
): Promise<{
  intent: CommercialUniverseQueryIntent
  entities: UniverseEntity[]
  total: number
  results: Record<string, unknown>[]
}> {
  const plan = buildGraphQueryPlan(intent)
  const { results: graphResults, total, usedFallback } = await executeGraphQueryPlan(sb, plan, {
    limit: opts?.limit ?? 50,
    allowFallback: true,
  })

  const scored = graphResults.map((r) => ({
    ...r,
    subgraph_score: computeSubgraphScore(r.entity, r.path_evidence, intent).score,
  }))

  const entities = scored.map((s) => s.entity)
  const graphScoreMap = opts?.skipRanking
    ? new Map(entities.map((e) => [e.id, 0]))
    : new Map(scored.map((s) => [s.entity.id, s.subgraph_score]))
  const pathEvidenceMap = new Map<string, HopEvidence[]>(
    scored.map((s) => [s.entity.id, s.path_evidence]),
  )

  let opportunities: CommercialOpportunity[] = []
  if (opts?.skipOpportunities) {
    opportunities = entities.map((entity) => ({
      entity,
      opportunity_score: 0,
      graph_score: graphScoreMap.get(entity.id) ?? 0,
      signals: [],
      evidence: [],
      reasoning: '',
      intent_fit_score: 0,
      path_evidence: pathEvidenceMap.get(entity.id) ?? [],
    }))
  } else {
    opportunities = await buildCommercialOpportunities(sb, entities, graphScoreMap, intent, pathEvidenceMap)
  }

  let feedbackBoostMap = new Map<string, number>()
  if (opts?.userId && opportunities.length > 0) {
    feedbackBoostMap = await getEntityFeedbackBoostMap(
      sb,
      opts.userId,
      opportunities.map((o) => o.entity.id),
    )
    opportunities = applyFeedbackBoost(opportunities, feedbackBoostMap)
    opportunities = rankOpportunities(opportunities)
  }

  opportunities = rankOpportunities(opportunities)

  const results = await Promise.all(
    opportunities.map(async (opp) => {
      const row = opts?.skipHydration
        ? { entity_id: opp.entity.id, azienda: opp.entity.name, nome: opp.entity.name }
        : await entityToMiraxLeadRow(sb, opp.entity)
      row.graph_score = opp.graph_score
      row.opportunity_score = opp.opportunity_score
      row._score = opp.opportunity_score
      row.graph_rank_factors = rankedGraphFactors(opp.entity, opp.graph_score, opp.path_evidence)
      row.commercial_signals = opp.signals.map((s) => ({
        type: s.type,
        score: s.score,
        confidence: s.confidence,
        summary: s.evidence[0]?.claim || s.type,
      }))
      row.commercial_evidence = opp.evidence.slice(0, 5).map((e) => ({
        claim: e.claim,
        source_type: e.source_type,
        source: e.source,
        observed_at: e.observed_at,
      }))
      row.path_evidence = opp.path_evidence
      row.commercial_reasoning = opp.reasoning
      row.intent_fit_score = opp.intent_fit_score
      row.feedback_boost = opp.entity.id ? (feedbackBoostMap.get(opp.entity.id) ?? 0) : 0
      row.graph_reasoning_fallback = usedFallback
      return row
    }),
  )

  const mapped = commercialIntentToUniverseQuery(intent, opts)
  return {
    intent: mapped,
    entities: opportunities.map((o) => o.entity),
    total,
    results,
  }
}

function rankedGraphFactors(
  entity: UniverseEntity,
  graphScore: number,
  pathEvidence: HopEvidence[],
): Record<string, unknown> {
  return {
    freshness: 0,
    intent_location: 0,
    intent_category: 0,
    recent_events: 0,
    relationships: pathEvidence.length,
    observations: 0,
    confidence: pathEvidence.length
      ? pathEvidence.reduce((a, b) => a + (b.confidence ?? 1), 0) / pathEvidence.length
      : 0,
    graph_score: graphScore,
    hops: pathEvidence.length,
    entity_id: entity.id,
  }
}

/** Mappa un CommercialIntent (query libera) in una UniverseQuery strutturata. */
export function commercialIntentToUniverseQuery(
  intent: CommercialIntent,
  opts?: { limit?: number },
): CommercialUniverseQueryIntent {
  const entityTypes = (intent.target_profile.entity_types ?? []) as CommercialEntityType[]
  const entityType: EntityType = entityTypes.includes('person') ? 'person' : 'company'

  const targetFilters = commercialTargetToFilters(intent.target_profile)
  const signalParts = commercialSignalToQueryParts(intent.signals)
  const techParts = commercialTechToQueryParts(intent.tech_profile)
  const graphRels = commercialGraphConstraintsToRelationships(intent.graph_constraints)

  const observations: ObservationFilter[] = [
    ...targetFilters.observations,
    ...signalParts.observations,
    ...techParts.observations,
  ]

  if (!(intent.target_profile.industries ?? []).some((i) => i?.trim())) {
    const token = graphCategoryTokenForQuery(intent.original_query ?? '')
    if (token) {
      observations.push({ attribute: 'category', operator: 'contains', value: token })
    }
  }

  // If the intent carries explicit hiring roles, build precise job relationships.
  const hasHiringSignal = intent.signals.some((s) => s.type === 'hiring')
  const hiringRoles = intent.signals
    .filter((s) => s.type === 'hiring')
    .map((s) => (typeof s.params?.role === 'string' ? s.params.role : undefined))
    .filter((r): r is string => Boolean(r))
  const explicitRoles = [...hiringRoles, ...(intent.target_profile.roles ?? [])].filter(Boolean)

  const relationships: RelationshipFilter[] = [
    ...signalParts.relationships.filter((r) => r.relationship_type !== 'hires'),
    ...graphRels,
    ...techParts.relationships,
  ]

  if (hasHiringSignal) {
    if (explicitRoles.length) {
      const aliases = [...new Set(explicitRoles.flatMap(hiringRoleAliases))]
      relationships.push({
        relationship_type: 'hires',
        direction: 'outgoing',
        target_entity_type: 'job',
        target_filters: { name_contains_any: aliases },
      })
    } else {
      relationships.push({
        relationship_type: 'hires',
        direction: 'outgoing',
        target_entity_type: 'job',
      })
    }
  }

  const orderBy: UniverseQuery['orderBy'] | undefined =
    intent.ranking_hint === 'recently_active'
      ? { attribute: 'last_seen_at', direction: 'desc' }
      : undefined

  const query: UniverseQuery = {
    entity_type: entityType,
    filters: {
      city: targetFilters.city,
      observations: observations.length ? observations : undefined,
    },
    relationships: relationships.length ? relationships : undefined,
    events: signalParts.events.length ? signalParts.events : undefined,
    orderBy,
    limit: opts?.limit ?? 50,
  }

  const summary =
    intent.intent_summary ||
    intent.reasoning ||
    intent.original_query ||
    'Ricerca commerciale'

  return {
    query,
    summary,
    reasoning: intent.reasoning,
    confidence: intent.confidence,
    parse_source: intent.parse_source,
  }
}

function daysAgoIso(days: number | null | undefined, fallback: number): string {
  const d = days ?? fallback
  return new Date(Date.now() - d * 24 * 60 * 60 * 1000).toISOString()
}

function requiredSignalsToQueryParts(
  intent: SignalIntentSpec,
): { observations: ObservationFilter[]; relationships: RelationshipFilter[]; events: EventFilter[] } {
  const observations: ObservationFilter[] = []
  const relationships: RelationshipFilter[] = []
  const events: EventFilter[] = []

  const signals = intent.required_signals ?? []
  const window = intent.time_window_days

  if (signals.includes('hiring')) {
    const role = intent.hiring_roles?.[0]
    relationships.push({
      relationship_type: 'hires',
      direction: 'outgoing',
      target_entity_type: 'job',
      target_filters: role ? { name_contains: role } : undefined,
    })
  }

  if (signals.includes('tender_won')) {
    events.push({ event_type: 'tender_won', time_window_days: window })
  }

  if (signals.includes('funding_received')) {
    events.push({ event_type: 'funding_received', time_window_days: window })
  }

  if (signals.includes('registry_change')) {
    events.push({ event_type: 'registry_change', time_window_days: window })
  }

  if (signals.includes('crm_installed') || signals.includes('crm_detected')) {
    events.push({ event_type: 'crm_installed', time_window_days: window })
  }
  if (signals.includes('crm_change') || intent.require_crm_change) {
    events.push({ event_type: 'crm_installed', time_window_days: window })
  }
  for (const kw of intent.crm_keywords ?? []) {
    if (kw.trim()) {
      observations.push({ attribute: 'crm_stack', operator: 'contains', value: kw.trim() })
    }
  }

  if (signals.includes('site_stale')) {
    observations.push({
      attribute: 'last_audited_at',
      operator: 'lt',
      value: daysAgoIso(window, 180),
    })
  }

  if (signals.includes('meta_ads_started')) {
    observations.push({ attribute: 'meta_ads_running', operator: 'eq', value: true })
  }

  if (signals.includes('google_ads_started')) {
    observations.push({ attribute: 'google_ads_running', operator: 'eq', value: true })
  }

  if (signals.includes('investing_marketing')) {
    observations.push({ attribute: 'investing_marketing', operator: 'eq', value: true })
  }

  return { observations, relationships, events }
}

/** Mappa intent MIRAX → query strutturata sul grafo. */
export function signalIntentToUniverseQuery(
  intent: SignalIntentSpec,
  opts?: { city?: string; limit?: number },
): UniverseQueryIntent {
  const city = opts?.city ?? intent.location ?? undefined
  const observations = technicalFiltersToObservations(intent.technical_filters)
  observations.push(...socialFiltersToObservations(intent.social_filters))
  observations.push(...businessFiltersToObservations(intent.business_filters))

  const signalParts = requiredSignalsToQueryParts(intent)
  observations.push(...signalParts.observations)

  const categoryLabel = (intent.category ?? '').trim()
  let categoryToken =
    categoryLabel.match(/\bedil\w*/i)?.[0]?.toLowerCase() ||
    categoryLabel.split(/\s+/).find((w) => w.length > 4)?.toLowerCase() ||
    categoryLabel.toLowerCase()

  if (!categoryToken && intent.sector_keywords?.length) {
    categoryToken = intent.sector_keywords[0].trim().toLowerCase()
  }

  const query: UniverseQuery = {
    entity_type: 'company',
    filters: {
      city,
      name_contains: categoryToken && categoryToken.length >= 4 ? categoryToken : intent.category ?? undefined,
      observations: observations.length ? observations : undefined,
    },
    relationships: signalParts.relationships.length ? signalParts.relationships : undefined,
    events: signalParts.events.length ? signalParts.events : undefined,
    limit: opts?.limit ?? 50,
  }

  const summary =
    intent.intent_summary ||
    intent.reasoning ||
    [intent.category, city, ...intent.required_signals].filter(Boolean).join(' · ') ||
    'Ricerca grafo'

  return {
    query,
    summary,
    parse_source: intent.parse_source ?? 'merged',
  }
}

const DEFAULT_OBS_ATTRS = [
  'meta_pixel',
  'google_tag_manager',
  'ssl',
  'rating',
  'category',
  'employees',
  'revenue',
] as const

// PEC and mobile_phone are considered extra-sensitive and exposed only through
// the audited /pii endpoint. Phone and email are surfaced in search results
// because they are already public from Maps/website sources.
const SENSITIVE_OBS_ATTRS = new Set(['pec_email', 'mobile_phone'])

/** Converte entità grafo → shape lead per ResultsTable (read-only). */
export async function entityToMiraxLeadRow(
  sb: SupabaseClient,
  entity: UniverseEntity,
  attrs: readonly string[] = DEFAULT_OBS_ATTRS,
): Promise<Record<string, unknown>> {
  const latest: Record<string, unknown> = {}
  for (const attr of attrs) {
    if (SENSITIVE_OBS_ATTRS.has(attr)) continue
    const obs = await getLatestObservation(sb, entity.id, attr)
    if (obs) latest[attr] = obs.value
  }

  const meta = entity.metadata ?? {}
  const domain =
    entity.entity_type === 'company' && entity.canonical_id.includes('.')
      ? entity.canonical_id
      : (meta.domain as string | undefined)

  return {
    entity_id: entity.id,
    azienda: entity.name,
    nome: entity.name,
    citta: entity.city ?? latest.city ?? null,
    categoria: (latest.category as string) ?? (meta.category as string) ?? null,
    sito: domain ? (domain.startsWith('http') ? domain : `https://${domain}`) : null,
    telefono: latest.phone ?? null,
    email: latest.email ?? null,
    pec_email: null,
    mobile_phone: null,
    meta_pixel: latest.meta_pixel ?? null,
    google_tag_manager: latest.google_tag_manager ?? null,
    ssl: latest.ssl ?? null,
    rating: latest.rating ?? null,
    dipendenti: latest.employees ?? null,
    fatturato: latest.revenue ?? null,
    universe_source: true,
  }
}

export async function executeAgenticUniverseSearch(
  sb: SupabaseClient,
  intent: SignalIntentSpec,
  opts?: { city?: string; limit?: number },
): Promise<{
  intent: UniverseQueryIntent
  entities: UniverseEntity[]
  total: number
  results: Record<string, unknown>[]
}> {
  const mapped = signalIntentToUniverseQuery(intent, opts)
  const { entities, total } = await executeUniverseQuery(sb, mapped.query)
  const rankedAll = await rankUniverseEntities(sb, entities, intent)
  const limit = opts?.limit ?? 50
  const ranked = rankedAll.slice(0, limit)
  const results = await Promise.all(
    ranked.map(async ({ entity, graph_score, graph_rank_factors }) => {
      const row = await entityToMiraxLeadRow(sb, entity)
      row.graph_score = graph_score
      row._score = graph_score
      row.graph_rank_factors = graph_rank_factors
      return row
    }),
  )
  return {
    intent: mapped,
    entities: ranked.map((r) => r.entity),
    total,
    results,
  }
}

/** Esegue Agentic Search a partire da un CommercialIntent (query libera). */
export async function executeCommercialUniverseSearch(
  sb: SupabaseClient,
  intent: CommercialIntent,
  opts?: {
    limit?: number
    userId?: string
    skipOpportunities?: boolean
    skipHydration?: boolean
    skipRanking?: boolean
  },
): Promise<{
  intent: CommercialUniverseQueryIntent
  entities: UniverseEntity[]
  total: number
  results: Record<string, unknown>[]
}> {
  if (shouldUseGraphReasoning(intent)) {
    return executeGraphReasoningSearch(sb, intent, opts)
  }

  const mapped = commercialIntentToUniverseQuery(intent, opts)
  const { entities, total } = await executeUniverseQuery(sb, mapped.query)

  const rankableIntent = {
    location: mapped.query.filters?.city ?? intent.target_profile.locations?.[0] ?? null,
    category: intent.target_profile.industries?.[0] ?? null,
  }
  const rankedAll = opts?.skipRanking
    ? entities.map((entity) => ({
        entity,
        graph_score: 0,
        graph_rank_factors: {
          freshness: 0,
          intent_location: 0,
          intent_category: 0,
          recent_events: 0,
          relationships: 0,
          observations: 0,
          confidence: 0,
        },
      }))
    : await rankUniverseEntities(sb, entities, rankableIntent)
  const limit = opts?.limit ?? 50
  const ranked = rankedAll.slice(0, limit)
  const graphScoreMap = new Map(ranked.map((r) => [r.entity.id, r.graph_score]))

  let opportunities: CommercialOpportunity[] = []
  if (opts?.skipOpportunities) {
    opportunities = ranked.map(({ entity, graph_score }) => ({
      entity,
      opportunity_score: 0,
      graph_score,
      signals: [],
      evidence: [],
      reasoning: '',
      intent_fit_score: 0,
      path_evidence: [],
    }))
  } else {
    opportunities = await buildCommercialOpportunities(sb, ranked.map((r) => r.entity), graphScoreMap, intent)
  }

  // Personalization: boost/penalize based on this user's past feedback.
  let feedbackBoostMap = new Map<string, number>()
  if (opts?.userId && opportunities.length > 0) {
    feedbackBoostMap = await getEntityFeedbackBoostMap(
      sb,
      opts.userId,
      opportunities.map((o) => o.entity.id),
    )
    opportunities = applyFeedbackBoost(opportunities, feedbackBoostMap)
    opportunities = rankOpportunities(opportunities)
  }

  const rankedOpportunities = rankOpportunities(opportunities)

  const results = await Promise.all(
    rankedOpportunities.map(async (opp) => {
      const row = opts?.skipHydration
        ? { entity_id: opp.entity.id, azienda: opp.entity.name, nome: opp.entity.name }
        : await entityToMiraxLeadRow(sb, opp.entity)
      row.graph_score = opp.graph_score
      row.opportunity_score = opp.opportunity_score
      row._score = opp.opportunity_score
      row.graph_rank_factors = ranked.find((r) => r.entity.id === opp.entity.id)?.graph_rank_factors
      row.commercial_signals = opp.signals.map((s) => ({
        type: s.type,
        score: s.score,
        confidence: s.confidence,
        summary: s.evidence[0]?.claim || s.type,
      }))
      row.commercial_evidence = opp.evidence.slice(0, 5).map((e) => ({
        claim: e.claim,
        source_type: e.source_type,
        source: e.source,
        observed_at: e.observed_at,
      }))
      row.commercial_reasoning = opp.reasoning
      row.intent_fit_score = opp.intent_fit_score
      row.feedback_boost = opp.entity.id ? (feedbackBoostMap.get(opp.entity.id) ?? 0) : 0
      return row
    }),
  )

  return {
    intent: mapped,
    entities: rankedOpportunities.map((r) => r.entity),
    total,
    results,
  }
}
