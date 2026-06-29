/**
 * Fase 8 — Supabase Realtime su universe_events (+ contesto utente).
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { UniverseEvent, UniverseEventType } from '@/lib/universe/types'

export type UniverseRealtimeEvent = UniverseEvent & {
  entity_name?: string | null
}

export function isUniverseRealtimeEnabled(): boolean {
  return process.env.NEXT_PUBLIC_UNIVERSE_REALTIME !== 'false'
}

export function formatUniverseEventHeadline(ev: Pick<UniverseEvent, 'event_type' | 'payload'>): string {
  const p = ev.payload ?? {}
  const summary = typeof p.summary === 'string' ? p.summary : null
  if (summary) return summary.slice(0, 160)
  if (typeof p.job_title === 'string') return p.job_title
  if (typeof p.website === 'string') return `Sito: ${p.website}`
  return ''
}

export function subscribeToUniverseEvents(
  supabase: SupabaseClient,
  callback: (event: UniverseRealtimeEvent) => void,
  opts?: { entityId?: string; eventTypes?: UniverseEventType[] },
): () => void {
  const channel = supabase
    .channel(`mirax_universe_events_${opts?.entityId ?? 'global'}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'universe_events',
      },
      (payload) => {
        const row = payload.new as UniverseRealtimeEvent
        if (!row?.id) return
        if (opts?.entityId && row.entity_id !== opts.entityId) return
        if (opts?.eventTypes?.length && !opts.eventTypes.includes(row.event_type)) return
        callback(row)
      },
    )
    .subscribe()

  return () => {
    void supabase.removeChannel(channel)
  }
}

export function subscribeToUniverseUserContext(
  supabase: SupabaseClient,
  userId: string,
  callback: (row: { entity_id: string; context_type: string }) => void,
): () => void {
  const channel = supabase
    .channel(`mirax_universe_ctx_${userId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'universe_user_context',
        filter: `user_id=eq.${userId}`,
      },
      (payload) => {
        const row = payload.new as { entity_id?: string; context_type?: string }
        if (row?.entity_id && row?.context_type) {
          callback({ entity_id: row.entity_id, context_type: row.context_type })
        }
      },
    )
    .subscribe()

  return () => {
    void supabase.removeChannel(channel)
  }
}

/** Merge evento realtime in lista (dedupe per id). */
export function prependUniverseEvent(
  events: UniverseRealtimeEvent[],
  incoming: UniverseRealtimeEvent,
  max = 50,
): UniverseRealtimeEvent[] {
  if (events.some((e) => e.id === incoming.id)) return events
  return [incoming, ...events].slice(0, max)
}
