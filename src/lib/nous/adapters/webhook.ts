import crypto from 'crypto'
import { buildNousEnvelope, NOUS_EVENTS } from '../events.ts'
import type { AdapterDispatchInput, LeadDispatchResult, NousAdapter } from '../types.ts'

const TIMEOUT_MS = 25_000

export const webhookAdapter: NousAdapter = {
  type: 'webhook',
  async dispatch(input: AdapterDispatchInput): Promise<LeadDispatchResult[]> {
    const cfg = input.integration.config ?? {}
    const url = typeof cfg.url === 'string' ? cfg.url : ''
    const secret = typeof cfg.secret === 'string' ? cfg.secret : ''
    const customHeaders = cfg.headers && typeof cfg.headers === 'object' ? (cfg.headers as Record<string, string>) : {}

    if (!url) {
      return input.leads.map((l, index) => ({
        index,
        lead_nome: l.nome,
        status: 'error',
        error: 'Missing webhook url',
      }))
    }

    const event =
      input.event ||
      (input.leads.length === 1 ? NOUS_EVENTS.LEAD_EXPORTED : NOUS_EVENTS.LEADS_EXPORTED)

    const envelope = buildNousEnvelope(event, { leads: input.leads })
    const payload = JSON.stringify(envelope)

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'User-Agent': 'MIRAX-NOUS/1.0',
      ...customHeaders,
    }

    if (secret) {
      const signature = crypto.createHmac('sha256', secret).update(payload).digest('hex')
      headers['X-MiraX-Signature'] = `sha256=${signature}`
    }

    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS)
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: payload,
        signal: controller.signal,
      }).finally(() => clearTimeout(timeout))

      const ok = res.ok
      const msg = ok ? undefined : `HTTP ${res.status}`

      return input.leads.map((l, index) => ({
        index,
        lead_nome: l.nome,
        status: ok ? 'success' : 'error',
        error: msg,
      }))
    } catch (err: unknown) {
      const msg =
        err instanceof Error && err.name === 'AbortError'
          ? 'Timeout webhook'
          : err instanceof Error
            ? err.message
            : 'Webhook failed'
      return input.leads.map((l, index) => ({
        index,
        lead_nome: l.nome,
        status: 'error',
        error: msg,
      }))
    }
  },
}

/** Invia envelope evento (senza lead) — usato da fan-out mirax_events. */
export async function sendWebhookEnvelope(
  config: Record<string, unknown>,
  envelope: Record<string, unknown>,
): Promise<{ ok: boolean; error?: string }> {
  const url = typeof config.url === 'string' ? config.url : ''
  const secret = typeof config.secret === 'string' ? config.secret : ''
  if (!url) return { ok: false, error: 'Missing webhook url' }

  const payload = JSON.stringify(envelope)
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': 'MIRAX-NOUS/1.0',
  }
  if (secret) {
    const signature = crypto.createHmac('sha256', secret).update(payload).digest('hex')
    headers['X-MiraX-Signature'] = `sha256=${signature}`
  }

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: payload,
      signal: AbortSignal.timeout(12_000),
    })
    return res.ok ? { ok: true } : { ok: false, error: `HTTP ${res.status}` }
  } catch (e: unknown) {
    return { ok: false, error: e instanceof Error ? e.message : 'Webhook error' }
  }
}
