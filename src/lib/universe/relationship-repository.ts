/**
 * Universe Relationship Repository.
 *
 * Graph edges between entities.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { UniverseRelationship, RelationshipType, RelatedEntity, EntityGraphEdge, EntityGraphNode } from './types.ts'
import { wrapSupabaseError } from './errors.ts'

export interface CreateRelationshipInput {
  source_entity_id: string
  target_entity_id: string
  relationship_type: RelationshipType
  observed_at?: string
  source: string
  confidence?: number
  metadata?: Record<string, unknown>
}

export async function createRelationship(
  sb: SupabaseClient,
  input: CreateRelationshipInput
): Promise<UniverseRelationship> {
  const { data, error } = await sb
    .from('universe_relationships')
    .insert({
      source_entity_id: input.source_entity_id,
      target_entity_id: input.target_entity_id,
      relationship_type: input.relationship_type,
      observed_at: input.observed_at ?? new Date().toISOString(),
      source: input.source,
      confidence: input.confidence ?? 1.0,
      metadata: input.metadata ?? {},
    })
    .select()
    .single()

  if (error) throw wrapSupabaseError(error)
  return data as UniverseRelationship
}

export async function createRelationships(
  sb: SupabaseClient,
  inputs: CreateRelationshipInput[]
): Promise<UniverseRelationship[]> {
  if (inputs.length === 0) return []

  const now = new Date().toISOString()
  const rows = inputs.map((input) => ({
    source_entity_id: input.source_entity_id,
    target_entity_id: input.target_entity_id,
    relationship_type: input.relationship_type,
    observed_at: input.observed_at ?? now,
    source: input.source,
    confidence: input.confidence ?? 1.0,
    metadata: input.metadata ?? {},
  }))

  const { data, error } = await sb.from('universe_relationships').upsert(rows, {
    onConflict: 'source_entity_id, target_entity_id, relationship_type',
    ignoreDuplicates: false,
  })

  if (error) throw wrapSupabaseError(error)
  return (data ?? []) as UniverseRelationship[]
}

export async function getRelatedEntities(
  sb: SupabaseClient,
  entityId: string,
  relationshipType?: RelationshipType
): Promise<RelatedEntity[]> {
  const { data, error } = await sb.rpc('universe_related_entities', {
    p_entity_id: entityId,
    p_relationship_type: relationshipType ?? null,
  })

  if (error) throw wrapSupabaseError(error)
  return (data as RelatedEntity[]) ?? []
}

export async function getSubgraph(
  sb: SupabaseClient,
  entityId: string,
  depth = 1
): Promise<{ nodes: EntityGraphNode[]; edges: EntityGraphEdge[] }> {
  const direct = await getRelatedEntities(sb, entityId)
  const relatedIds = new Set(direct.map((r) => r.related_entity_id))
  relatedIds.add(entityId)

  const allEntityIds = Array.from(relatedIds)
  const { data: entities, error: entitiesError } = await sb
    .from('universe_entities')
    .select('id, entity_type, name, city, country')
    .in('id', allEntityIds)

  if (entitiesError) throw wrapSupabaseError(entitiesError)

  const nodes: EntityGraphNode[] = (entities ?? []).map((e) => ({
    id: e.id,
    entity_type: e.entity_type,
    name: e.name,
    city: e.city,
    country: e.country,
  }))

  const edges: EntityGraphEdge[] = direct.map((r) => ({
    source: entityId,
    target: r.related_entity_id,
    relationship_type: r.relationship_type,
  }))

  // Depth 2: fetch relationships between related entities (optional, limited)
  if (depth >= 2 && relatedIds.size > 1) {
    const { data: secondEdges, error: secondError } = await sb
      .from('universe_relationships')
      .select('source_entity_id, target_entity_id, relationship_type')
      .in('source_entity_id', allEntityIds)
      .in('target_entity_id', allEntityIds)
      .limit(100)

    if (secondError) throw wrapSupabaseError(secondError)

    for (const e of secondEdges ?? []) {
      if (!edges.some((edge) => edge.source === e.source_entity_id && edge.target === e.target_entity_id)) {
        edges.push({
          source: e.source_entity_id,
          target: e.target_entity_id,
          relationship_type: e.relationship_type as RelationshipType,
        })
      }
    }
  }

  return { nodes, edges }
}
