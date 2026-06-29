/**
 * Costruisce nodi/archi per visualizzazione grafo (city / entity focus).
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { EntityGraphEdge, EntityGraphNode, EntityType } from './types.ts'
import { listEntities } from './entity-repository.ts'
import { getSubgraph } from './relationship-repository.ts'
import { wrapSupabaseError } from './errors.ts'

export type GraphViewPayload = {
  nodes: EntityGraphNode[]
  edges: EntityGraphEdge[]
  focus_entity_id: string | null
  city: string | null
}

export async function buildCityGraphView(
  sb: SupabaseClient,
  opts: { city?: string; name_contains?: string; limit?: number },
): Promise<GraphViewPayload> {
  const limit = Math.min(80, Math.max(5, opts.limit ?? 40))
  const entities = await listEntities(sb, {
    entity_type: 'company' as EntityType,
    city: opts.city,
    name_contains: opts.name_contains,
    limit,
  })

  if (!entities.length) {
    return { nodes: [], edges: [], focus_entity_id: null, city: opts.city ?? null }
  }

  const ids = entities.map((e) => e.id)
  const { data: relRows, error } = await sb
    .from('universe_relationships')
    .select('source_entity_id, target_entity_id, relationship_type')
    .or(`source_entity_id.in.(${ids.join(',')}),target_entity_id.in.(${ids.join(',')})`)
    .limit(200)

  if (error) throw wrapSupabaseError(error)

  const nodeMap = new Map<string, EntityGraphNode>()
  for (const e of entities) {
    nodeMap.set(e.id, {
      id: e.id,
      entity_type: e.entity_type,
      name: e.name,
      city: e.city,
      country: e.country,
    })
  }

  const edges: EntityGraphEdge[] = []
  for (const r of relRows ?? []) {
    const src = r.source_entity_id as string
    const tgt = r.target_entity_id as string
    if (!nodeMap.has(src) || !nodeMap.has(tgt)) continue
    edges.push({
      source: src,
      target: tgt,
      relationship_type: r.relationship_type,
    })
  }

  return {
    nodes: Array.from(nodeMap.values()),
    edges,
    focus_entity_id: null,
    city: opts.city ?? null,
  }
}

export async function buildEntityGraphView(
  sb: SupabaseClient,
  entityId: string,
  depth = 2,
): Promise<GraphViewPayload> {
  const { nodes, edges } = await getSubgraph(sb, entityId, depth)
  const entity = nodes.find((n) => n.id === entityId)
  return {
    nodes,
    edges,
    focus_entity_id: entityId,
    city: entity?.city ?? null,
  }
}
