/**
 * Fase 9 — Alerting: eventi grafo → lead_alerts per utenti interessati.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { UniverseEvent, UniverseEventType } from './types.ts'
import { getEntityById } from './entity-repository.ts'
import { labelEvent } from './labels.ts'

function formatEventHeadline(ev: Pick<UniverseEvent, 'event_type' | 'payload'>): string {
  const p = ev.payload ?? {}
  const summary = typeof p.summary === 'string' ? p.summary : null
  if (summary) return summary.slice(0, 160)
  if (typeof p.job_title === 'string') return p.job_title
  if (typeof p.website === 'string') return `Sito: ${p.website}`
  return ''
}

export const UNIVERSE_ALERT_TYPES = new Set<UniverseEventType>([
  'new_hiring',
  'tender_won',
  'funding_received',
  'website_changed',
  'registry_change',
  'crm_installed',
  'pixel_removed',
  'revenue_changed',
  'employees_changed',
])

export function isUniverseAlertingEnabled(): boolean {
  return process.env.UNIVERSE_ALERTS_ENABLED === '1' || process.env.UNIVERSE_ENABLED === '1'
}

async function findAlertUserIds(sb: SupabaseClient, entityId: string, domain: string | null): Promise<string[]> {
  const ids = new Set<string>()

  const { data: ctxRows } = await sb
    .from('universe_user_context')
    .select('user_id')
    .eq('entity_id', entityId)
    .in('context_type', ['saved', 'pipeline', 'contacted'])

  for (const row of ctxRows ?? []) {
    if (row?.user_id) ids.add(row.user_id)
  }

  if (domain) {
    const { data: monitors } = await sb
      .from('lead_monitors')
      .select('user_id, lead_website')
      .ilike('lead_website', `%${domain.replace(/^www\./, '')}%`)
      .limit(50)

    for (const row of monitors ?? []) {
      if (row?.user_id) ids.add(row.user_id)
    }
  }

  return [...ids]
}

export type UniverseAlertDispatchResult = {
  ok: boolean
  notified: number
  skipped: boolean
  user_ids: string[]
  error?: string
}

export async function dispatchUniverseEventAlerts(
  sb: SupabaseClient,
  event: UniverseEvent,
): Promise<UniverseAlertDispatchResult> {
  if (!isUniverseAlertingEnabled()) return { ok: true, notified: 0, skipped: true, user_ids: [] }
  if (!UNIVERSE_ALERT_TYPES.has(event.event_type)) return { ok: true, notified: 0, skipped: true, user_ids: [] }
  if (!event.entity_id) return { ok: true, notified: 0, skipped: true, user_ids: [] }

  const entity = await getEntityById(sb, event.entity_id)
  if (!entity) return { ok: true, notified: 0, skipped: true, user_ids: [] }

  const domain =
    entity.entity_type === 'company' && entity.canonical_id.includes('.')
      ? entity.canonical_id
      : null

  const userIds = await findAlertUserIds(sb, event.entity_id, domain)
  if (!userIds.length) return { ok: true, notified: 0, skipped: false, user_ids: [] }

  const headline = formatEventHeadline(event)
  const title = `Grafo · ${labelEvent(event.event_type)} — ${entity.name}`
  const body = headline || `Nuovo segnale sul Knowledge Graph per ${entity.name}.`

  const rows = userIds.map((user_id) => ({
    user_id,
    alert_type: 'universe_graph',
    event_id: event.id,
    title,
    body,
    payload: {
      entity_id: event.entity_id,
      event_id: event.id,
      event_type: event.event_type,
      entity_name: entity.name,
      canonical_id: entity.canonical_id,
      occurred_at: event.occurred_at,
      source: event.source,
    },
    is_read: false,
  }))

  const { error } = await sb.from('lead_alerts').insert(rows)
  if (error) {
    console.warn('[universe/alerting] insert failed:', error.message)
    return { ok: false, notified: 0, skipped: false, user_ids: userIds, error: error.message }
  }

  return { ok: true, notified: rows.length, skipped: false, user_ids: userIds }
}
