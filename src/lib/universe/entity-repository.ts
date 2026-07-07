/**
 * Universe Entity Repository.
 *
 * CRUD + merge + alias resolution for universe_entities.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { UniverseEntity, UniverseEntityAlias, EntityType } from './types.ts'
import { UniverseError, wrapSupabaseError } from './errors.ts'

export interface CreateEntityInput {
  canonical_id: string
  entity_type: EntityType
  name: string
  slug?: string | null
  country?: string | null
  city?: string | null
  region?: string | null
  metadata?: Record<string, unknown>
  confidence?: number
}

export interface UpsertEntityInput extends CreateEntityInput {
  aliases?: Array<{ alias_type: UniverseEntityAlias['alias_type']; alias_value: string; confidence?: number }>
}

export async function createEntity(
  sb: SupabaseClient,
  input: CreateEntityInput
): Promise<UniverseEntity> {
  const now = new Date().toISOString()
  const { data, error } = await sb
    .from('universe_entities')
    .insert({
      canonical_id: input.canonical_id,
      entity_type: input.entity_type,
      name: input.name,
      slug: input.slug,
      country: input.country ?? 'IT',
      city: input.city,
      region: input.region,
      metadata: input.metadata ?? {},
      confidence: input.confidence ?? 1.0,
      first_seen_at: now,
      last_seen_at: now,
    })
    .select()
    .single()

  if (error) {
    if (error.code === '23505') {
      throw new UniverseError('ENTITY_ALREADY_EXISTS', `Entity ${input.entity_type}:${input.canonical_id} already exists`)
    }
    throw wrapSupabaseError(error)
  }

  if (!data) {
    throw new UniverseError('DATABASE_ERROR', 'createEntity returned no data')
  }

  return data as UniverseEntity
}

export async function upsertEntity(
  sb: SupabaseClient,
  input: UpsertEntityInput
): Promise<{ entity: UniverseEntity; is_new: boolean }> {
  const existing = await getEntityByCanonicalId(sb, input.canonical_id, input.entity_type)

  if (existing) {
    const { data, error } = await sb
      .from('universe_entities')
      .update({
        name: input.name,
        slug: input.slug ?? existing.slug,
        country: input.country ?? existing.country,
        city: input.city ?? existing.city,
        region: input.region ?? existing.region,
        metadata: { ...(existing.metadata ?? {}), ...(input.metadata ?? {}) },
        confidence: input.confidence ?? existing.confidence,
        last_seen_at: new Date().toISOString(),
      })
      .eq('id', existing.id)
      .select()
      .single()

    if (error) throw wrapSupabaseError(error)

    // Upsert aliases
    if (input.aliases?.length) {
      await upsertAliases(sb, existing.id, input.aliases)
    }

    return { entity: data as UniverseEntity, is_new: false }
  }

  const entity = await createEntity(sb, input)

  if (input.aliases?.length) {
    await upsertAliases(sb, entity.id, input.aliases)
  }

  return { entity, is_new: true }
}

export async function resolveEntityId(sb: SupabaseClient, entityId: string): Promise<string> {
  const seen = new Set<string>()
  let current = entityId
  while (current && !seen.has(current)) {
    seen.add(current)
    const { data, error } = await sb
      .from('universe_entities')
      .select('merged_into_id')
      .eq('id', current)
      .single()
    if (error?.code === 'PGRST116') return current
    if (error) throw wrapSupabaseError(error)
    if (!data?.merged_into_id) return current
    current = data.merged_into_id as string
  }
  return current
}

export async function getEntityById(sb: SupabaseClient, id: string): Promise<UniverseEntity | null> {
  const resolvedId = await resolveEntityId(sb, id)
  const { data, error } = await sb.from('universe_entities').select('*').eq('id', resolvedId).single()
  if (error?.code === 'PGRST116') return null
  if (error) throw wrapSupabaseError(error)
  return (data as UniverseEntity) ?? null
}

export async function getEntityByCanonicalId(
  sb: SupabaseClient,
  canonicalId: string,
  entityType: EntityType
): Promise<UniverseEntity | null> {
  const { data, error } = await sb
    .from('universe_entities')
    .select('*')
    .eq('canonical_id', canonicalId)
    .eq('entity_type', entityType)
    .single()

  if (error?.code === 'PGRST116') return null
  if (error) throw wrapSupabaseError(error)
  if (!data) return null
  const resolvedId = await resolveEntityId(sb, (data as UniverseEntity).id as string)
  if (resolvedId === (data as UniverseEntity).id) return data as UniverseEntity
  return getEntityById(sb, resolvedId)
}

export async function getEntityByAlias(
  sb: SupabaseClient,
  aliasType: UniverseEntityAlias['alias_type'],
  aliasValue: string,
  entityType?: EntityType
): Promise<UniverseEntity | null> {
  const { data, error } = await sb.rpc('universe_resolve_entity_by_alias', {
    p_alias_type: aliasType,
    p_alias_value: aliasValue,
    p_entity_type: entityType ?? null,
  })

  if (error) throw wrapSupabaseError(error)
  if (!data) return null

  return getEntityById(sb, data as string)
}

export async function listEntities(
  sb: SupabaseClient,
  filters: {
    entity_type?: EntityType
    city?: string
    country?: string
    name_contains?: string
    limit?: number
    offset?: number
  }
): Promise<UniverseEntity[]> {
  let query = sb.from('universe_entities').select('*').is('merged_into_id', null)

  if (filters.entity_type) query = query.eq('entity_type', filters.entity_type)
  if (filters.city) query = query.eq('city', filters.city)
  if (filters.country) query = query.eq('country', filters.country)
  if (filters.name_contains) query = query.ilike('name', `%${filters.name_contains}%`)

  const { data, error } = await query
    .order('last_seen_at', { ascending: false })
    .range(filters.offset ?? 0, (filters.offset ?? 0) + (filters.limit ?? 50) - 1)

  if (error) throw wrapSupabaseError(error)
  return (data as UniverseEntity[]) ?? []
}

function observationDedupKey(input: {
  entity_id: string
  attribute: string
  source: string
  observed_at: string
}): string {
  const day = input.observed_at.slice(0, 10)
  return `${input.entity_id}:${input.attribute}:${input.source}:${day}`
}

function relationshipDedupKey(input: {
  source_entity_id: string
  target_entity_id: string
  relationship_type: string
  observed_at: string
}): string {
  const day = input.observed_at.slice(0, 10)
  return `${input.source_entity_id}:${input.target_entity_id}:${input.relationship_type}:${day}`
}

export async function mergeEntities(
  sb: SupabaseClient,
  sourceId: string,
  targetId: string
): Promise<UniverseEntity> {
  if (sourceId === targetId) {
    throw new UniverseError('MERGE_SELF', 'Cannot merge an entity into itself')
  }

  const source = await getEntityById(sb, sourceId)
  const target = await getEntityById(sb, targetId)
  if (!source || !target) {
    throw new UniverseError('MERGE_MISSING', 'Source or target entity not found')
  }
  if (source.merged_into_id) {
    throw new UniverseError('MERGE_ALREADY', 'Source entity is already merged')
  }

  const now = new Date().toISOString()

  // Move aliases to target.
  const { data: aliases, error: aliasError } = await sb
    .from('universe_entity_aliases')
    .select('*')
    .eq('entity_id', sourceId)
  if (aliasError) throw wrapSupabaseError(aliasError)
  if (aliases && aliases.length > 0) {
    const aliasRows = aliases.map((row) => ({
      entity_id: targetId,
      alias_type: (row as UniverseEntityAlias).alias_type,
      alias_value: (row as UniverseEntityAlias).alias_value,
      confidence: (row as UniverseEntityAlias).confidence ?? 1.0,
    }))
    const { error: aliasUpsertError } = await sb
      .from('universe_entity_aliases')
      .upsert(aliasRows, { onConflict: 'entity_id,alias_type,alias_value' })
    if (aliasUpsertError) throw wrapSupabaseError(aliasUpsertError)
    const { error: aliasDeleteError } = await sb
      .from('universe_entity_aliases')
      .delete()
      .eq('entity_id', sourceId)
    if (aliasDeleteError) throw wrapSupabaseError(aliasDeleteError)
  }

  // Move observations to target with regenerated dedup keys.
  const { data: observations, error: obsError } = await sb
    .from('universe_observations')
    .select('*')
    .eq('entity_id', sourceId)
  if (obsError) throw wrapSupabaseError(obsError)
  if (observations && observations.length > 0) {
    const obsRows = observations.map((row: Record<string, unknown>) => {
      const observed_at = (row.observed_at as string) ?? now
      return {
        entity_id: targetId,
        attribute: row.attribute,
        value: row.value,
        observed_at,
        source: row.source,
        confidence: row.confidence ?? 1.0,
        metadata: row.metadata ?? {},
        dedup_key: observationDedupKey({
          entity_id: targetId,
          attribute: row.attribute as string,
          source: (row.source as string) ?? '',
          observed_at,
        }),
      }
    })
    const { error: obsUpsertError } = await sb
      .from('universe_observations')
      .upsert(obsRows, { onConflict: 'dedup_key' })
    if (obsUpsertError) throw wrapSupabaseError(obsUpsertError)
    const { error: obsDeleteError } = await sb
      .from('universe_observations')
      .delete()
      .eq('entity_id', sourceId)
    if (obsDeleteError) throw wrapSupabaseError(obsDeleteError)
  }

  // Move relationships to target with regenerated dedup keys.
  const { data: relationships, error: relError } = await sb
    .from('universe_relationships')
    .select('*')
    .or(`source_entity_id.eq.${sourceId},target_entity_id.eq.${sourceId}`)
  if (relError) throw wrapSupabaseError(relError)
  if (relationships && relationships.length > 0) {
    const relRows = relationships
      .map((row: Record<string, unknown>) => {
        let src = row.source_entity_id as string
        let tgt = row.target_entity_id as string
        if (src === sourceId) src = targetId
        if (tgt === sourceId) tgt = targetId
        if (src === tgt) return null
        const observed_at = (row.observed_at as string) ?? now
        return {
          source_entity_id: src,
          target_entity_id: tgt,
          relationship_type: row.relationship_type,
          observed_at,
          source: row.source,
          confidence: row.confidence ?? 1.0,
          metadata: row.metadata ?? {},
          dedup_key: relationshipDedupKey({
            source_entity_id: src,
            target_entity_id: tgt,
            relationship_type: row.relationship_type as string,
            observed_at,
          }),
        }
      })
      .filter((r): r is NonNullable<typeof r> => r !== null)
    if (relRows.length > 0) {
      const { error: relUpsertError } = await sb
        .from('universe_relationships')
        .upsert(relRows, { onConflict: 'dedup_key' })
      if (relUpsertError) throw wrapSupabaseError(relUpsertError)
    }
    const { error: relDeleteError } = await sb
      .from('universe_relationships')
      .delete()
      .or(`source_entity_id.eq.${sourceId},target_entity_id.eq.${sourceId}`)
    if (relDeleteError) throw wrapSupabaseError(relDeleteError)
  }

  // Mark source as merged.
  const { data: updated, error: mergeError } = await sb
    .from('universe_entities')
    .update({ merged_into_id: targetId, last_seen_at: now })
    .eq('id', sourceId)
    .select()
    .single()
  if (mergeError) throw wrapSupabaseError(mergeError)
  if (!updated) throw new UniverseError('DATABASE_ERROR', 'mergeEntities returned no data')
  return target
}

async function upsertAliases(
  sb: SupabaseClient,
  entityId: string,
  aliases: Array<{ alias_type: UniverseEntityAlias['alias_type']; alias_value: string; confidence?: number }>
): Promise<void> {
  const rows = aliases.map((a) => ({
    entity_id: entityId,
    alias_type: a.alias_type,
    alias_value: a.alias_value,
    confidence: a.confidence ?? 1.0,
  }))

  const { error } = await sb.from('universe_entity_aliases').upsert(rows, {
    onConflict: 'entity_id, alias_type, alias_value',
    ignoreDuplicates: false,
  })

  if (error) throw wrapSupabaseError(error)
}
