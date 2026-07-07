/**
 * Fase 10 — Webhook outbound per eventi Universe (Zapier/Make/user_integrations).
 *
 * Sicurezza:
 * - Solo URL https pubbliche (nessun IP privato/localhost).
 * - Firma HMAC-SHA256 obbligatoria: nessun webhook senza secret.
 * - Replay protection tramite timestamp X-MiraX-Timestamp incluso nella firma.
 * - Confronto signature in tempo costante.
 */

import { createHmac, timingSafeEqual } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { UniverseEntity, UniverseEvent } from './types.ts'
import { labelEvent } from './labels.ts'
import { wrapSupabaseError } from './errors.ts'

const TIMEOUT_MS = 12_000
const MAX_SIGNATURE_AGE_MS = 5 * 60 * 1000 // 5 minuti

export function isUniverseWebhooksEnabled(): boolean {
  return process.env.UNIVERSE_WEBHOOKS_ENABLED === '1' || process.env.UNIVERSE_ENABLED === '1'
}

type WebhookTarget = { user_id: string; url: string; secret: string }

function isPrivateOrReservedHost(host: string): boolean {
  const lower = host.toLowerCase()
  if (lower === 'localhost') return true
  if (/^127\./.test(lower)) return true
  if (/^10\./.test(lower)) return true
  if (/^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(lower)) return true
  if (/^192\.168\./.test(lower)) return true
  if (lower.startsWith('[') && lower.includes('::1')) return true
  if (/\.local$/.test(lower)) return true
  return false
}

function validateWebhookUrl(url: string): { ok: true } | { ok: false; error: string } {
  if (!/^https:\/\//i.test(url)) {
    return { ok: false, error: 'I webhook Universe accettano solo URL https' }
  }
  try {
    const parsed = new URL(url)
    if (isPrivateOrReservedHost(parsed.hostname)) {
      return { ok: false, error: 'URL riservato o privato non ammesso' }
    }
    return { ok: true }
  } catch {
    return { ok: false, error: 'URL webhook non valido' }
  }
}

async function findWebhookTargets(sb: SupabaseClient, userIds: string[]): Promise<WebhookTarget[]> {
  const targets: WebhookTarget[] = []
  const seen = new Set<string>()

  for (const userId of userIds) {
    const { data: integ } = await sb
      .from('user_integrations')
      .select('webhook_url, webhook_secret')
      .eq('user_id', userId)
      .maybeSingle()

    const url = typeof integ?.webhook_url === 'string' ? integ.webhook_url.trim() : ''
    const secret = typeof integ?.webhook_secret === 'string' ? integ.webhook_secret.trim() : ''
    const urlValid = validateWebhookUrl(url)
    if (url && secret && urlValid.ok) {
      const key = `${userId}:${url}`
      if (!seen.has(key)) {
        seen.add(key)
        targets.push({ user_id: userId, url, secret })
      }
    } else if (url && !secret) {
      console.warn(`[universe/webhooks] skip user_integrations webhook for ${userId}: missing webhook_secret`)
    }

    const { data: crmRows } = await sb
      .from('crm_integrations')
      .select('config')
      .eq('user_id', userId)
      .eq('type', 'webhook')
      .eq('is_active', true)

    for (const row of crmRows ?? []) {
      const cfg = row.config && typeof row.config === 'object' ? (row.config as Record<string, unknown>) : {}
      const crmUrl = typeof cfg.url === 'string' ? cfg.url.trim() : ''
      const crmSecret = typeof cfg.secret === 'string' ? cfg.secret.trim() : ''
      const crmValid = validateWebhookUrl(crmUrl)
      if (crmUrl && crmSecret && crmValid.ok) {
        const key = `${userId}:${crmUrl}`
        if (!seen.has(key)) {
          seen.add(key)
          targets.push({ user_id: userId, url: crmUrl, secret: crmSecret })
        }
      } else if (crmUrl && !crmSecret) {
        console.warn(`[universe/webhooks] skip crm_integrations webhook for ${userId}: missing secret`)
      }
    }
  }

  return targets
}

function signPayload(secret: string, timestamp: string, body: string): string {
  const baseString = `${timestamp}.${body}`
  return `sha256=${createHmac('sha256', secret).update(baseString).digest('hex')}`
}

