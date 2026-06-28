import type { SupabaseClient } from '@supabase/supabase-js'
import type { MiraxEventPayload, MiraxEventType } from './types'

export async function emitMiraxEvent(
  supabase: SupabaseClient,
  opts: {
    userId?: string | null
    eventType: MiraxEventType
    payload?: MiraxEventPayload
  },
): Promise<{ ok: boolean; id?: string; skipped?: boolean }> {
  const row = {
    user_id: opts.userId ?? null,
    event_type: opts.eventType,
    payload: opts.payload ?? {},
    status: 'pending',
  }

  const { data, error } = await supabase.from('mirax_events').insert(row).select('id').maybeSingle()

  if (error) {
    if (/relation .* does not exist|mirax_events/i.test(error.message)) {
      return { ok: false, skipped: true }
    }
    throw error
  }

  return { ok: true, id: data?.id as string | undefined }
}
