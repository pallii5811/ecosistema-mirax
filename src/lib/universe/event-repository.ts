/**
 * Universe Event Repository.
 *
 * Append-only event stream.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { UniverseEvent, UniverseEventType } from './types.ts'
import { wrapSupabaseError } from './errors.ts'

export interface CreateEventInput {
  entity_id?: string | null
  event_type: UniverseEventType
  payload: Record<string, unknown>
  occurred_at?: string
  source: string
}

export async function appendEvent(sb: SupabaseClient, input: CreateEventInput): Promise<UniverseEvent> {
  const { data, error } = await sb
    .from('universe_events')
    .insert({
      entity_id: input.entity_id ?? null,
      event_type: input.event_type,
      payload: input.payload,
      occurred_at: input.occurred_at ?? new Date().toISOString(),
      source: input.source,
      processed: false,
      error_count: 0,
    })
    .select()
    .single()

  if (error) throw wrapSupabaseError(error)
  return data as UniverseEvent
}

export async function appendEvents(sb: SupabaseClient, inputs: CreateEventInput[]): Promise<UniverseEvent[]> {
  if (inputs.length === 0) return []

  const now = new Date().toISOString()
  const rows = inputs.map((input) => ({
    entity_id: input.entity_id ?? null,
    event_type: input.event_type,
    payload: input.payload,
    occurred_at: input.occurred_at ?? now,
    source: input.source,
    processed: false,
    error_count: 0,
  }))

  const { data, error } = await sb.from('universe_events').insert(rows).select()
  if (error) throw wrapSupabaseError(error)
  return (data as UniverseEvent[]) ?? []
}

export async function getEvents(
  sb: SupabaseClient,
  filters: {
    entity_id?: string
    event_type?: UniverseEventType
    processed?: boolean
    limit?: number
    offset?: number
  }
): Promise<UniverseEvent[]> {
  let query = sb.from('universe_events').select('*')

  if (filters.entity_id) query = query.eq('entity_id', filters.entity_id)
  if (filters.event_type) query = query.eq('event_type', filters.event_type)
  if (typeof filters.processed === 'boolean') query = query.eq('processed', filters.processed)

  const { data, error } = await query
    .order('occurred_at', { ascending: false })
    .range(filters.offset ?? 0, (filters.offset ?? 0) + (filters.limit ?? 50) - 1)

  if (error) throw wrapSupabaseError(error)
  return (data as UniverseEvent[]) ?? []
}

export async function markEventProcessed(
  sb: SupabaseClient,
  eventId: string,
  options?: { error?: string; incrementError?: boolean }
): Promise<void> {
  const updates: Record<string, unknown> = {
    processed_at: new Date().toISOString(),
    processed: !options?.error,
  }

  if (options?.incrementError) {
    updates.error_count = sb.rpc('increment_event_error_count', { p_event_id: eventId })
    updates.error_message = options.error ?? null
  }

  const { error } = await sb.from('universe_events').update(updates).eq('id', eventId)
  if (error) throw wrapSupabaseError(error)
}
