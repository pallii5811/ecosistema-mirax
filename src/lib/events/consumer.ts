import type { SupabaseClient } from '@supabase/supabase-js'
import type { MiraxEventType } from './types'
import { fanOutMiraxEventToCrmWebhooks } from '@/lib/nous/crm-events'

const WEBHOOK_TIMEOUT_MS = 12_000

export type PendingMiraxEvent = {
  id: string
  user_id: string | null
  event_type: string
  payload: Record<string, unknown>
  attempts: number
}

async function fetchUserWebhook(supabase: SupabaseClient, userId: string): Promise<string | null> {
  const { data } = await supabase
    .from('user_integrations')
    .select('webhook_url')
    .eq('user_id', userId)
    .maybeSingle()
  const url = typeof data?.webhook_url === 'string' ? data.webhook_url.trim() : ''
  return url && /^https?:\/\//i.test(url) ? url : null
}

async function postWebhook(url: string, body: Record<string, unknown>): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
    })
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` }
    return { ok: true }
  } catch (e: unknown) {
    return { ok: false, error: e instanceof Error ? e.message : 'Webhook error' }
  }
}

async function createLeadAlert(
  supabase: SupabaseClient,
  userId: string,
  alertType: string,
  title: string,
  body: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await supabase.from('lead_alerts').insert({
    user_id: userId,
    alert_type: alertType,
    title,
    body,
    payload,
    is_read: false,
  })
}

function alertFromEvent(event: PendingMiraxEvent): {
  type: string
  title: string
  body: string
} | null {
  const p = event.payload || {}
  const name = String(p.lead_name ?? p.azienda ?? 'Lead').trim() || 'Lead'

  switch (event.event_type as MiraxEventType) {
    case 'lead.change_detected': {
      const signals = Array.isArray(p.changes)
        ? p.changes.map((c) => (c && typeof c === 'object' ? String((c as any).signal ?? '') : '')).filter(Boolean)
        : []
      return {
        type: 'lead_change',
        title: `Cambiamento rilevato: ${name}`,
        body: signals.length > 0 ? signals.slice(0, 3).join(' · ') : 'Il profilo tecnico del lead è cambiato.',
      }
    }
    case 'lead.reaudited':
      return {
        type: 'lead_reaudited',
        title: `Re-audit completato: ${name}`,
        body: 'I dati tecnici del lead sono stati aggiornati.',
      }
    case 'outreach.sent':
      return {
        type: 'outreach_sent',
        title: `Outreach registrato: ${name}`,
        body: `Canale: ${String(p.channel ?? 'n/d')}`,
      }
    case 'sequence.email_sent':
      return {
        type: 'sequence_email',
        title: `Email sequenza inviata`,
        body: `A: ${String(p.recipient_email ?? p.recipient_name ?? 'destinatario')}`,
      }
    default:
      return null
  }
}

/** Processa eventi pending: webhook outbound + alert in-app. */
export async function processMiraxEvents(
  supabase: SupabaseClient,
  events: PendingMiraxEvent[],
): Promise<{ processed: number; failed: number }> {
  let processed = 0
  let failed = 0

  for (const event of events) {
    let ok = true
    let errMsg: string | undefined

    if (event.user_id) {
      const alert = alertFromEvent(event)
      if (alert) {
        try {
          await createLeadAlert(supabase, event.user_id, alert.type, alert.title, alert.body, {
            event_id: event.id,
            event_type: event.event_type,
            ...event.payload,
          })
        } catch {
          /* best-effort */
        }
      }

      const webhookUrl = await fetchUserWebhook(supabase, event.user_id)
      if (webhookUrl) {
        const wh = await postWebhook(webhookUrl, {
          event: event.event_type,
          version: '1.0',
          source: 'mirax',
          payload: event.payload,
          event_id: event.id,
          created_at: new Date().toISOString(),
        })
        if (!wh.ok) {
          ok = false
          errMsg = wh.error
        }
      }

      const crmFanOut = await fanOutMiraxEventToCrmWebhooks(
        supabase,
        event.user_id,
        event.event_type,
        event.payload ?? {},
      )
      if (crmFanOut.failed > 0 && crmFanOut.sent === 0) {
        ok = false
        errMsg = errMsg || 'CRM webhook fan-out failed'
      }
    }

    const update = ok
      ? { status: 'processed', processed_at: new Date().toISOString(), error_message: null }
      : {
          status: event.attempts >= 2 ? 'failed' : 'pending',
          attempts: event.attempts + 1,
          error_message: errMsg ?? 'process failed',
        }

    await supabase.from('mirax_events').update(update).eq('id', event.id)

    if (ok) processed++
    else failed++
  }

  return { processed, failed }
}
