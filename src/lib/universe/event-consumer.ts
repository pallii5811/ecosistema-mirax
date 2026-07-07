/**
 * Fase 8–10 — Consumer: alerting + webhooks + archive + cache purge.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { dispatchUniverseEventAlerts } from './alerting.ts'
import { archiveOldUniverseEvents } from './event-archive.ts'
import { getEvents, getEventById, markEventProcessed } from './event-repository.ts'
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
    if (!ev.id) {
      console.warn('[universe/event-consumer] event without id, skipping')
      continue
    }

    // Idempotency guard: re-fetch the event inside the loop so concurrent or
    // repeated runs never double-process the same row.
    const fresh = await getEventById(sb, ev.id)
    if (!fresh) {
      console.warn(`[universe/event-consumer] event ${ev.id} not found during processing, skipping`)
      continue
    }
    if (fresh.processed === true || fresh.processed_at) {
      console.log(`[universe/event-consumer] event ${ev.id} already processed, skipping`)
      continue
    }

    by_type[ev.event_type] = (by_type[ev.event_type] ?? 0) + 1

    try {
      const alert = await dispatchUniverseEventAlerts(sb, ev)
      alerts_sent += alert.notified

      if (!alert.ok) {
        throw new Error(alert.error ?? `alerting failed for event ${ev.id}`)
      }

      if (alert.user_ids.length && ev.entity_id) {
        const entity = await getEntityById(sb, ev.entity_id)
        if (entity) {
          const wh = await dispatchUniverseEventWebhooks(sb, ev, entity, alert.user_ids)
          webhooks_sent += wh.delivered
          webhooks_failed += wh.errors

          if (!wh.ok) {
            const firstError = wh.details.find((d) => !d.ok)?.error ?? 'webhook delivery failed'
            throw new Error(firstError)
          }
        }
      }

      await markEventProcessed(sb, ev.id)
      processed++
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(`[universe/event-consumer] event ${ev.id} failed: ${message}`)
      failed++
      await markEventProcessed(sb, ev.id, { error: message, incrementError: true })
    }
  }

  let cache_purged = 0
  let events_archived = 0
  try {
    cache_purged = await purgeExpiredQueryCache(sb)
  } catch (err: unknown) {
    console.warn('[universe/event-consumer] cache purge failed:', err instanceof Error ? err.message : String(err))
  }
  try {
    events_archived = await archiveOldUniverseEvents(sb)
  } catch (err: unknown) {
    console.warn('[universe/event-consumer] archive failed:', err instanceof Error ? err.message : String(err))
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