function verifySignature(secret: string, timestamp: string, body: string, signature: string): boolean {
  const expected = signPayload(secret, timestamp, body)
  try {
    const expectedBuf = Buffer.from(expected)
    const actualBuf = Buffer.from(signature)
    return expectedBuf.length === actualBuf.length && timingSafeEqual(expectedBuf, actualBuf)
  } catch {
    return false
  }
}

async function postWebhook(
  url: string,
  body: Record<string, unknown>,
  secret: string,
): Promise<{ ok: boolean; status?: number; error?: string }> {
  const urlValid = validateWebhookUrl(url)
  if (!urlValid.ok) return { ok: false, error: urlValid.error }

  const timestamp = Math.floor(Date.now() / 1000).toString()
  const payload = JSON.stringify(body)
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': 'MIRAX-Universe/1.0',
    'X-MiraX-Timestamp': timestamp,
    'X-MiraX-Signature': signPayload(secret, timestamp, payload),
  }

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: payload,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    return res.ok ? { ok: true, status: res.status } : { ok: false, status: res.status, error: `HTTP ${res.status}` }
  } catch (e: unknown) {
    return { ok: false, error: e instanceof Error ? e.message : 'Webhook error' }
  }
}

async function logDelivery(
  sb: SupabaseClient,
  row: {
    user_id: string
    event_id?: string
    entity_id?: string
    webhook_url: string
    status: 'success' | 'error'
    response_code?: number
    error_message?: string
    payload: Record<string, unknown>
  },
): Promise<void> {
  const { error } = await sb.from('universe_webhook_deliveries').insert(row)
  if (error && !/universe_webhook_deliveries|does not exist/i.test(error.message)) {
    console.warn('[universe/webhooks] log failed:', error.message)
  }
}

export type UniverseWebhookDispatchResult = {
  ok: boolean
  delivered: number
  errors: number
  skipped: boolean
  details: { url: string; ok: boolean; status?: number; error?: string }[]
}

export async function dispatchUniverseEventWebhooks(
  sb: SupabaseClient,
  event: UniverseEvent,
  entity: UniverseEntity,
  userIds: string[],
): Promise<UniverseWebhookDispatchResult> {
  if (!isUniverseWebhooksEnabled()) return { ok: true, delivered: 0, errors: 0, skipped: true, details: [] }
  if (!userIds.length) return { ok: true, delivered: 0, errors: 0, skipped: false, details: [] }

  const targets = await findWebhookTargets(sb, userIds)
  if (!targets.length) return { ok: true, delivered: 0, errors: 0, skipped: false, details: [] }

  const envelope = {
    type: 'universe.graph.event',
    version: 1,
    event_type: event.event_type,
    event_label: labelEvent(event.event_type),
    entity_id: entity.id,
    entity_name: entity.name,
    canonical_id: entity.canonical_id,
    city: entity.city,
    occurred_at: event.occurred_at,
    source: event.source,
    payload: event.payload,
  }

  let delivered = 0
  let errors = 0
  const details: UniverseWebhookDispatchResult['details'] = []
  let anyFailed = false

  for (const t of targets) {
    const result = await postWebhook(t.url, envelope, t.secret)
    await logDelivery(sb, {
      user_id: t.user_id,
      event_id: event.id,
      entity_id: entity.id,
      webhook_url: t.url,
      status: result.ok ? 'success' : 'error',
      response_code: result.status,
      error_message: result.error,
      payload: envelope,
    })
    details.push({ url: t.url, ok: result.ok, status: result.status, error: result.error })
    if (result.ok) delivered++
    else {
      errors++
      anyFailed = true
    }
  }

  return { ok: !anyFailed, delivered, errors, skipped: false, details }
}

export async function listWebhookDeliveries(
  sb: SupabaseClient,
  userId: string,
  limit = 20,
): Promise<unknown[]> {
  const { data, error } = await sb
    .from('universe_webhook_deliveries')
    .select('id, event_id, entity_id, status, response_code, error_message, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) {
    if (/universe_webhook_deliveries|does not exist/i.test(error.message)) return []
    throw wrapSupabaseError(error)
  }
  return data ?? []
}
