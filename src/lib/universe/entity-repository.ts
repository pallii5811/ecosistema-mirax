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

export async function getEntityById(sb: SupabaseClient, id: string): Promise<UniverseEntity | null> {
  const { data, error } = await sb.from('universe_entities').select('*').eq('id', id).single()
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
    .is('merged_into_id', null)
    .single()

  if (error?.code === 'PGRST116') return null
  if (error) throw wrapSupabaseError(error)
  return (data as UniverseEntity) ?? null
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

export async function mergeEntities(
  sb: SupabaseClient,
  sourceId: string,
  targetId: string
): Promise<void> {
  if (sourceId === targetId) return

  const { error } = await sb
    .from('universe_entities')
    .update({ merged_into_id: targetId, updated_at: new Date().toISOString() })
    .eq('id', sourceId)

  if (error) throw wrapSupabaseError(error)
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
