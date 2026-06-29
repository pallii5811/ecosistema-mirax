/**
 * Fase 10 — Archivio eventi grafo (retention / pseudo-partitioning).
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { wrapSupabaseError } from './errors.ts'

export function universeArchiveDays(): number {
  return Math.max(30, Number(process.env.UNIVERSE_EVENTS_ARCHIVE_DAYS) || 180)
}

export async function archiveOldUniverseEvents(sb: SupabaseClient): Promise<number> {
  const days = universeArchiveDays()
  const { data, error } = await sb.rpc('universe_archive_old_events', { p_days: days })
  if (!error && typeof data === 'number') return data

  if (error && !/universe_archive_old_events|does not exist/i.test(error.message)) {
    throw wrapSupabaseError(error)
  }
  return 0
}
