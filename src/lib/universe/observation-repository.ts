/**
 * Universe Observation Repository.
 *
 * Temporal facts about entities.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { UniverseObservation, TimelinePoint } from './types.ts'
import { wrapSupabaseError } from './errors.ts'

export interface CreateObservationInput {
  entity_id: string
  attribute: string
  value: unknown
  observed_at?: string
  source: string
  confidence?: number
  metadata?: Record<string, unknown>
}

export async function createObservation(
  sb: SupabaseClient,
  input: CreateObservationInput
): Promise<UniverseObservation> {
  const { data, error } = await sb
    .from('universe_observations')
    .insert({
      entity_id: input.entity_id,
      attribute: input.attribute,
      value: input.value,
      observed_at: input.observed_at ?? new Date().toISOString(),
      source: input.source,
      confidence: input.confidence ?? 1.0,
      metadata: input.metadata ?? {},
    })
    .select()
    .single()

  if (error) throw wrapSupabaseError(error)
  return data as UniverseObservation
}

export async function createObservations(
  sb: SupabaseClient,
  inputs: CreateObservationInput[]
): Promise<UniverseObservation[]> {
  if (inputs.length === 0) return []

  const now = new Date().toISOString()
  const rows = inputs.map((input) => ({
    entity_id: input.entity_id,
    attribute: input.attribute,
    value: input.value,
    observed_at: input.observed_at ?? now,
    source: input.source,
    confidence: input.confidence ?? 1.0,
    metadata: input.metadata ?? {},
  }))

  const { data, error } = await sb.from('universe_observations').insert(rows).select()
  if (error) throw wrapSupabaseError(error)
  return (data as UniverseObservation[]) ?? []
}

export async function getLatestObservation(
  sb: SupabaseClient,
  entityId: string,
  attribute: string
): Promise<UniverseObservation | null> {
  const { data, error } = await sb
    .from('universe_observations')
    .select('*')
    .eq('entity_id', entityId)
    .eq('attribute', attribute)
    .order('observed_at', { ascending: false })
    .limit(1)
    .single()

  if (error?.code === 'PGRST116') return null
  if (error) throw wrapSupabaseError(error)
  return (data as UniverseObservation) ?? null
}

export async function getTimeline(
  sb: SupabaseClient,
  entityId: string,
  attribute?: string
): Promise<TimelinePoint[]> {
  let query = sb.from('universe_observations').select('*').eq('entity_id', entityId)
  if (attribute) query = query.eq('attribute', attribute)

  const { data, error } = await query.order('observed_at', { ascending: false }).limit(200)
  if (error) throw wrapSupabaseError(error)

  return ((data as UniverseObservation[]) ?? []).map((o) => ({
    attribute: o.attribute,
    value: o.value,
    observed_at: o.observed_at,
    source: o.source,
    confidence: o.confidence ?? 1.0,
  }))
}

export async function getObservationAtTime(
  sb: SupabaseClient,
  entityId: string,
  attribute: string,
  timestamp: string
): Promise<UniverseObservation | null> {
  const { data, error } = await sb
    .from('universe_observations')
    .select('*')
    .eq('entity_id', entityId)
    .eq('attribute', attribute)
    .lte('observed_at', timestamp)
    .order('observed_at', { ascending: false })
    .limit(1)
    .single()

  if (error?.code === 'PGRST116') return null
  if (error) throw wrapSupabaseError(error)
  return (data as UniverseObservation) ?? null
}
