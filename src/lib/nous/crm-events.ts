import type { SupabaseClient } from '@supabase/supabase-js'
import { sendWebhookEnvelope } from './adapters/webhook.ts'
import { buildNousEnvelope, integrationSubscribesToEvent, mapMiraxEventToNous } from './events.ts'

/**
 * Propaga eventi mirax_events verso integrazioni webhook CRM (Zapier/Make).
 */
export async function fanOutMiraxEventToCrmWebhooks(
  supabase: SupabaseClient,
  userId: string,
  eventType: string,
  payload: Record<string, unknown>,
): Promise<{ sent: number; failed: number }> {
  const nousEvent = mapMiraxEventToNous(eventType)

  const { data: integrations } = await supabase
    .from('crm_integrations')
    .select('id, config')
    .eq('user_id', userId)
    .eq('type', 'webhook')
    .eq('is_active', true)

  const list = Array.isArray(integrations) ? integrations : []
  if (list.length === 0) return { sent: 0, failed: 0 }

  const envelope = buildNousEnvelope(nousEvent, { payload })

  let sent = 0
  let failed = 0

  for (const row of list) {
    const cfg =
      row.config && typeof row.config === 'object' ? (row.config as Record<string, unknown>) : {}
    if (!integrationSubscribesToEvent(cfg, nousEvent)) continue

    const result = await sendWebhookEnvelope(cfg, envelope as Record<string, unknown>)
    if (result.ok) sent++
    else failed++
  }

  return { sent, failed }
}
