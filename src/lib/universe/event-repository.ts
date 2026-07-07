/**
 * Universe Event Repository.
 *
 * Append-only event stream.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { UniverseEvent, UniverseEventType } from './types.ts'
import { wrapSupabaseError } from './errors.ts'
import { stablePayloadHash } from './hash.server.ts'

export interface CreateEventInput {
  entity_id?: string | null
  event_type: UniverseEventType
  payload: Record<string, unknown>
  occurred_at?: string
  source: string
}

function eventDedupKey(input: {
  entity_id: string | null
  event_type: string
  source: string
  occurred_at: string
  payload: Record<string, unknown>
}): string {
  const day = input.occurred_at.slice(0, 10)
  const payloadHash = stablePayloadHash(input.payload)
  return `${input.entity_id ?? 'none'}:${input.event_type}:${input.source}:${day}:${payloadHash}`
}

export async function appendEvent(sb: SupabaseClient, input: CreateEventInput): Promise<UniverseEvent> {
  const occurred_at = input.occurred_at ?? new Date().toISOString()
  const { data, error } = await sb
    .from('universe_events')
    .upsert(
      {
        entity_id: input.entity_id ?? null,
        event_type: input.event_type,
        payload: input.payload,
        occurred_at,
        source: input.source,
        processed: false,
        error_count: 0,
        dedup_key: eventDedupKey({
          entity_id: input.entity_id ?? null,
          event_type: input.event_type,
          source: input.source,
          occurred_at,
          payload: input.payload,
        }),
      },
      { onConflict: 'dedup_key' }
    )
    .select()
    .single()

  if (error) throw wrapSupabaseError(error)
  return data as UniverseEvent
}

export async function appendEvents(sb: SupabaseClient, inputs: CreateEventInput[]): Promise<UniverseEvent[]> {
  if (inputs.length === 0) return []

  const now = new Date().toISOString()
  const rows = inputs.map((input) => {
    const occurred_at = input.occurred_at ?? now
    return {
      entity_id: input.entity_id ?? null,
      event_type: input.event_type,
      payload: input.payload,
      occurred_at,
      source: input.source,
      processed: false,
      error_count: 0,
      dedup_key: eventDedupKey({
        entity_id: input.entity_id ?? null,
        event_type: input.event_type,
        source: input.source,
        occurred_at,
        payload: input.payload,
      }),
    }
  })

  const { data, error } = await sb.from('universe_events').upsert(rows, { onConflict: 'dedup_key' }).select()
  if (error) throw wrapSupabaseError(error)
  return (data as UniverseEvent[]) ?? []
}

export async function getEventById(sb: SupabaseClient, eventId: string): Promise<UniverseEvent | null> {
  const { data, error } = await sb.from('universe_events').select('*').eq('id', eventId).single()
  if (error?.code === 'PGRST116') return null
  if (error) throw wrapSupabaseError(error)
  return (data as UniverseEvent) ?? null
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
