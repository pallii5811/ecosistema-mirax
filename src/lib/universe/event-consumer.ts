/**
 * Fase 8–10 — Consumer: alerting + webhooks + archive + cache purge.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { dispatchUniverseEventAlerts } from './alerting.ts'
import { archiveOldUniverseEvents } from './event-archive.ts'
import { getEvents, markEventProcessed } from './event-repository.ts'
import { getEntityById } from './entity-repository.ts'
import { purgeExpiredQueryCache } from './query-cache.ts'
import { dispatchUniverseEventWebhooks } from './webhooks.ts'

export type UniverseEventProcessResult = {
  fetched: number
  processed: number
  failed: number
  alerts_sent: number
  webhooks_sent: number
  webhooks_failed: number
  events_archived: number
  cache_purged: number
  by_type: Record<string, number>
}

export async function processUniverseEventBatch(
  sb: SupabaseClient,
  limit = 50,
): Promise<UniverseEventProcessResult> {
  const events = await getEvents(sb, { processed: false, limit })
  const by_type: Record<string, number> = {}
  let processed = 0
  let failed = 0
  let alerts_sent = 0
  let webhooks_sent = 0
  let webhooks_failed = 0

  for (const ev of events) {
    if (!ev.id) continue
    try {
      by_type[ev.event_type] = (by_type[ev.event_type] ?? 0) + 1
      const alert = await dispatchUniverseEventAlerts(sb, ev)
      alerts_sent += alert.notified

      if (alert.user_ids.length && ev.entity_id) {
        const entity = await getEntityById(sb, ev.entity_id)
        if (entity) {
          const wh = await dispatchUniverseEventWebhooks(sb, ev, entity, alert.user_ids)
          webhooks_sent += wh.sent
          webhooks_failed += wh.failed
        }
      }

      await markEventProcessed(sb, ev.id)
      processed++
    } catch {
      failed++
    }
  }

  let cache_purged = 0
  let events_archived = 0
  try {
    cache_purged = await purgeExpiredQueryCache(sb)
  } catch {
    /* ignore */
  }
  try {
    events_archived = await archiveOldUniverseEvents(sb)
  } catch {
    /* ignore */
  }

  return {
    fetched: events.length,
    processed,
    failed,
    alerts_sent,
    webhooks_sent,
    webhooks_failed,
    events_archived,
    cache_purged,
    by_type,
  }
}
