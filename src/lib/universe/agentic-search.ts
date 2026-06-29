/**
 * Agentic Search v0 — SignalIntent → UniverseQuery → lead rows compatibili con ResultsTable.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { SignalIntentSpec } from '@/lib/signal-intent/types'
import type { UniverseEntity } from './types.ts'
import { executeUniverseQuery, type UniverseQuery, type ObservationFilter } from './query-builder.ts'
import { getLatestObservation } from './observation-repository.ts'
import { rankUniverseEntities } from './graph-ranking.ts'

export type UniverseQueryIntent = {
  query: UniverseQuery
  summary: string
  parse_source: string
}

function technicalFiltersToObservations(
  tf: SignalIntentSpec['technical_filters'],
): ObservationFilter[] {
  if (!tf) return []
  const out: ObservationFilter[] = []
  if (tf.has_meta_pixel === false) out.push({ attribute: 'meta_pixel', operator: 'eq', value: false })
  if (tf.has_meta_pixel === true) out.push({ attribute: 'meta_pixel', operator: 'eq', value: true })
  if (tf.has_gtm === false) out.push({ attribute: 'google_tag_manager', operator: 'eq', value: false })
  if (tf.has_gtm === true) out.push({ attribute: 'google_tag_manager', operator: 'eq', value: true })
  if (tf.has_ssl === false) out.push({ attribute: 'ssl', operator: 'eq', value: false })
  if (tf.errors_seo === true) out.push({ attribute: 'seo_disaster', operator: 'eq', value: true })
  if (tf.mobile_friendly === false) out.push({ attribute: 'mobile_friendly', operator: 'eq', value: false })
  return out
}

/** Mappa intent MIRAX → query strutturata sul grafo. */
export function signalIntentToUniverseQuery(
  intent: SignalIntentSpec,
  opts?: { city?: string; limit?: number },
): UniverseQueryIntent {
  const city = opts?.city ?? intent.location ?? undefined
  const observations = technicalFiltersToObservations(intent.technical_filters)

  if (intent.business_filters?.revenue_min != null) {
    observations.push({
      attribute: 'revenue',
      operator: 'gte',
      value: intent.business_filters.revenue_min,
    })
  }
  if (intent.business_filters?.employees_min != null) {
    observations.push({
      attribute: 'employees',
      operator: 'gte',
      value: intent.business_filters.employees_min,
    })
  }

  const relationships: UniverseQuery['relationships'] = []

  if (intent.required_signals.includes('hiring')) {
    const role = intent.hiring_roles[0]
    relationships.push({
      relationship_type: 'hires',
      direction: 'outgoing',
      target_entity_type: 'job',
      target_filters: role ? { name_contains: role } : undefined,
    })
  }

  const query: UniverseQuery = {
    entity_type: 'company',
    filters: {
      city,
      name_contains: intent.category ?? undefined,
      observations: observations.length ? observations : undefined,
    },
    relationships: relationships.length ? relationships : undefined,
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
  'phone',
  'email',
  'employees',
  'revenue',
] as const

/** Converte entità grafo → shape lead per ResultsTable (read-only). */
export async function entityToMiraxLeadRow(
  sb: SupabaseClient,
  entity: UniverseEntity,
  attrs: readonly string[] = DEFAULT_OBS_ATTRS,
): Promise<Record<string, unknown>> {
  const latest: Record<string, unknown> = {}
  for (const attr of attrs) {
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
  const ranked = await rankUniverseEntities(sb, entities, intent)
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
