/**
 * Fase 7 — Digital Twin: snapshot unificato entità + grafo + contesto utente.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  RelatedEntity,
  UniverseEntity,
  UniverseEvent,
  UniverseUserContext,
} from './types.ts'
import { getEntityById } from './entity-repository.ts'
import { getTimeline } from './observation-repository.ts'
import { getRelatedEntities, getSubgraph } from './relationship-repository.ts'
import { getEvents } from './event-repository.ts'
import { entityToMiraxLeadRow } from './agentic-search.ts'
import { listUserContextForEntity } from './user-context-repository.ts'

export type TwinAttributeSnapshot = {
  value: unknown
  observed_at: string
  source: string
  confidence: number
}

export type TwinRelatedItem = {
  entity_id: string
  name: string
  entity_type: string
  observed_at: string
  metadata?: Record<string, unknown>
}

export type DigitalTwinSnapshot = {
  entity_id: string
  entity: UniverseEntity
  lead_row: Record<string, unknown>
  opportunity_score: number
  attributes: Record<string, TwinAttributeSnapshot>
  tech_stack: TwinRelatedItem[]
  hiring: TwinRelatedItem[]
  people: TwinRelatedItem[]
  competitors: TwinRelatedItem[]
  events_recent: UniverseEvent[]
  user_context: UniverseUserContext[]
  graph: { nodes: number; edges: number }
  assembled_at: string
}

/** ponytail: score duplicato da ResultsTable — estrarre in lib/scoring se cresce */
function opportunityScoreFromLead(obj: Record<string, unknown>): number {
  let score = 0
  const stack = Array.isArray(obj.tech_stack)
    ? obj.tech_stack.filter((v) => typeof v === 'string').join(' ').toLowerCase()
    : ''
  const tr = obj.technical_report && typeof obj.technical_report === 'object'
    ? (obj.technical_report as Record<string, unknown>)
    : null

  if (obj.meta_pixel !== true || stack.includes('no pixel') || stack.includes('missing fb pixel')) score += 25
  if ((!obj.sito && !obj.website) || stack.includes('no website')) score += 30
  if (!obj.instagram) score += 15
  if (tr?.seo_disaster === true || stack.includes('disastro seo')) score += 20
  if (tr?.has_dmarc === false || stack.includes('no dmarc')) score += 10
  return Math.min(score, 100)
}

function mapRelated(related: RelatedEntity[], type: string): TwinRelatedItem[] {
  return related
    .filter((r) => r.relationship_type === type)
    .map((r) => ({
      entity_id: r.related_entity_id,
      name: r.related_entity_name,
      entity_type: r.related_entity_type,
      observed_at: r.observed_at,
    }))
}

function collapseTimeline(
  timeline: Awaited<ReturnType<typeof getTimeline>>,
): Record<string, TwinAttributeSnapshot> {
  const out: Record<string, TwinAttributeSnapshot> = {}
  for (const p of timeline) {
    if (out[p.attribute]) continue
    out[p.attribute] = {
      value: p.value,
      observed_at: p.observed_at,
      source: p.source,
      confidence: p.confidence,
    }
  }
  return out
}

/** Assembla Digital Twin completo per un'entità. */
export async function buildDigitalTwin(
  sb: SupabaseClient,
  entityId: string,
  opts?: { userId?: string; eventLimit?: number },
): Promise<DigitalTwinSnapshot | null> {
  const entity = await getEntityById(sb, entityId)
  if (!entity || entity.merged_into_id) return null

  const [timeline, related, events, lead_row, subgraph, user_context] = await Promise.all([
    getTimeline(sb, entityId),
    getRelatedEntities(sb, entityId),
    getEvents(sb, { entity_id: entityId, limit: opts?.eventLimit ?? 20 }),
    entityToMiraxLeadRow(sb, entity),
    getSubgraph(sb, entityId, 1),
    opts?.userId ? listUserContextForEntity(sb, opts.userId, entityId) : Promise.resolve([]),
  ])

  const attributes = collapseTimeline(timeline)
  const tech_stack = mapRelated(related, 'uses')
  if (tech_stack.length) {
    lead_row.tech_stack = tech_stack.map((t) => t.name)
  }

  return {
    entity_id: entityId,
    entity,
    lead_row,
    opportunity_score: opportunityScoreFromLead(lead_row),
    attributes,
    tech_stack,
    hiring: mapRelated(related, 'hires'),
    people: mapRelated(related, 'has'),
    competitors: mapRelated(related, 'competes_with'),
    events_recent: events,
    user_context,
    graph: { nodes: subgraph.nodes.length, edges: subgraph.edges.length },
    assembled_at: new Date().toISOString(),
  }
}
